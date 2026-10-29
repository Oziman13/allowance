# Phase 5A-2B-2D-2 — keyless operator packet (local-only)

**Base:** `86cfdb53ed2c37b641e76b64ec74672fc348687f`. Design predecessor: [Phase 5A-2B-2D-1](OPERATOR-RECOVERY-DESIGN-PHASE5A2D1.md).

**Decision: CONDITIONAL GO for code review and local Anvil-only operator inspection. NO-GO for production MCP integration, crash-lock takeover, Portaldot V3, resubmission or automatic recovery.**

## Implementation

`mcp/local-operator.js` exports `createLocalOperatorPacket({ mode: "anvil-journal", state, wallet, io? })`, which exposes only `inspect()`. It imports the existing strict `openReader` and journal schema validation, not the signer or RPC transport. It never calls `openStore`, `acquire`, `release`, `transition`, sends a transaction or issues an RPC request.

Each snapshot returns a versioned local evidence packet with wallet/chain identity, operation IDs and statuses, immutable intent fields, child state/nonces, original hashes, historical receipts, candidate classification, recovery reason and the journal-observed timestamps and policy. It deliberately does not include private keys, full journal filesystem paths, serialized signed transactions, RPC credentials, arbitrary error messages or raw memo text.

The packet separately labels the recorded `ownerOpen` flag and observed `owner.lock` file presence; these are snapshots, **not proof of process liveness or permission to take over the lock**. An unsafe lock inode/type/link count is reported as `UNSAFE`; other I/O errors propagate instead of producing a clean report. A digest of canonical packet data provides a deterministic comparison fingerprint, **not** a trusted timestamp, rollback protection or authenticity signature.

`CONFIRMED` is labeled historical and never presented as verified V3 finality. `RECOVERY_REQUIRED`, uncertain children, missing parent closure or an unverified candidate produce explicit risk flags. Every packet has `nextAction: HUMAN_REVIEW_ONLY`; there is no executable unlock/retry/success disposition.

## Validation

New real-Anvil test embedded in `mcp/test/reconciliation.test.js` checks:
- Keyless packet from a previously submitted and historically confirmed payment;
- Deterministic fingerprint across unchanged snapshots;
- Journal bytes unchanged, no RPC calls and zero additional broadcasts;
- No private fixture key or local state directory leaked into the packet;
- Live owner acquisition causes owner-open and lock-presence indicators separately;
- Releasing the owner returns lock observation to absent;
- No instruction to resume, pay or repair.

The full pre-phase baseline was **58 Foundry / 106 MCP**, with 24 native and 10 display in the preceding local review. The new CI must independently validate the expanded MCP suite. No test counts are claimed here before that run completes.

## Explicit limitations and release gates

- Only Linux/local environments and the provisioned 31337 Anvil journal identity are in scope. The packet is **not** an operator unlock tool or independent finality prover.
- A lock file may change immediately after inspection; the packet provides no lease, fencing or writer authority.
- The journal's full-store rollback, supported-local-filesystem and crash ownership limitations remain.
- Historical receipts/candidate identities are supplied by the journal's validated format, not freshly checked against an external chain. Use the separately bounded keyless reconciler for a current *observation*, and do not equate one observation with finality.
- Existing production `mcp/lib.js`, `mcp/index.js`, Solidity, ABI, dependencies, published package allowlist and deployment configuration remain untouched.
- Parent refuel/pay closure, candidate multi-hop lineage, manual crash-lock recovery and V3 qualification are **separate NO-GO gates**.
