# Phase 5A-2B-2A-R1 — wallet-wide journal nonce integrity repair

Date: **29 October 2026, Europe/Istanbul (UTC+03)**. Repository: `Oziman13/allowance`. Base **`adee45ff4827d90d959b0a9167b3f7d49de066f2`** was verified by fetch and `git ls-remote origin main`. Branch: **`codex/allowance-journal-nonce-integrity-repair`**.

References: [journal foundation](DURABLE-JOURNAL-VALIDATION-PHASE5A2B2A.md), [recovery design](TRANSACTION-RECOVERY-DESIGN-PHASE5A2B1.md), and the local NO-GO report in commit **`b1db2bfac734057cf22009c56b885dd4aa77088d`**, path `docs/JOURNAL-BROADCAST-VALIDATION-PHASE5A2B2B.md`. That report is on its separate local branch; it is not copied into this repair's diff.

**JN1 is repaired and regression-tested locally. Broadcaster activation remains NO-GO.** This delivery changes journal validation only. It does not implement a signer, transport, reconciliation, replacement, retry or recovery workflow. Internal engineering validation, not an independent security audit or production-funds approval.

Sections 1–6 record the original R1 implementation. **Section 7 documents the JN2 follow-up** to the replay/admission discrepancy found during [draft PR #18](https://github.com/Oziman13/allowance/pull/18)'s publication review. The original R1 head is `1b890c932f17e6fb3e5d4906d05e5823c46b3af4`; JN2 builds on it on the same feature branch. PR #18 must remain Draft and must not merge in this phase.

## 1. Reproduced defect and root cause

The unchanged base's disk-backed harness reproduced the same supported-call sequence:

1. Wallet W, allowance account 0: refuel child nonce 0 becomes CONFIRMED; its partial parent A closes as ABANDONED.
2. The same wallet, account 1: payment nonce 1 becomes CONFIRMED and parent B closes as RESOLVED.
3. A fresh `admit()` with nonce 1 correctly rejects NONCE_CONFLICT.
4. Reopen A's refuel through CONFIRMED → RECOVERY_REQUIRED → CONFIRMED.
5. `addChild(A, pay nonce 1)` incorrectly succeeds; PREPARED → SUBMITTING succeeds too.
6. Clean release/reopen accepts both different transaction hashes with nonce 1, in CONFIRMED and SUBMITTING states.

Only fresh `admit()` had the wallet-wide historical hash/nonce comparison. `addChild()` checked other OPEN parents and its own sibling's nonce, while SUBMITTING checked other OPEN parents and preceding child progress. CLOSED parents were omitted from those checks. Replay validated per-parent transitions but not global nonce identity. Therefore a syntactically valid, checksummed conflicting history survived replay. A later abort could also hide a transient conflict from a validator examining only the final snapshot.

The original observer exited **0** after asserting the vulnerable outcome; its `--assert-safe` mode exited **1**, Missing expected exception. After this repair, that exact safety mode exits **0** because the conflicting child is rejected. All observations in that probe are **synthetic journal inputs**; it uses no RPC, signing key or signer and makes **zero signing/broadcast calls**. No duplicate on-chain execution or deployed contract vulnerability was demonstrated. Existing MCP behavior was unaffected by JN1 because the journal is not integrated into that path.

## 2. Invariant and narrow proof-based exception

The scope is one journal binding: chain ID + genesis hash + wallet. Contract and allowance account do not partition the wallet nonce namespace.

- **Unique reservations:** every non-NOT_SUBMITTED child in the candidate wallet snapshot owns a distinct canonical decimal nonce, regardless of parent, account, contract, OPEN/CLOSED status, receipt availability or outcome. PREPARED children reserve nonces even before they have hashes. Confirmed, reverted, SUBMITTING, SUBMITTED, UNKNOWN and RECOVERY_REQUIRED records continue to reserve their nonces.
- **Historical ordering:** when introducing a new child, and again on PREPARED → SUBMITTING, its nonce must exceed every other already hash-bearing child's nonce in the validated wallet history. This preserves the original fresh-admission restriction and extends it to child creation and submission admission. Equal and lower stale nonces reject. Integer comparisons use BigInt, never floating-point numbers.
- **Existing identity:** the current operation/child pair is excluded from comparisons with its own previous immutable hash/nonce. Repeated observations or reconciliation of that same child do not create another transaction. Nonce/specification/hash immutability still applies.
- **Every prefix:** replay applies this policy to each operation frame against the wallet context accumulated so far. It rejects the first conflicting frame even when a later frame marks its child NOT_SUBMITTED or closes its parent. No tail trimming, silent repair or history discard occurs.

The existing design's **explicit NOT_SUBMITTED exception is preserved**: a child can enter that terminal state only from PREPARED, with no transaction hash. That proves the journal protocol's prebroadcast gate was not crossed under its trusted-caller assumptions. Such a reservation can be reused after its parent is explicitly closed. This is not release because a receipt is unavailable, because a transaction reverted, or merely because an operation is closed. The old NOT_SUBMITTED record is retained and cannot transition back to a sending state. A focused compatibility control verifies this distinction. No automatic reuse/retry behavior was added.

A separate child with an already reserved nonce is rejected whether its proposed hash is identical or different. Modifying an existing child's signed identity or fees remains forbidden by the existing immutable-specification rules. **Deliberate same-nonce replacement has no identity model here and remains unsupported.** Resolving such observations must not overwrite the original identity or allocate a replacement implicitly.

## 3. Exact implementation changes and path coverage

| Changed path | Change |
|---|---|
| `mcp/journal-schema.js` | Keeps the existing parent-local transition validator private as `validateOperationChange()`. Exported `validateChange(old, next, wallet, operations)` now requires the complete wallet Map and checks both unique reservations and historical ordering after parent-local validation. Missing/mismatched context fails closed. No stored field, state transition or schema version was added. |
| `mcp/journal.js` | Passes the full validated operation Map at both operation-frame replay and the shared session write gate. Removes the old admit-only comparison to keep one policy for all paths. File creation, checksums, write/fsync ordering, owner tokens, locking and error classification remain unchanged. |
| `mcp/test/journal-nonce.test.js` | Six focused regression/control groups using disk-backed stores, restart, valid legacy frame chains and synthetic observations; no signing/provider imports. |
| This report | Root cause, policy, reproducible before/after evidence, validation and remaining gates. |

The shared gate covers **admit(), addChild(), every child transition and closeOperation()**, before any append. Replay calls the same validator before accepting an OP frame into its Map. Per-parent validation still enforces child count/kind/order, immutable IDs/intent/specifications and the allowed transition graph.

Live invalid requests return **NONCE_CONFLICT**, leave journal bytes unchanged and do not poison otherwise valid ownership. On-disk conflicting history is classified as **CORRUPT_STATE** through the existing loader. Inspection rejects it; acquisition rejects it before creating a new ownership file. If an active session encounters such history, its mutation fails, the capability is poisoned and its ownership file remains. Crash-lock and automatic-repair behavior is unchanged.

Schema version 1 and valid serialized records remain compatible. Previously conflicting records are deliberately rejected, with no migration or automatic repair. The internal exported validation helper now needs its wallet-context argument; both repository production call sites supply it. Store/session APIs and all five MCP tool names, successful response schemas and production execution code are unchanged. Old unfixed readers do not acquire these new guarantees; future installations must upgrade all cooperating journal writers/readers.

## 4. Regression evidence

The **exact final new test file** ran against an isolated copy of the base's `journal.js`, `journal-schema.js` and `package.json`: **1 passed, 5 failed**, all five failures reporting Missing expected exception. The passing group is an intentional compatibility control covering sibling rejection, valid sequential refuel/pay, repeated hash observations, restart, and the proof-based NOT_SUBMITTED exception. Against the repair, **all 6 pass**.

| Group | Coverage and result after repair |
|---|---|
| Original reopened-parent defect | Same-account/different-parent and different-account/different-contract contexts reject the confirmed nonce after real store/session close/reopen. A higher nonce remains usable under the same ownership. |
| Reverted/closed history | Both equal and lower nonce reuse reject against a newer reverted transaction in a closed parent. Closing/reopening does not release its nonce. |
| Sibling and sequential control | Reusing the refuel's own nonce rejects; sequential nonce 0/1 refuel/pay, UNKNOWN → SUBMITTED observation of the same hash, confirmed closure and restart remain valid. Fresh reuse of confirmed nonce 1 rejects; nonce 2 works. Explicit NOT_SUBMITTED reuse remains valid and old history is retained. |
| Historical replay | Correctly checksummed, chained legacy frames with duplicate PREPARED nonce reject, including the variant later marked NOT_SUBMITTED and ABANDONED. The base accepted both variants; an additional isolated base probe explicitly verified the latter. New inspection/acquisition reject without modifying bytes or acquiring a lock. |
| Live submission against bad history | An existing session's SUBMITTING attempt rejects conflicting legacy history during its guard read, before writing; the ownership file remains and the poisoned capability cannot release. |
| Shared SUBMITTING validator | Equal-nonce contexts individually valid in PREPARED, SUBMITTING, SUBMITTED, UNKNOWN, RECOVERY_REQUIRED, CONFIRMED and REVERTED states all reject. A stale nonce below a newer confirmed nonce rejects too. The same child's own identity is accepted. |

Negative paths assert **zero simulated signing and broadcast callbacks** and unchanged journal bytes where a public mutation is attempted. The boundary-validator group also asserts zero simulated callbacks. These counters demonstrate local admission ordering only, not actual transport semantics. Existing journal tests still supply real SIGKILL/process-restart and disk/fsync fault coverage; the new nonce tests use real store/session reopen without claiming new SIGKILL coverage.

The legacy-frame helper exists only in the test file. It writes complete checksum/hash-chain/seal fixtures to demonstrate a semantic validation defect, rather than a malformed-file rejection. It is not a production repair or takeover API.

### Reproduction commands

From this repair checkout, prepare a base implementation copy inside the authorized repository:

```sh
python3 - <<'PY'
from pathlib import Path
import shutil, subprocess
base = Path('work/phase5a2b2a-r1/base-mcp')
(base / 'test').mkdir(parents=True, exist_ok=True, mode=0o700)
for name in ['journal.js', 'journal-schema.js', 'package.json']:
    (base / name).write_bytes(subprocess.check_output([
        'git', 'show', 'adee45ff4827d90d959b0a9167b3f7d49de066f2:mcp/' + name]))
shutil.copy2('mcp/test/journal-nonce.test.js', base / 'test/journal-nonce.test.js')
PY
node --test --test-isolation=none work/phase5a2b2a-r1/base-mcp/test/journal-nonce.test.js
# Expected base result: exit 1; 1 pass, 5 fail (Missing expected exception).
node --test --test-isolation=none mcp/test/journal-nonce.test.js mcp/test/journal.test.js
# Repaired result: exit 0; 25 pass, 0 fail/skipped/cancelled.
```

Use the foundation's supported private Linux/local-filesystem path, not world-writable `/tmp`. The original harness retained in this workspace also ran before/after:

```sh
node work/phase5a2b2b/nonce-history-probe.mjs
# Base observer: exit 0, asserted conflicting CONFIRMED/SUBMITTING nonce 1 records.
node work/phase5a2b2b/nonce-history-probe.mjs --assert-safe
# Before: exit 1, Missing expected exception. After: exit 0.
```

The original observer deliberately asserts defective behavior and is not a repaired passing test. The committed six-group regression file is self-contained and does not depend on that uncommitted harness or on the separate local report commit.

## 5. R1 validation results (before JN2)

Reused Node **24.19.0**, Forge **1.7.1**, solc **0.8.28**, existing pinned dependencies. No installation or upgrade. Commands ran from repository root:

```sh
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2b2a01 -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
node --test --test-isolation=none mcp/test/journal-nonce.test.js mcp/test/journal.test.js
npm test --prefix substrate
node script/spending-view.test.cjs
node --check mcp/journal.js
node --check mcp/journal-schema.js
node --check mcp/test/journal-nonce.test.js
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

| Check | Actual result |
|---|---|
| Foundry build | Exit **0**; production runtime remains 9,757 bytes. |
| Full Foundry | **58 passed, 0 failed/skipped**, four suites; 1,000-run fuzz and 128-run / 16,384-call stateful invariant, zero handler reverts. |
| Full MCP | **67 passed, 0 failed/skipped/cancelled**: 42 existing integration tests, 19 existing journal tests and six new nonce groups. Existing integration fixtures use disposable localhost Anvil. |
| Focused persistence/nonce campaign | **25 passed, 0 failed/skipped/cancelled**. |
| Native / display | **24 / 10 passed**, zero failures/skips/cancellations. |
| Syntax / whitespace / scope | All three changed/new JavaScript files pass syntax checks; whitespace and exact four-file manifest checks pass. |
| Frontend build consistency | Existing `build.py` ran in an isolated copy under `work/phase5a2b2a-r1/build-copy/`, rebuilding simulation/native bundles with existing dependencies and the unchanged compiled artifact. Exit **0**, all generated outputs byte-identical, **zero generated differences**. Real website/ABI files were not rewritten. |
| Formatting | `forge fmt --check` exit **1** on pre-existing differences in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`; no formatting applied. |

Scratch logs, the original harness and isolated base/build copies remain uncommitted under `work/`. At the original R1 implementation delivery the branch was unpushed and no PR/CI run was claimed. Later publication verified **58 Foundry / 67 MCP** passes on head `1b890c932f17e6fb3e5d4906d05e5823c46b3af4` in both [push CI](https://github.com/Oziman13/allowance/actions/runs/40869335057) and [PR CI](https://github.com/Oziman13/allowance/actions/runs/40869527771). The newly reproduced JN2 discrepancy prevented merge despite that passing CI.

## 6. R1 delivery scope and original recommendation

Exactly four files change:

1. `mcp/journal.js`
2. `mcp/journal-schema.js`
3. `mcp/test/journal-nonce.test.js`
4. `docs/JOURNAL-NONCE-INTEGRITY-REPAIR-PHASE5A2B2A-R1.md`

No Solidity, ABI, existing tests, `mcp/lib.js`, `mcp/index.js`, package/lockfile, EIP-1559 fee behavior, frontend/generated site, CI, network/address or deployment configuration changes. The journal remains disconnected from production payment execution and its explicit package file allowlist remains unchanged. Existing untracked `lib/` and `work/` are excluded from the commit. No push, PR, merge, deployment, public-chain transaction, replacement support, retry, journal reset/repair or automatic lock takeover is part of this task.

**JN1 no longer blocks the reviewed local journal invariant. CONDITIONAL GO for a separately authorized, reviewed resumption of the Anvil-only broadcaster phase; NO-GO for enabling a broadcaster now or activating Portaldot V3.** Remaining gates:

- Review this repair and run remote CI when publication is separately authorized. Do not let older unfixed writers produce new conflicting history.
- A journal containing legacy conflicts now fails closed; no safe automatic migration/repair or orphan-lock recovery is provided. Preserve evidence and use a separately designed offline recovery procedure.
- Resolve the prior phase's intent-before-parameter-preparation representation requirement without guessed fields or unversioned new record meanings. No intent-only schema feature was added here.
- Implement and test local hash derivation, exact signed-envelope binding, fsync-before-send ordering, single-attempt transport behavior, bounded waits and exclusion of stale asynchronous sends. Those actual-broadcast campaigns remain unimplemented.
- Implement separately reviewed keyless reconciliation and action-specific event/receipt validation. Local journal observations are still trusted structural inputs, not verified finality or chain execution.
- Preserve the existing Linux/filesystem, trusted-user, same-host/same-store limitations. No protection against independent devices/external signers, valid whole-store rollback, hardware power loss, RPC dishonesty or historical unjournaled sends is added. The existing 8 MiB journal cap and full-history validation costs remain.

This repair establishes the tested local nonce policy. It does not establish comprehensive payment recovery, exactly-once execution or readiness for public funds.

## 7. JN2 — shared live/replay eligibility validation

### Scope, root cause and shared authority

JN2 starts from verified local and remote PR head **`1b890c932f17e6fb3e5d4906d05e5823c46b3af4`**, with `main` still **`adee45ff4827d90d959b0a9167b3f7d49de066f2`**. The exact PR review probes reproduced both blockers before changes:

- With A reopened as RECOVERY_REQUIRED and B PREPARED, normal B → SUBMITTING rejected UNRESOLVED_OPERATION; a complete checksummed equivalent OP frame was accepted by replay.
- After a confirmed refuel acquired a PREPARED pay child, later RECOVERY_REQUIRED evidence on the refuel made normal pay → SUBMITTING reject; replay accepted its equivalent OP frame.

The normal methods enforced eligibility before reaching the shared validator, so replay bypassed those rules. Replay's separate new-parent check did not cover child additions or SUBMITTING. Integrity checks, valid owner tokens and nonce uniqueness were insufficient to establish semantic eligibility.

`mcp/journal-schema.js:validateChange()` is now authoritative for both operation-local and history-dependent eligibility. The old method-level and replay-only OPEN-parent checks are removed from `mcp/journal.js`. The existing session write gate and replay OP loop both invoke the validator with the **verified operation Map immediately preceding the candidate frame**; replay updates its Map only after validation succeeds.

| Candidate change inferred from validated delta | Shared rule |
|---|---|
| New operation / admission | No other OPEN parent. |
| New child | No other OPEN parent; existing per-parent rules still require confirmed refuel, valid kind/order and increasing sibling nonce. |
| A child newly enters SUBMITTING | No other OPEN parent, and every earlier child in its preceding parent state must be CONFIRMED. |
| Contradictory evidence / reconciliation | Preserve the allowed immutable-identity transition graph. An older closed parent may reopen as RECOVERY_REQUIRED even if another parent is OPEN. Recording observations and resolving uncertainty remain possible. |
| Explicit prebroadcast abort / closure | NOT_SUBMITTED still requires PREPARED and no hash. Closure still requires settled children. Neither a timeout nor a missing receipt clears a hash-bearing nonce. Closing a resolved parent while another is OPEN remains valid. |
| Every accepted operation update | The unchanged JN1 wallet-wide nonce reservation and historical-ordering rules also apply. |

This is deliberately **transition-sensitive**, not a blanket prohibition on two OPEN parents or an unconfirmed refuel in a final snapshot. If submission was eligible before later contradictory evidence arrived, that historical submission remains valid; later observations must still be recordable. Conversely, a forbidden submission cannot be made valid by later resolving/closing the older parent. Each prefix is checked in order.

There are no new stored fields, state transitions, replacement identities, migration, automatic repair or lock-takeover paths. Checksums still protect accidental integrity only; they are not signatures or proof of historical authorization against a malicious same-user/root actor.

### Regression and before/after evidence

Added **five named JN2 groups** in `mcp/test/journal-eligibility.test.js`. The exact final file was tested against isolated copies of the expected PR head's two journal modules and package manifest: **2 passed / 3 failed**. The three failures show a fresh process accepting historical frames that its live writer rejected. The two passing controls preserve valid recovery and reject false NOT_SUBMITTED claims. With JN2, **all 5 pass**.

1. Other unresolved parent blocks SUBMITTING in live writes and replay, including a history whose later records resolve the conflict so the final snapshot would look acceptable.
2. A preceding refuel in RECOVERY_REQUIRED or REVERTED blocks payment SUBMITTING in both paths.
3. Admission and child creation use the same global OPEN-parent policy, including another parent with PREPARED, UNKNOWN or terminal NOT_SUBMITTED children whose parent remains OPEN.
4. Valid sequential refuel/pay, closed-parent reopening, multiple OPEN parents caused by new evidence, explicit prebroadcast abort and nonce reuse after its parent closes, same-hash observations, reverted history and fresh-session restart remain valid. A refuel becoming uncertain **after** an eligible payment submission does not retrospectively invalidate it or prevent observation updates; unresolved progress still prevents parent closure.
5. SUBMITTING, SUBMITTED, UNKNOWN, RECOVERY_REQUIRED, CONFIRMED and REVERTED cannot become NOT_SUBMITTED, even with TIMEOUT as the reason; correctly checksummed equivalent false-abort history rejects too.

Negative live paths assert unchanged journal bytes and **zero simulated signing/broadcast callbacks**. Invalid fixtures use complete checksums, sequences, active owner tokens and final seals; tests then start a separate, keyless Node process to read them. Rejection leaves fixture bytes unchanged, and the live session becomes poisoned when it reads corrupt history; its ownership file remains and cannot be automatically released. The test encoder is not a production repair API. All receipts and hashes are synthetic journal inputs, not actual chain confirmations.

The exact two original review observers now exit **1** because they deliberately asserted unsafe replay acceptance. The cross-parent observer prints `liveCode: UNRESOLVED_OPERATION`, `replayCode: CORRUPT_STATE`, `replayAccepted: false`; the refuel observer receives CORRUPT_STATE. That inversion is expected. The new rejection-based tests pass. The original JN1 `--assert-safe` reproduction still exits **0**.

One JN1 unit assertion is updated for deterministic combined-error precedence: when a candidate violates both another OPEN parent's eligibility and nonce uniqueness, the shared validator reports UNRESOLVED_OPERATION first. Closed-history cases still require NONCE_CONFLICT. All six groups and their zero-callback assertions remain; no rejected candidate becomes admissible.

### Live/replay distinctions and security boundary

- Live calls return a domain error without appending. Replay wraps any invalid semantic frame as **CORRUPT_STATE** and rejects the history. Error classification differs; accepted/rejected semantic eligibility does not.
- Live methods also validate caller arguments and look up IDs. OP records contain the resulting state delta, not the original method invocation text. Replay validates that delta as a permitted admission, child addition, child transition or closure under the preceding context; invalid live requests generate no OP frame to replay.
- Live ownership includes current OS/path/inode/lock checks. Replay checks the recorded OPEN owner/token and ordering but cannot attest past OS state. Accepted inspection grants no mutation authority: every future write still needs real exclusive ownership and the current guard. Crash ownership remains fail-closed.

These distinctions add no sending capability and do not exempt a persisted transition from shared semantic validation. The journal remains disconnected from `mcp/lib.js` and `mcp/index.js`.

### JN2 validation and exact changed paths

Commands from repository root, reusing Node 24.19.0, Forge 1.7.1, solc 0.8.28 and existing pinned dependencies:

```sh
node --test --test-isolation=none work/phase5a2b2a-r2/before-mcp/test/journal-eligibility.test.js
# Isolated expected PR head: exit 1, 2 pass / 3 fail.
node --test --test-isolation=none mcp/test/journal-eligibility.test.js mcp/test/journal-nonce.test.js mcp/test/journal.test.js
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2b2a02 -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
npm test --prefix substrate
node script/spending-view.test.cjs
node --check mcp/journal.js
node --check mcp/journal-schema.js
node --check mcp/test/journal-nonce.test.js
node --check mcp/test/journal-eligibility.test.js
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

The isolated baseline was prepared like section 4's base copy, using `git show 1b890c932f17e6fb3e5d4906d05e5823c46b3af4:mcp/<file>` for `journal.js`, `journal-schema.js`, `package.json`, and copying the final JN2 test file into its `test/` directory. No working production files were swapped/reset for differential testing.

| Check | Actual local result |
|---|---|
| Complete Foundry | **58 passed**, zero failed/skipped; 1,000-run fuzz and 128-run / 16,384-call invariant, zero handler reverts. |
| Complete MCP | **72 passed**, zero failed/skipped/cancelled: 42 integration, 19 original persistence, six JN1 and five JN2 groups. |
| Focused journal campaign | **30 passed**, zero failed/skipped/cancelled. |
| Native / display | **24 / 10 passed**, zero failures/skips/cancellations. |
| Build / syntax / whitespace / scope | Passed; runtime remains 9,757 bytes. Isolated `build.py` rebuild with existing dependencies/artifact produced byte-identical generated assets, zero differences; real frontend/ABI assets were not rewritten. |
| Formatting | Existing failure in the same three unchanged Solidity/test files listed in section 5; no formatting applied. |

The JN2 commit and the cumulative PR diff touch exactly these **five** files:

- `mcp/journal.js`
- `mcp/journal-schema.js`
- `mcp/test/journal-nonce.test.js`
- `mcp/test/journal-eligibility.test.js`
- `docs/JOURNAL-NONCE-INTEGRITY-REPAIR-PHASE5A2B2A-R1.md`

No Solidity, ABI, frontend, deployment/network/CI configuration, address, dependency, existing tool contract or live payment implementation changes. Scratch probes/logs and isolated copies stay uncommitted under `work/`; existing untracked `lib/` is excluded. GitHub CI for the final pushed head is verified separately in draft PR #18 and the delivery response; the table above records local validation, not a claim about an unobserved future CI run.

**JN1/JN2 now pass the scoped local regressions. PR #18 stays Draft and must not merge in this phase. Broadcaster activation remains NO-GO.** Review and remote CI of this head remain publication gates. A separately authorized future phase still needs the intent-persistence design, actual signing/hash/envelope and transport gates, bounded confirmation/reconciliation, deployment-storage qualification and external-writer policy. Legacy invalid histories and orphan locks fail closed; no automatic recovery is provided. Whole-store rollback detection, independent finality, exactly-once purchases and hardware power-loss guarantees remain outside this repair. No additional security-sensitive inconsistency was found in the scoped implementation and regression review.
