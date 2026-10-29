# Phase 5A-2B-2C — bounded confirmation and keyless reconciliation

## Decision and baseline

**CONDITIONAL GO for supervised local Anvil confirmation/reconciliation and code review. NO-GO for production MCP activation, Portaldot V3, automatic recovery or material funds.** Internal engineering validation; not an independent security audit or an exactly-once payment guarantee.

Verified fetched `origin/main` and starting HEAD: **`99fb877b695e01e0bd82ebffb5c6403f246a2e4d`**. Feature branch: `codex/allowance-reconciliation-phase5a2b2c`. Reviewed [the recovery architecture](TRANSACTION-RECOVERY-DESIGN-PHASE5A2B1.md), [JN1/JN2 repair](JOURNAL-NONCE-INTEGRITY-REPAIR-PHASE5A2B2A-R1.md), journal implementation/schema, isolated adapter/transport, all journal/adapter tests and [the preceding validation](ISOLATED-BROADCAST-VALIDATION-PHASE5A2B2B.md).

All **30 existing journal tests passed before implementation**. No foundational defect blocking this scope was identified. JN1/JN2's `validateChange()` remains the same authoritative path for live mutation and chronological replay. Its nonce reservations, global eligibility and state transition graph are unchanged. Unknown receipts, timeouts, closed parents and account switching do not release nonces. Only proven PREPARED → NOT_SUBMITTED can release that reservation; reconciliation never creates that proof or enters SUBMITTING.

Before this phase, the isolated adapter returned SUBMITTED/NOT_CHECKED and had no bounded receipt verifier. That was an explicitly deferred capability, not a newly claimed defect in production MCP. This phase adds an explicit separate confirmation call; it does not change submission's successful schema or begin automatic confirmation/payment execution.

## Architecture and interfaces

### Read-only operator library

`createLocalReconciler(context)` in `mcp/local-reconcile.js` accepts the existing isolated context **without a key**:

```text
mode: "anvil-journal"
rpcUrl: literal "http://127.0.0.1:<explicit-port>"
contract, accountId, expectedCodeHash
state: { stateDir, storeId }
wallet: { journalId, binding: { chainId: "31337", genesisHash, wallet } }
optional io: trusted filesystem fault-injection implementation
```

Unknown fields, including `key`, reject. There is no environment-key lookup, signer, wallet construction, server or new MCP tool. A local endpoint and its configured code hash are trusted operator inputs, not independent attestations. Public URLs, other chain IDs and non-Anvil contexts reject. No unconfigured provider, indexer or fallback endpoint is consulted.

The frozen library exposes:

```js
reader.inspect(); // scoped journal summaries, no RPC or mutation
await reader.reconcile(operationId, childId, {
  timeoutMs: 5000, pollMs: 100, maxPolls: 12,
  // optional signal, replacementHash
});
```

Identity comes only from the selected validated journal operation and child; caller-supplied amount, recipient, calldata, wallet, nonce or arbitrary filesystem paths are not accepted as reconciliation arguments. IDs are validated and never interpolated into filenames. Operations outside the configured contract/account scope reject before RPC. ERC-20 operations are outside this native experiment.

New `openReader()` in `mcp/journal.js` exposes only `inspect()`. It uses the same root/store ID, inode, path, ownership, 0700/0600, single-link, no-symlink, supported-filesystem, checksum/seal and chronological semantic validation as the writer. It skips constructor fsync and cannot acquire/release ownership, create a wallet, append or repair. Tests use an IO implementation that throws on **any write or fsync** and rejects writable file opens. Reads preserve journal bytes, including during an unresolved crash lock. A concurrent partial writer may cause a conservative read rejection; no tail is discarded.

### Explicit local persistence coordinator

`adapter.confirm(operationId, childId, controls)` delegates to `confirmLocalOperation(context, ...)` in `mcp/local-confirm.js`. The coordinator is also usable without a key, but **writes local journal metadata**; it is distinct from the pure read-only library. Its chain access is exclusively through the reconciler's private read-method allowlist. Neither path signs, sends, estimates/sends a refuel, cancels or resumes a child.

