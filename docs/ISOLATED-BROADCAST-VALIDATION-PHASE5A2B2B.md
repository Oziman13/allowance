# Phase 5A-2B-2B — isolated journal-gated broadcast validation

## Decision and scope

**CONDITIONAL GO for isolated localhost Anvil experiments and review only. NO-GO for production MCP activation, Portaldot V3 broadcasting or comprehensive recovery.** This is internal engineering validation, not an independent security audit.

Verified starting local and fetched `origin/main`: **`7be50c54f48eb5a0db4bbc0cdde49c9bd9eb0b06`**. Branch: `codex/allowance-isolated-broadcast-phase5a2b2b`. This follows the repaired JN1/JN2 journal in [the repair report](JOURNAL-NONCE-INTEGRITY-REPAIR-PHASE5A2B2A-R1.md), [journal foundation](DURABLE-JOURNAL-VALIDATION-PHASE5A2B2A.md) and [recovery design](TRANSACTION-RECOVERY-DESIGN-PHASE5A2B1.md).

No foundational blocker was found for a single native payment transaction. The journal can record the immutable intent, unsigned transaction fields, locally derived signed hash and submission uncertainty without a schema extension. It does not yet provide transaction reconciliation or permission to clear crash ownership.

The new adapter must be explicitly imported. Neither `mcp/lib.js` nor `mcp/index.js` imports it. Existing pay, refuel, cancel, fees, MCP tools and successful response schemas are unchanged. No public endpoint, real wallet, Portaldot signing, deployment or public-chain transaction was used.

## Architecture and supported environment

