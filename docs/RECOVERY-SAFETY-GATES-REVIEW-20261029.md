# Recovery safety gates — independent review (29 October 2026)

Repository: Oziman13/allowance. Base main: `99fb877b695e01e0bd82ebffb5c6403f246a2e4d`.

**Status: review-only; NO-GO for Portaldot V3 or production MCP broadcaster activation.**
This note is separate from draft PR #20 and must not be interpreted as a tested repair, independent audit certificate, or authorization to merge. No code, RPC, blockchain or deployment mutation is made here.

## Confirmed PR #20 blockers

Review anchor: https://github.com/Oziman13/allowance/pull/20#issuecomment-6499911707

**C2-R2: stale positive observation.** The PR head `93b0bb7a5158aa6fa7d1012fcf54c724532ae6e0` uses a reconciliation stability check that compares the immutable intent/spec/hash but omits mutable child state and recovery evidence. An in-flight RPC read can then return `CONFIRMED/PAID` after a different journal writer recorded contradictory `RECOVERY_REQUIRED` evidence, including a cancellation. Acceptance: compare the newest authorized snapshot/revision at the return boundary; if child state, receipt, recovery reason, or known replacement history conflicts, return a conservative uncertainty with all known identities. Preserve keyless read-only semantics. Also consider a later RPC response arriving after a deadline, no stale writes, and no invented finality.

**C2-R1: unpersisted replacement candidate.** The candidate hash is first observed in memory and a candidate RPC lookup can fail. The coordinator currently saves an UNKNOWN observation without the candidate. A restart then forgets the supplied replacement. Acceptance: persist candidate identity under the journal writer capability **before** an error-prone lookup where possible, or durably record the candidate on all error/timeout branches; distinguish UNVERIFIED from a verified equivalent call, different call or cancellation. Never infer successful payment merely from a nonce increment or provided hash.

## Regression matrix — required before PR #20 merge

1. Exact C2-R2 fixture: delayed canonical response, local reorg, confirmed same-nonce cancellation, newer journal RECOVERY_REQUIRED. Assert no stale PAID and report both original and cancellation candidates.
2. Exact C2-R1 fixture: accepted replacement and failed candidate hash lookup. Assert persisted UNVERIFIED candidate survives reader restart; original hash/nonce remain reserved.
3. Concurrent reconciliation and journal-owned confirmation, including candidate arriving between the initial and final snapshot; no lost evidence.
4. RPC timeout and abort after obtaining the candidate but before validation; no candidate loss.
5. Prior CONFIRMED evidence contradicted by newer reorg evidence: reconciliation must not claim irrevocable finality.
6. Malformed/wrong-chain candidate, different sender/nonce, and unexpected call: never classify as matching payment.
7. Journaling/fsync failure: fail closed; do not report persistence as successful, do not enable retry.
8. Read-only keyless mode: journal bytes unchanged, no signing or broadcast.
9. Prior JN1/JN2 nonce/replay and 12 isolated broadcaster groups stay green.
10. New test assertions must fail on the pre-repair PR head and pass after the repair. Standard green CI alone is insufficient.

## Recovery design boundaries for subsequent phase

**Operator recovery is a distinct phase and should be audit-first.** Safe recovery requires an evidence-based decision table per child and parent transaction. Track original hash, nonce, chain/genesis/wallet/contract/account binding, replacement candidates and their verification status, canonical receipt/event evidence, last observation time and any contradiction.

- `PREPARED`: do not assert non-submission unless the system positively establishes that signing and broadcast never happened. Existing proved `NOT_SUBMITTED` exception must not expand.
- `SUBMITTING`, `SUBMITTED`, `UNKNOWN`: no automatic nonce reuse, resubmission, or closure on missing receipts, elapsed time or RPC errors.
- `CONFIRMED` or `REVERTED`: preserve historical evidence; reconsider when canonical history changes; one Anvil confirmation is not independently verified Portaldot V3 finality.
- `RECOVERY_REQUIRED`: preserve original/candidate identities and require bounded read-only inspection. A candidate may be unverified, a cancellation, a different call or an equivalent call; none may be silently assumed successful.
- Refuel/pay: persist and classify each child independently. A confirmed refuel is not proof that pay was signed, submitted or settled. Do not mark parent settled from one child alone.
- Crash ownership: locks are intentionally fail-closed. **Never remove a stale lock solely by timeout or process ID** without independently established process termination, journal continuity, wallet exclusivity and a documented manual authorization protocol. External wallets and remote writers are outside current trust model.
- Avoid conflating technical transaction exactly-once behavior with exactly-once business purchase semantics; duplicate independent MCP requests may still cause multiple payments.

## Portaldot V3 gate

No public-chain signing, submission or deployment is authorized by this note. Verify current V3 EVM/revive transaction semantics, event ABI, native POT fee/storage behavior, canonicality/finality and RPC retention on approved endpoints before connecting production handlers. The existing older whitepaper/repositories cannot substitute for a live-V3 compatibility proof.

## Delivery policy

Leave PR #20 Draft until both reproduced defects are fixed, permanent regressions run, reviewer independently inspects the diff and CI is green. Keep this review branch separate to avoid overwriting Codex's uncommitted work. No auto-merge.