The coordinator acquires real exclusive wallet ownership; stale crash ownership is never taken over. It checks ownership again after asynchronous reads and before persistence. Positive verified results are fsynced before a successful confirmed return. Existing legal state edges are used, including SUBMITTING → UNKNOWN → CONFIRMED/REVERTED and SUBMITTED → UNKNOWN → RECOVERY_REQUIRED. A positively observed pending hash can move UNKNOWN → SUBMITTED. Recovery-only updates remain available without granting SUBMITTING eligibility.

Parents intentionally remain OPEN, including after a confirmed/reverted child. Automatic parent disposition, refuel/pay continuation and mutation admission after resolution are deferred. Consequently subsequent payments remain blocked until separately reviewed explicit disposition; no automatic business retry follows a confirmation or revert.

## Deadline, observations and verification policy

The complete network/poll sequence shares **one monotonic deadline**, not separate unbounded request timers. Default 5,000 ms; allowed 10–60,000 ms. Poll spacing defaults to 100 ms (10–5,000 ms); default maximum 12 polls (1–100). Context reads, transaction/receipt reads, state/event checks, canonical rechecks, supplied replacement lookup and polling all consume the same budget. The coordinator subtracts initial ownership/preparation time from the reader's remaining budget. Transport requests are destroyed on timeout/abort, polling timers/listeners are removed, and no abandoned continuation can initiate a mutation. Read repetition is explicit polling; the transport itself still has no retries or redirects.

The existing synchronous filesystem/replay/fsync primitives **cannot be preempted by a JavaScript deadline**. On a stalled filesystem or a blocked event loop, wall-clock return can exceed the requested budget. Monotonic checks reject a positive confirmation that overruns its budget, including after persistence, and preserve the hash; they are not a hard real-time storage guarantee. A hard wall-clock bound under hung OS/storage calls would require separately reviewed worker/process isolation. No such guarantee is claimed here.

Results separate `recordedState`, `recordedOutcome`, `recordedReceipt`, current `observation`, `outcome`, `receipt`, `replacement`, `evidence`, `policy`, `freshness`, poll count and timeout status. Freshness includes start/observation/finish timestamps and the last completed pending/unknown observation. These timestamps measure observation time, not RPC freshness or chain liveness. `inspect()` retains prior stored evidence when a new read is unavailable.

| Observation | Meaning and conservative persistence |
| --- | --- |
| CONFIRMED / PAID | Exact original envelope, canonical status-1 receipt and matching Paid event under the fixed policy. No purchase/service-fulfilment or irreversible finality guarantee. |
| CONFIRMED / HELD | Original transaction created a matching held request; it did not pay the recipient. Later owner approval is a separate transaction, not a rewrite to instant PAID. |
| CONFIRMED / REFUELED or CANCELLED | Exact historical child and its corresponding event verified. This does not complete the parent payment. |
| REVERTED | Exact original envelope plus canonical matching status-0 receipt with no logs. No invented revert reason and no automatic retry; gas/earlier child effects are separate. |
| PENDING | Exact signed hash/envelope observed pending without receipt; never completed. Reservation remains. |
| UNKNOWN | Missing evidence, unavailable RPC, polling budget/deadline or cancellation. Never means dropped, failed or unsubmitted. The original hash remains. |
| RECOVERY_REQUIRED | Identity/event/canonical conflict, candidate replacement, or unresolved nonce advancement without complete original evidence. Never permission to repay. |

Missing current history does not erase a recorded CONFIRMED/REVERTED result or automatically reopen it. In particular, an advanced nonce is expected after a historical confirmation and does not by itself prove contradiction or replacement. Positive contradictory evidence requires RECOVERY_REQUIRED; old receipt/outcome remain available and prior complete frames are preserved. The result can also carry a conflicting current observation separately.

The fixed **ANVIL_CANONICAL_V1** policy verifies:

1. Configured chain ID 31337, Anvil client, genesis and exact contract runtime-code hash.
2. Reconstructed signed type-2 transaction hash and recovered sender from RPC fields, compared to the stored hash and wallet. Signature scalars may be numerically padded from RPC quantities only because the full reconstructed hash must still match. No raw signed transaction/signature is persisted or returned.
3. Exact nonce, destination contract, value, gas/fees, empty access list, calldata commitment, method and decoded arguments. Parent intent and child kind/amount/request are distinct sources: a refuel child verifies its own amount and wallet recipient, not the parent's payment amount/recipient.
4. Receipt hash, sender/target/type/status, transaction block/index, and block membership at that index. Receipt and all logs must agree on transaction/block/index context; removed or duplicate-index logs reject.
5. Exactly one relevant expected contract event. Paid/PaymentHeld require account, recipient, raw amount and exact memo hash. Held request ID/reason are also checked against the historical request state and creation timestamp. Refueled requires account, original signing wallet and child amount. Cancellation requires exact request/account and **Status.Cancelled = 4**, confirmed against historical request state; Rejected = 3 is not cancellation. Present agent rotation is not used to invalidate the historical sender.
6. Code and request/account reads at the receipt height; head height at least the receipt height; equal-height head hash must equal receipt hash. Re-read the complete receipt and canonical block after collecting event/state evidence. Inclusion between the initial transaction read and receipt read triggers another read of the **same stored hash**, not a nonce lookup or resubmission.

This is one trusted RPC view and one canonical-inclusion policy. It does not independently prove receipt trie inclusion, full-chain ancestry, reorg immunity or **Portaldot V3 finality**. The result explicitly sets `independentV3Finality: false`. Historical-state RPC pruning can prevent fresh confirmation even if logs remain accessible; no log-only fallback declares success.

## Durable evidence, compatibility and replacement limits

The existing immutable child identity and receipt fields are retained. New optional child `evidence` records a strictly validated policy, ISO observation time, observed head, event name/index/request/reason plus topics/data commitment, and any replacement pair/classification/receipt. Evidence contains no memo text, keys, signatures, raw signed bytes or full RPC error/request dumps. Existing privacy/backup/retention and same-OS-user trust limits still apply.

Optional evidence is validated by the same child/operation validation path during live writes and every historical replay frame. CONFIRMED/REVERTED metadata must agree with receipt/outcome and head height/hash; replacements are limited to RECOVERY_REQUIRED with the immutable original hash and a distinct candidate. Evidence does not authenticate RPC observations merely because a checksum is valid.

Old records without evidence remain readable; the 30 original journal tests remain unchanged. **Older journal readers reject new evidence-bearing frames** rather than silently ignoring them: this is not a downgrade-compatible journal format. Use the matching reader/writer version for this experiment; schema version 1's optional extension is documented here. No persisted migration or rewrite is performed. Legacy MCP tools, successful submission responses, ABI, dependencies and package publication allowlist remain unchanged. Experimental modules are still absent from the published MCP file list.

Replacement behavior:

- No automatic sender/nonce scanning or timely replacement discovery. Nonce advancement without a complete original observation returns RECOVERY_REQUIRED with no invented replacement hash.
- An operator can supply a candidate hash. Its signed hash, chain, wallet and nonce must verify. A canonical candidate receipt is independently checked; equivalent-call candidates also require exact intended contract events.
- Distinguish EQUIVALENT_CALL (same calldata/value/target, gas and empty access list; fees/signature may differ), DIFFERENT_CALL, zero-value empty-calldata self-transfer CANCELLATION, and UNVERIFIED. `verified` means an observed canonical receipt at that nonce, not success of the original payment. Candidate receipt status remains explicit, including possible reversion.
- Keep the original immutable hash and candidate hash together. Even an equivalent replacement with a real Paid event leaves the original operation RECOVERY_REQUIRED. No original-hash overwrite, nonce release, replacement signing or business repayment occurs.
- One candidate per child is supported. A persisted candidate is re-read after restart when no new hash is supplied; a different second candidate rejects `MULTIPLE_REPLACEMENTS_UNSUPPORTED`. Multi-hop lineage and resolution are deferred. When already RECOVERY_REQUIRED, fresh observations are returned but no same-state evidence-only write is invented (`persisted: false`); prior durable evidence remains inspectable. This may require preserving the returned observation separately for operator review.

No automatic journal repair or lock cleanup exists. A failed confirmation append/fsync/release throws an uncertainty error carrying the original hash, even after actual inclusion. A complete frame may be visible despite failed fsync; a torn frame rejects. Caller uncertainty is reported separately from known chain observations and durable journal confidence.

## Deterministic failure evidence