The experiment supports one cooperating wallet writer on a supported local host, sharing one trusted private journal store and wallet descriptor across all allowance accounts for that wallet. Validation here used Linux overlay storage, Node **24.19.0**, ethers **6.13.4**, Forge/Anvil **1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`) and solc **0.8.28+commit.7893614a**. Other Node versions, operating systems, network filesystems, disks and power-loss behavior were not qualified by this campaign. Process tests use Linux `/proc` and SIGKILL.

`createLocalBroadcastAdapter(options)` requires exactly:

```text
mode: "anvil-journal"
rpcUrl: "http://127.0.0.1:<explicit-port>"
key: offline local test-wallet key (memory only)
contract, accountId, expectedCodeHash
state: { stateDir, storeId }                  # existing provisioned store
wallet: { journalId, binding: { chainId, genesisHash, wallet } }
optional io: trusted filesystem implementation for deterministic fault tests
```

Addresses and hashes must be literal lowercase hex; account IDs and raw amounts are canonical decimal strings. The store is explicitly provisioned using the existing journal API, never automatically initialized or reset by this adapter. Optional `io` is trusted code, not an untrusted plugin boundary.

The returned frozen interface exposes:

- `pay({ recipient, amountRaw, memo }, { timeoutMs?, signal? }?)`: one native-asset payment transaction. Amount is a positive uint128 in raw units, without floating point; memo is at most 140 UTF-8 bytes. Inputs reject unknown fields and accessors.
- `inspect()`: a read-only journal snapshot; no reconciliation authority. Keyless callers can use `openStore(state).inspect(wallet)` directly; constructing the adapter itself still requires its local test-wallet key.
- `refuel()` and `cancel()`: always reject `UNSUPPORTED_ACTION`. ERC-20 and payments whose preflight would be held also reject before admission/signing. No automatic gas funding or refuel/pay composition exists.

There is no executable entry point, MCP activation flag, replacement API, retransmission API or automatic recovery routine. The existing npm publication file allowlist is unchanged; these experimental modules are not added to the published MCP package.

## Journal review and signing/durability ordering

JN1/JN2 remain authoritative: `validateChange()` in `mcp/journal-schema.js` is shared by live writes and chronological replay. Admission and entering SUBMITTING reject other unresolved parents; earlier refuels must be CONFIRMED; all accounts and historical parents reserve nonces. Closing an operation or missing a receipt cannot release a nonce. Only the explicit PREPARED → NOT_SUBMITTED proof can do so. Recovery-only transitions retain their existing eligibility. None of those rules or the schema was modified.

The sole journal addition is synchronous `session.assertOwnership()`. It invokes the existing guard, checking the store, directory and lock identity/token plus replayed owner/history. A failure poisons that capability; it grants no reset, repair or takeover authority. Existing mutations and release still perform their own guards. This extra method is additive and leaves existing session calls and persistence format unchanged.

The adapter orders each attempt as follows:

1. Validate explicit intent before acquiring ownership or creating any persistent operation: pay kind, fixed contract/account, native asset, recipient, raw amount, memo hash and null request ID. Validate bounded controls (10–60,000 ms; default 5,000 ms).
2. Acquire exclusive wallet ownership. Reject any OPEN operation, including an operation for another allowance. No implicit cleanup or resume occurs.
3. Read chain ID **31337**, Anvil client identity, block-zero hash, exact expected contract runtime-code hash, configured account agent and native asset. Other chains and nonliteral loopback URLs reject. These are observations of a trusted local endpoint, not an independent attestation of that endpoint.
4. Read-only `eth_call` of the exact pay calldata must currently return settled=true. Estimate gas, read pending nonce and agent balance; prepare type-2 fields. Preserve the legacy fee strategy: **1 gwei tip**, `maxFeePerGas = 2 * latest baseFee + tip`, exact estimated gas, zero transaction value. The null-base-fee fallback reads `eth_gasPrice`, matching the existing strategy; that fallback was inspected but not exercised by this Anvil campaign. Reject insufficient agent gas; do not refuel.
5. Recheck authorization and admit a complete PREPARED operation. Intent and prepared child are file- and directory-fsynced before signing. Preparation RPCs intentionally precede PREPARED: this schema requires complete unsigned fields, not placeholders. No signing or mutation RPC occurs during that read-only preparation.
6. Sign with an offline ethers `Wallet`, not `sendTransaction()` or a provider-connected signer. The ethers v6 signing implementation was inspected; literals require no ENS lookup. Decode the signed envelope and verify sender, target, chain, nonce, type, value, calldata, gas, both fee fields and empty access list against preparation. Derive `keccak256(rawSignedBytes)` locally.
7. Transition to SUBMITTING with that hash. Existing journal append, file fsync, directory fsync and post-write guard must all return successfully before the transport is invoked. Identity includes binding/intent, nonce, gas/fees, calldata hash and signed hash. Keys, plaintext memo, raw signed bytes and signatures are not journaled.
8. Use the dedicated loopback HTTP transport: one fresh connection, one POST/end, no SDK transport, batching, pooling, retry, redirect or polling. At TCP connection readiness, synchronously recheck the deadline and journal ownership immediately before handing the body to HTTP, with no intervening await. No payment is re-signed or replaced.
9. Require the acknowledgment to equal the original hash, then fsync SUBMITTED. A successful return is `{ operationId, childId, transactionHash, state: "SUBMITTED", confirmation: "NOT_CHECKED" }`. It does not mean payment completed. The operation stays OPEN and blocks another business attempt.

The final ownership check is a cooperating-writer capability check, not an OS lease against malicious local processes. No check can revoke bytes already handed to the socket. Deadline/abort flags prevent subsequent continuations from calling that send boundary. Late offline signature resolution is observed but cannot resume submission. Synchronous filesystem calls cannot be interrupted or bounded by a JavaScript timer; a hung fsync can stall the caller, but the subsequent monotonic check prevents a late initial send.

## Outcome and persistence rules

| Observation | Result and journal behavior |
| --- | --- |
| Invalid intent/context, corrupt history, ownership conflict or preparation error | BLOCKED; no signing/submission where admission has not succeeded. OWNER records may exist after an acquired session. |
| Failure after PREPARED but before durable SUBMITTING, with ownership still proven | Explicit NOT_SUBMITTED then ABANDONED/CLOSED. The adapter has not invoked broadcast and terminal continuations cannot do so. Only this positively established non-submission releases the nonce reservation. |
| SUBMITTING acknowledged by the journal but no accepted response from broadcast | UNKNOWN with the original hash. Even a timeout before actual request delivery is conservatively unresolved at this point. No nonce reuse or automatic new payment. |
| RPC error, socket close, HTTP 429/redirect or timeout after possible acceptance | UNKNOWN, original hash preserved. No inference of non-submission, no retry and no receipt-based claim. |
| Acknowledgment contains a different hash | Original hash retained, UNKNOWN then RECOVERY_REQUIRED/MANUAL_REVIEW. The foreign hash never replaces identity. |
| Original hash acknowledged and SUBMITTED append succeeds | SUBMITTED only, confirmation NOT_CHECKED. No receipt wait or event interpretation. |
| Any result persistence or release failure | Fail closed; `persistenceFailed: true`. Original derived hash remains in the sanitized error where available. Journal state may be UNVERIFIED, and uncertain ownership remains blocked. |

Errors expose a fixed code and safe identity/state fields, not raw SDK/RPC error objects that might include signed bytes. A failed append/fsync can leave a readable complete frame or a partial frame despite throwing. Consequently the error describes this invocation's send attempt separately from durable journal knowledge: `broadcastAttempted` means the final send boundary was reached, not acceptance. It is never used as permission to release a durable SUBMITTING reservation. If `admit()` throws before returning an operation ID, the caller may lack that ID; inspection and unresolved ownership remain necessary. No cleanup hides this uncertainty.

## Deterministic local evidence

New regressions use actual Anvil on `127.0.0.1:8558`, private disk-backed journal fixtures, offline public deterministic fixture keys, a Node HTTP fault relay and fresh child processes. They install the unchanged compiled runtime with `anvil_setCode` and initialize `_lock` at solc-verified storage slot 5, rather than deploying a contract in this campaign. Actual localhost owner setup and agent payment transactions then execute that runtime. The existing MCP tests retain their own disposable local-chain fixtures.

Every observed adapter mutation records the actual signed hash and nonce. The relay reads the disk journal at arrival and asserts the recorded SUBMITTING hash matches. Receipt-based test evidence independently checks **contract address, account ID, recipient, amount and memo** in Paid, plus recipient balance and allowance debit. Those test observations do not add production receipt verification to the adapter or attest V3 finality.

The **12 named adapter groups** cover the following distinct boundaries (subcases are not inflated into separate test counts):

| Group | Injection and measured result |
| --- | --- |
| Local context and input | Public/alias/path URLs, wrong chain, wrong code, invalid amount and unsupported refuel/cancel/held preflight reject. Zero sign calls, zero mutation requests, no persistent operation. |
| Successful payment | One offline signature, one request; actual decoded type-2 envelope equals prepared identity; hash equals raw-byte keccak; disk SUBMITTING precedes arrival; matching Paid/budget/recipient effect. A repeated business call rejects unresolved history. |
| Disk/fsync boundaries | ENOSPC before PREPARED write, torn partial PREPARED write, PREPARED file/directory fsync errors, SUBMITTING file/directory fsync errors. Zero broadcasts and zero recipient effects in every case; zero signatures for PREPARED failures, one for SUBMITTING failures. Poisoned ownership prevents later attempts. |
| Accepted but response lost | Actual payment accepted, then JSON-RPC error, socket destruction, HTTP 429 with Retry-After, redirect or withheld response until deadline. Original hash and UNKNOWN retained, one signature/request/effect, no automatic retry. Another business call rejects. |
| Identical delivery | Test relay deliberately delivers the same signed payload twice. One client signature/request, identical hash on both relay forwards, one consumed nonce and one payment effect. This is a duplicate network delivery fixture, not a deduplication/exactly-once business guarantee. |
| Acknowledgment/persistence | Wrong acknowledged hash produces RECOVERY_REQUIRED with original identity. SUBMITTED file/directory fsync failures after acceptance produce an error with original hash and persistence failure, retain uncertain ownership and never report completion. |
| Concurrent accounts/restart | Two real allowances share one agent and descriptor. Concurrent calls produce one submission and one WALLET_BUSY rejection. A fresh process cannot sign or send through the other allowance while the first operation is unresolved. |
| Historical nonce | Test-only explicit reconciliation uses a real matched Paid receipt and closes the first operation. The other allowance receives an injected stale nonce 0: NONCE_CONFLICT, zero additional signatures/requests, unchanged operation records. With correct nonce 1, a separate explicitly requested transaction succeeds. No production reconciliation API was added. |
| SIGKILL | Kill after PREPARED file fsync, after offline signing, after complete SUBMITTING file+directory fsync, and after actual acceptance before acknowledgment. First three have zero wire requests/effects; last has exactly one actual payment with persisted hash. Every crash retains ownership and a fresh process rejects without signing/sending. |
| Terminal continuation | Delay real offline signature resolution past timeout or explicit cancellation. Record proven NOT_SUBMITTED/CLOSED; wait past resolution and assert zero broadcasts/effects. |
| Authorization loss | Remove the ownership file during signing, or via a microtask after durable SUBMITTING but before socket readiness. Final guard rejects; zero requests/effects; no late send or successful repair/retry. |
| Corruption | Truncate the journal before acquisition. CORRUPT_STATE before preparation/signing/RPC, unchanged corrupt bytes, no reset and no new ownership file. |

Tests inspect journal bytes for fixture keys, raw signed bytes, signatures and plaintext memos; none are present. Process checkpoint output contains only state/hash. Test corruption, ownership removal and explicit test reconciliation are deliberate fixture actions, never adapter repair capabilities. OWNER acquire/release frames can append during a rejected nonce admission; the operation history remains identical. The SIGKILL tests prove process-crash behavior, not physical storage durability after power loss.

## Validation commands and actual results

All commands ran within the authorized repository; installed tool versions and project dependencies were preserved. Tool executables were already available in `/workspace/.allowance-tools`.

```sh
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2b2b02 -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
npm test --prefix substrate
node script/spending-view.test.cjs
node --check mcp/journal.js
node --check mcp/local-rpc.js
node --check mcp/local-broadcast.js
node --check mcp/test/local-broadcast.test.js
node --check mcp/test/helpers/local-broadcast-process.mjs
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

