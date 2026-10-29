# Phase 5A-2B-2D-1 — operator recovery and compound-payment disposition design

**Date:** 29 October 2026 (Europe/Istanbul)  
**Repository:** `Oziman13/allowance`  
**Base:** `c90e733f862294fb78dd1407d247dbcc250c7499`  
**Status:** design-only; **NO-GO for automated journal unlock, retry, broadcaster activation, Portaldot V3 funds or production MCP integration**. This is an internal engineering specification, not a security audit or tested production feature.

## Decision

The existing journal (JN1/JN2), isolated journal-gated Anvil broadcaster, bounded confirmation and keyless reconciliation are now code-reviewed and merged into `main`. They do **not** implement crash-lock takeover, wallet-wide distributed fencing, parent disposition or multi-candidate replacement resolution. Keeping the wallet blocked after uncertainty is an intentional safety property. No deadline expiry or missing transaction receipt authorizes nonce reuse or payment resubmission.

The next safe deliverable is a **local, keyless, read-only operator review packet**: assemble journal records, immutable identities and bounded RPC observations without signing, modifying files or transferring control of the wallet. An unlock/write operation is **not** authorized by this document.

## 1. Source-of-truth and trust model

**Identity:** `chainId + genesisHash + wallet + journalId + storeId + contract + accountId + immutable parent intent + child transaction nonce + locally signed hash + verified candidate hashes`.

**Journal protocol:** `journal.js` persists sealed, chained records and per-wallet `owner.lock` with inode/token checks. `#load` validates every historical OP transition through shared JN1/JN2 validation. `acquire` refuses existing lock (`WALLET_BUSY`) or uncertain prior owner (`OWNERSHIP_UNCERTAIN`). The current code has **no** safe automatic stale-lock cleanup, lease, distributed coordinator or hardware-proof of fsync durability. A valid history replay is not proof against a full-store rollback by the same-user filesystem adversary.

**Scope:** one honest, cooperating wallet writer on one supported local host and one journal store; configured localhost Anvil RPC for current experimental code. External hardware wallets, browser wallets, multiple computers, network drives and independently signing processes are outside the exclusivity model.

**Evidence tiers** (do not collapse):
1. *Local intent/signature:* immutable intended call, nonce and precomputed signed hash.
2. *Transport observation:* network accepted a raw envelope, timed out or gave no acknowledgement. A timeout is NOT non-submission.
3. *Chain observation:* signed transaction/receipt/logs against the configured RPC, exact event/account/amount/memo identity, canonical block observations. RPC content may be stale or incomplete.
4. *Durable operator decision:* only after eligibility, ambiguity, candidate lineage, owner fencing and explicit approval have been separately validated. **Not implemented.**

## 2. Read-only review packet — initial implementation scope

A process without signing keys may generate a **local** JSON/text report containing:

- Immutable wallet, chain, journal and contract identity (no keys, tokens, raw signed bytes, private paths or unrestricted exception strings).
- Parent operation ID, scoped allowance account ID, intent type and amount in raw units.
- Each child kind (`refuel`, `pay`, `cancel`), child ID, nonce, original signed hash and state; preserve ordering.
- Owner-open and lock-presence observations **as two independent facts**. Never infer an owner is dead from PID, mtime, timeout, process name or a missing socket.
- Journal replay/ownership errors, corruption or missing files as an explicit **BLOCKED / INSUFFICIENT_EVIDENCE** report, never a green status.
- Known candidate hashes with `UNVERIFIED` vs verified historical classifications, and the associated event and receipt evidence.
- Confirmation policy, RPC endpoint identity and observed-at timestamps; differentiate recorded historical success from present canonicality.
- Parent-level disposition suggestion: `REVIEW_ONLY`, `WAIT_FOR_EVIDENCE` or `ESCALATE_OPERATOR`. Do not emit an executable "retry"/"unlock"/"settle" action.
- A deterministic report fingerprint and format/schema version for human review, while clearly stating the fingerprint is NOT a secure trusted timestamp or a rollback defense.

The packet is output only; exporting it must not create, modify, rename, chmod, unlink or lock the journal or wallet directory. A CLI exit code should distinguish complete observation, incomplete RPC history, unsafe journal, and explicit recovery hold.

## 3. Decision matrix (conservative)

| Durable child state or observation | Permissible read-only conclusion | Forbidden automatic action |
| --- | --- | --- |
| `PREPARED`, no signed hash | No completed payment proven. Prove non-submission under existing strict rules before any later decision. | Treat an RPC miss as `NOT_SUBMITTED`; allocate a new nonce automatically. |
| `NOT_SUBMITTED` with validated PREPARED proof | Historical non-submission under recorded protocol; only the existing narrow nonce release exception. | Retroactively change proof or infer another child is settled. |
| `SUBMITTING` | Hash already committed; broadcast may or may not have occurred. | Delete lock, reuse nonce or resubmit without independent authority. |
| `SUBMITTED` | Submitted hash known; settlement still must be established. | Assume paid from transport acknowledgement. |
| `UNKNOWN` | Outcome uncertain; original identity retained. | Re-sign or retry a business payment. |
| `CONFIRMED` / `REVERTED` | **Historical** verified receipt/event or revert at a particular block and policy. | Claim independently qualified V3 finality; ignore newer reorg evidence. |
| `RECOVERY_REQUIRED` | Hold for operator; preserve every original/candidate identity; report conflicting evidence. | Promote to PAID solely from a fresh read, silently close parent or override candidate. |
| Known `UNVERIFIED` replacement candidate | An operator supplied/observed a possible hash, **not a proven transaction**. | Consider it equivalent or successful; free original nonce. |
| Verified different-call or cancellation candidate | Observe separately with exact signer/nonce/receipt; original payment cannot be presumed completed. | Retry original intent without explicit safe design. |
| RPC missing history / transport 429 / unavailable archive | `INSUFFICIENT_EVIDENCE`; historical data may be pruned or stale. | Treat missing receipt as failure or non-submission. |
| Corrupt/rolled-back/unsafe journal, uncertain lock | `BLOCKED`; preserve all bytes and prevent writes. | Auto-repair, reset, truncate, clean lock or reconstruct from an operator guess. |