Actual local Anvil on `127.0.0.1:8559`; the unchanged compiled Allowance runtime is installed with local testing methods, not deployed to a public network. Tests use public deterministic fixture keys, local owner setup and real native transactions. Relay modifications are explicitly injected RPC faults, not observations of Portaldot behavior. The historical refuel/cancel/held fixture producer is test-only and obeys journal-before-send ordering; it does not enable those adapter routes.

The first development run was **12/14**, exposing the new implementation's inclusion-read race and unpadded-signature handling. After correcting those paths, the focused suite passed **14/14**; final full validation includes all 14 groups. These were implementation feedback, not reproduced defects in the base's production handlers.

| New group | Evidence and assertions |
| --- | --- |
| Paid/keyless boundary | Actual matching Paid, budget debit and recipient balance. Exact journal bytes unchanged during reads; write/fsync/writable opens throw; zero signing and mutation RPCs. Explicit confirmation persists receipt/policy/event commitment. Public endpoints, key fields, wrong mode and invalid IDs reject. |
| Delayed inclusion | Disable automine; observe PENDING. Deterministically mine between a later transaction read and receipt request; refresh same hash and confirm real Paid within one bounded operation. One submission. |
| Deadline | Delay context RPC or receipt RPC 350 ms against a 100 ms total budget. UNKNOWN/TIMEOUT returns under the test's 300 ms allowance, preserves hash/bytes, and waiting beyond the delayed response produces no new mutation. |
| Missing history | A durable signed but deliberately unbroadcast local fixture remains UNKNOWN with no recipient effect. Hide transaction/receipt of a previously confirmed actual payment: preserve historical PAID/CONFIRMED, including with a naturally advanced nonce. |
| Polling errors/pending | Inject RPC receipt error after actual payment: UNKNOWN and reserved nonce; another pay rejects. An accepted unmined transaction with lost acknowledgment can subsequently be observed PENDING/SUBMITTED without another broadcast. |
| Held | Actual over-cap call creates a request and no recipient payment; confirm HELD with request evidence. Later owner approval and agent rotation do not change the original result to instant Paid. |
| Revert | Freeze after preparing a real fixture payment; canonical receipt status 0, no recipient effect, REVERTED and original hash, no retry. |
| Wrong Paid event | Mutate emitter, account, recipient, amount and memo separately on a real successful receipt; none confirm. Read-only bytes remain identical; explicit confirmation records RECOVERY_REQUIRED. |
| Refuel/cancel | Actual refuel with child amount different from parent payment amount; wrong amount rejects, exact Refueled confirms. Actual held-request cancellation: wrong request, account or Rejected status reject; exact Cancelled status 4 confirms. Adapter still rejects refuel/cancel execution. |
| Canonical/receipt conflicts | Inject mismatching canonical block or equal-height head, removed log, changing receipt and altered signed envelope. No false success; historical confirmation moves to recovery on positive conflict. |
| Crash/restart | SIGKILL broadcaster after acceptance, before response. Fresh process with **empty environment and no key** reports matching observed confirmation but recorded SUBMITTING. Journal and lock bytes unchanged; coordinator refuses WALLET_BUSY; one actual payment. |
| Replacement | Real same-nonce higher-fee replacement pays once; different-call refuel and self-transfer have distinct effects. All preserve original/candidate hashes and recovery state. Unknown candidate stays unverified. Restart retains candidate; nonce advancement alone invents no hash. |
| Persistence failure | ENOSPC during confirmed append and EIO at file/directory fsync after inclusion. Throw UNKNOWN with original hash, retain uncertain ownership and reject later payments; actual original Paid effect occurs once. |
| Evidence replay/permissions | Valid evidence replays; contradictory live evidence leaves bytes unchanged. Re-checksummed invalid earlier confirmation followed by a valid recovery frame still rejects during chronological replay. Unsafe permissions/truncated history reject without repair or mutation. |

All existing 30 journal and 12 adapter groups also run unchanged, preserving disk/fsync, JN1/JN2, single-attempt broadcast, HTTP 429, duplicate identical-byte delivery, stale signing continuation and crash-ownership protections. Real receipt assertions bind contract, account, recipient, raw amount and memo, not just any Paid event.