| Check | Actual result |
| --- | --- |
| Foundry build | Exit 0; unchanged Allowance runtime **9,757 bytes**. Existing timestamp/typecast lint warnings remain. |
| Complete Foundry | **58 passed / 0 failed / 0 skipped**, four suites. Configured 1,000-run fuzz and 128-run / 16,384-call stateful invariant; zero invariant handler reverts. |
| Complete MCP | **84 passed / 0 failed / 0 cancelled / 0 skipped**: 42 legacy integrations, 19 original journal, six JN1, five JN2 and 12 new adapter groups. |
| Native read-only units | **24 passed / 0 failed / 0 skipped**. |
| Spending display units | **10 passed / 0 failed / 0 skipped**. |
| JavaScript syntax | All five listed files pass. |
| Isolated frontend build | `python3 work/isolated-broadcast/site-build/build.py` succeeds using copied inputs and existing pinned dependencies. All **seven** emitted site/ABI/vendor files are byte-identical to tracked outputs; real generated files untouched. |
| Whitespace / scope | Staged whitespace check passes; exact six-file manifest below. |
| Solidity formatting | Exit **1**, pre-existing formatting differences in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. No formatting applied. |

Uncommitted logs and isolated build copies are under `work/isolated-broadcast/`; test state directories are removed by test cleanup. No dependency, lockfile, CI, deployment or network changes. No GitHub CI run is claimed for this local-only delivery.