## 4. Parent refuel/pay disposition

A parent may have up to two ordered children: `refuel` then `pay`. Contract-side effects and wallet gas/native balances must **not** be conflated.

- Refuel `CONFIRMED`, pay `PREPARED`: gas-wallet transfer may have occurred; client payment did not necessarily occur. Do not declare the parent paid or refund by assumption.
- Refuel `CONFIRMED`, pay `SUBMITTING/SUBMITTED/UNKNOWN`: retain each hash, nonce and separate event proof; parent stays open.
- Refuel `RECOVERY_REQUIRED`: do not admit/submit pay solely because another provider reports a refuel receipt.
- Pay `CONFIRMED`: require exact `Paid` or `PaymentHeld` event; a hold is a request, not service/provider payment. A later owner approval is a separate contract transition.
- Refuel `REVERTED` or `NOT_SUBMITTED`: do not silently infer whether pay could execute; require the actual pay child state and independent evidence.
- Any verified replacement/cancellation: track per child; a cancellation of a refuel does not cancel the pay intent, and vice versa.

**No automatic parent closure**, child resume, escrow settlement, refund, pay retry or agent top-up follows from these observations. Changes to the journal transition schema require separate audit and disk-backed replay tests.

## 5. Crash-lock ownership handoff — separate protocol required

Never infer that an `owner.lock` is abandoned merely from age, PID, OS process enumeration, network inactivity or failed RPC. There may be suspended writer continuations, reused PIDs, external wallet signers, host restarts or inconsistent storage.

A future proposal for manual ownership handoff MUST establish:
- An explicitly documented trust boundary limited to one controlled host/wallet/journal store.
- Stronger, enforceable writer fencing so the previous owner cannot issue a late broadcast after handoff; no ability to prove fencing = **NO-GO for takeover**.
- Atomic/fsynced durable handoff history with fresh ownership generation and preservation of all earlier OP/OWNER records, and rejection on replay of stale generations.
- Independent integrity and original/candidate-hash reconciliation checks before any change to admission rights.
- Explicit human confirmation linked to the exact wallet/journal generation and review packet; no universal "unlock all" switch.
- SIGKILL, stale async continuations, lock inode swaps, symlinks/hardlinks, directory replacement, permission changes, disk-full/torn writes and repeated crash tests.
- No automatic signing or sending as a side effect of the ownership repair operation.
- Strongly documented cases where safe recovery is impossible (external writer, uncertain filesystem, corrupted history, prior journal rollback), with the wallet remaining blocked.

This document does not implement or authorize such a handoff.

## 6. Required deterministic fault and regression campaign

1. Keyless report on clean and mixed child histories; no signing, broadcasting or journal-byte change.
2. Original and replacement hash lineage present, including `UNVERIFIED` candidate; never claim verified equivalence from a supplied hash.
3. RPC missing receipt, 429, mismatched transaction, wrong event, invalid block, reorg and unavailable historical state; conservative outcome.
4. Crash at every journal write/fsync boundary; report detects incomplete/corrupt/ownership-uncertain state and never repairs it.
5. Parent with successful refuel but failed/unknown pay, and parent with held pay vs direct Paid; no false settlement.
6. Same wallet with multiple allowance accounts and historical nonce reservations; JN1 and JN2 remain enforced.
7. Changed journal during async review (child state, parent closure or another candidate); no stale success.
8. File/path permission and inode attacks, process restart, double-reader and concurrent writer attempts.
9. Negative tests check journal bytes, signing callback count and `eth_sendRawTransaction` attempts, not merely the returned error.
10. Full Foundry/MCP/native/display suites; compare features and CI with the previous merged base; no unrelated changes.

## 7. Staged delivery and release gates

**2D-1 (this PR):** reviewed design and acceptance criteria only; no production code.  
**2D-2:** *read-only operator packet* implemented behind an explicit local-only CLI/library, no wallet key; fault-tested.  
**2D-3:** *parent/child disposition model* design and offline tests, no automatic mutation or retries.  
**2D-4:** *crash ownership repair feasibility* audit-only; any locking/fencing design needs separate threat review before code.  
**2D-5:** *Portaldot V3 compatibility and finality* independently verified with target runtime/RPC evidence, without presuming old whitepaper/repositories match live V3.

Production integration, automatic retries, distributed nonce authority, exactly-once business purchases, guaranteed wall-clock deadlines under blocked filesystem calls and hardware-power-loss durability are **NO-GO** under current evidence.

## Change and provenance

This file is a documentation-only follow-up to PR #20, including the C2-R1/C2-R2 repaired regressions. No new tests are claimed by this phase. A GitHub CI green result for a docs change is not proof that operator recovery has been implemented.