A separate uncommitted evidence capture (`work/reconciliation/evidence.txt`, one passing capture group, not included in the 98-test count) recorded local transaction **`0x18a8784cc827759e1f5b2f1968b026b8f4846af3287318f251fb42ba63a445ca`**, account 0 at local contract `0x000000000000000000000000000000000000a110`, receipt status 1 in block 2. The exact raw amount and recipient balance were both **100000000000000000**, with **one** adapter broadcast. Changing only the receipt emitter yielded RECOVERY_REQUIRED/EVENT_MISMATCH, preserving journal bytes (SHA-256 `0xe578a0271f02f7d8080da003edd347165990f6d798f965de885bd2e1dcc99f9e`). This is ephemeral local-chain evidence, not a public explorer transaction; the committed tests reproduce the assertions on fresh fixtures.

## Commands and actual validation

Tools already installed: Node **24.19.0**, ethers **6.13.4**, Forge/Anvil **1.7.1**, solc **0.8.28+commit.7893614a**. No dependency or tool upgrade. Linux overlay storage only; no hardware power-loss, other OS/filesystem or live V3 qualification is inferred.

```sh
node --test mcp/test/journal.test.js mcp/test/journal-nonce.test.js mcp/test/journal-eligibility.test.js
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil node --test mcp/test/reconciliation.test.js
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2b2c01 -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
npm test --prefix substrate
node script/spending-view.test.cjs
node --check mcp/journal.js
node --check mcp/journal-schema.js
node --check mcp/local-broadcast.js
node --check mcp/local-reconcile.js
node --check mcp/local-confirm.js
node --check mcp/test/reconciliation.test.js
node --check mcp/test/helpers/reconciliation-process.mjs
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

| Check | Result |
| --- | --- |
| Baseline journal | **30 passed / 0 failed/skipped** before changes; same original tests also pass after changes. |
| Build | Exit 0; unchanged Allowance runtime **9,757 bytes**; existing timestamp/typecast lint warnings remain. |
| Complete Foundry | **58 passed / 0 failed/skipped**, four suites, 1,000-run fuzz; invariant 128 runs / 16,384 calls, zero handler reverts. |
| Complete MCP | **98 passed / 0 failed/skipped/cancelled**: 42 legacy integration, 19 original journal, six JN1, five JN2, 12 existing isolated adapter and 14 reconciliation groups. |
| Native/display units | **24 native + 10 display passed**, zero failed/skipped. |
| Syntax/whitespace | All seven listed JS/MJS files and staged diff check pass. |
| Isolated frontend build | `python3 work/isolated-broadcast/site-build/build.py` with verified unchanged copied source/pinned dependencies: all **seven** generated files byte-identical; actual generated website/ABI files untouched. |
| Formatting | Exit **1**, existing differences in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`; no formatting applied. |

Uncommitted local logs/reproduction evidence are under `work/reconciliation/`. No GitHub CI result is claimed for this unpushed phase.

## Exact changed files

1. `mcp/journal.js` — read-only reader capability with existing strict validation.
2. `mcp/journal-schema.js` — optional bounded observation evidence validation/preservation; transition graph and JN1/JN2 global validation unchanged.
3. `mcp/local-broadcast.js` — additive explicit confirm delegation; submission path/response unchanged.
4. `mcp/local-reconcile.js` — keyless, read-only, bounded verification library.
5. `mcp/local-confirm.js` — owned local evidence persistence; no chain mutations.
6. `mcp/test/reconciliation.test.js` — 14 local Anvil/fault groups.
7. `mcp/test/helpers/reconciliation-process.mjs` — keyless fresh-process inspection fixture.
8. `docs/RECONCILIATION-VALIDATION-PHASE5A2B2C.md` — this report.

No Solidity, ABI, production MCP handler, frontend/generated site, CI, dependency/lockfile, address, network or deployment configuration changes. Existing untracked `lib/` and `work/` remain excluded. No public-chain transaction, deployment, push, PR or merge is part of this delivery.

## Remaining readiness gates