## Exact changed-file manifest

1. `mcp/journal.js` — additive synchronous ownership guard; no mutation/replay/nonce/schema changes.
2. `mcp/local-broadcast.js` — explicitly imported local experiment, offline preparation/signing/journal gates and conservative submission outcomes.
3. `mcp/local-rpc.js` — literal-loopback one-attempt transport with cancellation and final authorization.
4. `mcp/test/local-broadcast.test.js` — actual Anvil effects and deterministic persistence/transport/process tests.
5. `mcp/test/helpers/local-broadcast-process.mjs` — isolated crash/restart fixture worker.
6. `docs/ISOLATED-BROADCAST-VALIDATION-PHASE5A2B2B.md` — this report.

Solidity, ABI, legacy MCP implementation, frontend/generated site, packages/lockfiles, CI, configured addresses and deployment/network settings remain unchanged. Pre-existing untracked `lib/` and `work/` are excluded. This task commits locally only; no push, PR, merge or deployment is authorized.

## Residual risks and next readiness gates

- **No reconciliation or confirmation:** SUBMITTED/UNKNOWN/RECOVERY_REQUIRED remain OPEN and intentionally stop later business mutations. A receipt being missing cannot unblock them. Future keyless reconciliation must verify transaction identity, receipt and exact Paid/PaymentHeld evidence and handle reorgs/replacements without inventing finality. The adapter does not call receipt APIs at all.
- **Preflight is advisory:** owner policy, freeze, agent, expiry, budget or chain state can change after reads. Even a preflight-settled native payment may revert or create a held request when included. The adapter rejects held preflights but cannot guarantee a later Paid event. Do not interpret its submission response as spending completion or absence of a held request.
- **Crash/persistence uncertainty is intentionally unrecoverable automatically:** a killed process, failed fsync/release, torn frame or retained owner history needs a separately reviewed operator recovery protocol. No stale lock deletion, journal reset, truncation, nonce repair, replacement or automatic retransmission exists.
- **Trust and coordination:** all cooperating accounts must use the same protected store/descriptor. Different stores, external wallet users, separate hosts/devices and noncooperating writers defeat this local coordination model. Private paths/permissions and checksum validation do not prevent a malicious same-user writer or detect every valid historical rollback. Existing journal size and retention limits remain.
- **Endpoint and signing trust:** a local endpoint can lie or proxy; chain/genesis/code/client checks are not independent proofs. Local process/library integrity and operator-supplied expected code hash remain trusted. The signed chain ID is fixed to 31337; the adapter rejects the configured public chain and URLs. No confidentiality, disk encryption or memory-key erasure guarantee is added. Public transaction identity and memo hashes remain linkable.
- **Transport/storage qualification:** one-attempt behavior and process crashes were tested on this Node/Linux/Anvil setup. Socket delivery/acceptance remain ambiguous; no claims about other clients, TCP stacks, storage hardware or power-loss persistence. Timers cannot preempt synchronous filesystem stalls.
- **Native payment only:** no safe refuel/pay composition, ERC-20 path, cancel lifecycle, held-request management, replacements or exactly-once intent/idempotency guarantee. Deliberately creating another business request after external/manual resolution can pay again; memo is not a deduplication key.
- **Portaldot remains NO-GO:** no live runtime, storage-deposit, RPC retry/pool, transaction replacement or finality evidence was added. The legacy EIP-1559 strategy was preserved, but Anvil execution does not qualify it or native gas/storage funding on V3. Production activation requires separately authorized integration and target-runtime evidence.

Next steps are independent review of these gates and tests, followed by a separately scoped read-only reconciliation/bounded-confirmation design and operator recovery protocol. Keep the experimental adapter disconnected from the five production MCP tools and all public networks until those gates and explicit authorization are satisfied.