- Independent code review and later authorized CI publication of this experimental change; no claim of an independent audit.
- Operator crash-lock recovery, parent disposition and safe compound refuel/pay/cancel execution remain deferred. Confirmed refuel is not a completed parent pay. No lock is automatically deleted, reset or repaired.
- Replacement discovery, multi-hop lineage and disposition remain incomplete; all candidate outcomes retain recovery gating. No automatic resend, nonce reuse, fee bump or payment retry.
- Existing journal size/retention limits, valid historical rollback detection limits and one cooperating writer/shared journal per local host remain. Different stores/devices, external wallet use and malicious same-user writers are outside the guarantee.
- Journal/runtime version coordination is required for evidence-bearing frames. State corruption or missing identities cannot be reconstructed from caller intent and declared safe.
- Qualify blocking storage/replay latency separately if a hard wall-clock return guarantee is required. The current logical deadline bounds RPC/poll work under a responsive local runtime, not stalled kernel calls or hardware durability.
- V3 remains NO-GO: public transport behavior, chain retention/historical-state availability, native gas/storage deposits, runtime/code identity and EVM/Substrate finality mapping require separately authorized target-runtime evidence. One Anvil receipt and event do not prove Portaldot finality or production readiness.


## Independent review addendum — PR #20 C2-R1/C2-R2 remediation (29 October 2026)

This section tracks the separately reviewed **draft PR #21**, based on draft PR #20:
https://github.com/Oziman13/allowance/pull/21
Original blocker reproduction:
https://github.com/Oziman13/allowance/pull/20#issuecomment-6499911707

**C2-R2 (stale PAID):** The prior observer checked only immutable child identity. The replacement implementation re-reads the authorized parent operation after asynchronous RPC work, rejects an in-flight success if any parent/child/recovery evidence has changed, carries forward newly recorded candidate identity, and refuses to promote an already `RECOVERY_REQUIRED` child merely because an RPC produces another positive receipt. A confirmed receipt remains an observation, not V3 finality or operator authorization to clear recovery.

**C2-R1 (lost candidate identity):** For an explicit candidate supplied to the **journal-owned confirmation coordinator**, the candidate hash is validated and recorded as `UNVERIFIED` under exclusive wallet ownership **before** error-prone network observation. For an already-recovery-blocked child with no candidate, a narrowly constrained same-state journal update can append only the previously unknown candidate, preserving historical receipt/outcome and prior evidence. Live writes and replay use the same transition validation. The keyless reader remains byte-for-byte read-only and can report a supplied candidate without making it durable; only the journal-owning coordinator may promise persistence after successful fsync.

New deterministic Anvil regression cases cover candidate lookup error, context failure before lookup, fresh-process read, already-recovery-blocked child enrichment and replay, rejection of a conflicting second candidate, newer recovery evidence while a success response is in flight, real `evm_snapshot` / `evm_revert` with a locally signed same-nonce cancellation and zero recipient balance, pre-existing recovery holds, and parent disposition changes. Each preserves the original transaction hash and checks there is no additional payment broadcast from the reconciler.

**Important boundaries and residual uncertainty:**
- A supplied replacement hash is NOT proof of a broadcast, same-sender ownership, equivalence, finality or even an existing transaction. Until independently verified, its classification is `UNVERIFIED` and payments remain blocked.
- An operator-provided hash is durable only **after** the journal has successfully recorded the candidate. Interruption before the candidate's fsynced frame can still require the operator to re-supply it. The multi-frame SUBMITTING/SUBMITTED-to-recovery transition is intentionally not a transactional group.
- There is no autonomous reconciliation-to-payment retry, no crash-lock takeover, no silent parent settlement, no replacement-chain tracking across multiple candidates, and no automatic conversion of recovered evidence to a new payment.
- A successfully read one-confirmation Anvil receipt is not independently qualified Portaldot V3 finality.
- An immutable hash/history is not protection against an attacker who can roll back the **whole valid journal store**; previous storage/rollback limitations persist.
- Existing filesystem synchronous operations do not obey asynchronous deadlines.

**Delivery gate:** This addendum does not itself certify success. Check the latest branch head's GitHub Actions Foundry and MCP jobs and the new tests before any PR #21 merge into PR #20. Re-review the integrated PR #20 diff and run CI before considering main. The public/production MCP broadcaster stays disconnected and NO-GO until the later crash recovery, compound-parent disposition and live V3 qualification phases.
