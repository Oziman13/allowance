# Phase 5A-2A — MCP fail-closed reliability hardening

Date: **29 October 2026, Europe/Istanbul (UTC+03)**. Base: **`187d0212db4550bf85fdf47a059a3961d83186e4`**, fetched from `origin/main` and independently matched with `git ls-remote`. Branch: **`codex/allowance-reliability-hardening-phase5a2a`**.

Implements only R1, R4 and R5 from the [Phase 5A-1 internal audit](RELIABILITY-GAP-AUDIT-PHASE5A1.md). This is an internal implementation/validation record, **not an independent security audit or a production-funds certification**.

**Recommendation: CONDITIONAL GO for review and supervised testnet use of these three fixes.** All required local suites pass. Broader transaction recovery, duplicate/concurrent operation handling and target-runtime validation remain open. No PR, push, main merge, deployment or public-chain transaction is included in this delivery.

## Root causes and exact changes

| Finding | Before | After / affected production path |
|---|---|---|
| **R1: guessed ERC-20 decimals** | `account()` caught any `decimals()` failure, substituted 18 and cached it. An honest six-decimal token could receive the wrong raw amount while the client displayed the guessed denomination. | `mcp/lib.js:93–110`, `initMeta(asset)`, requires a successful, canonical 32-byte metadata response and a supported integer value before initializing metadata. Failure throws an explicit token-address-specific error; no guessed/partial metadata is cached. Subsequent independent calls can recover when the read succeeds. |
| **R4: cold held-request lookup** | `request()` called `fmt` without initializing `meta`; a restarted client's first lookup threw a TypeError unless another operation had initialized it. | `mcp/lib.js:218–224` fetches the configured account's asset and initializes metadata as needed using read-only calls before formatting. It preserves pending/approved/rejected/cancelled status and the existing output fields. No prior status, preview or payment call is needed. |
| **R5: cancellation account isolation** | Request lookup rejected another account's global request ID, but cancellation sent that ID directly. A key controlling two allowances could cancel the other allowance's hold through the wrong configured client. | `mcp/lib.js:212–215`, `scopedRequest`, compares the returned account ID with the configured ID using BigInt. Both lookup and cancellation use this helper; cancellation checks scope before fee estimation/signing/submission (`:227–231`). Contract authorization remains authoritative. |

### Metadata handling and exact amounts

The existing native POT path still uses the configured native symbol and 18 decimals; it does not perform ERC-20 metadata calls. ERC-20 initialization now reads the raw result of the same `decimals()` selector through the existing provider. It does not change any ABI file or on-chain method.

Raw validation matters with pinned ethers **6.13.4**: its `uint8` ABI decoder masks high bits. A noncanonical value such as 262 can otherwise appear as 6. The client checks the complete response before such narrowing, rejects empty/truncated/overlong data, and accepts decimal counts **0 through 80**. The upper bound comes from the existing ethers `formatUnits`/`parseUnits` implementation; it is a client conversion limit, not an on-chain asset allowlist. Values 81–255 are valid uint8 encodings but unsupported for this client's conversion functions. They now fail explicitly before spending instead of reaching a later conversion error.

Only a fully initialized metadata object is cached. Failed reads leave it unset; recovery requires a later user/client invocation, **not an automatic retry or resend of the payment**. Previously validated metadata is still cached for the client lifetime. This change does not add monitoring of token upgrades or changing/malicious decimals, and it does not establish RPC/token honesty.

The existing symbol fallback `TOKEN` remains a display placeholder. It neither authorizes an asset nor proves its identity. A missing symbol does not excuse missing decimals. Verify the configured account's actual token address and use the existing [asset policy](../SECURITY.md#supported-assets); no token allowlist or net-delivery guarantee was introduced.

Amount conversion remains `ethers.parseUnits(String(x), meta.decimals)` and BigInt accounting; no floating-point amount arithmetic was introduced. Exact decimal **strings** retain their precision: `"1"` becomes 1,000,000 raw units for the six-decimal fixture and `"0.000001"` becomes one raw unit. Excess nonzero fractional precision is rejected. The existing numeric MCP input option is preserved for compatibility; a JavaScript number may already have been rounded before it reaches the client, so precision-sensitive callers should send strings.

### Request and authorization boundaries

Unknown IDs still produce the contract's `UnknownRequest`, translated by the existing MCP error formatter to “No request with that id exists.” Wrong-account IDs retain the existing “another allowance” error. Lookup remains a public read of the configured account's request; its initialization deliberately does not introduce an agent-authorization requirement into a previously public read.

Cancellation does not depend on token metadata or use the formatted request response as its guard. It therefore does not gain an unnecessary decimals/symbol prerequisite. It still uses the existing contract call/fee path, which rejects revoked keys during estimation and rechecks authority on execution. Correct current-agent cancellations remain available while frozen or expired. This is a client account-scope check, **not** a new contract privilege or a security boundary against a key calling another account directly under its existing authority.

The extra read is not a reservation: another actor can resolve the request or rotate the agent afterward. Existing execution-time checks still decide the result. No request state, allowance policy, owner approval behavior or spending limit was changed.

## Focused regressions and before/after evidence

New file: [mcp/test/reliability.test.js](../mcp/test/reliability.test.js). It uses existing compiled Allowance and six-decimal `MockERC20` artifacts on disposable localhost Anvil. Only metadata call responses are mocked. A forwarding broadcast counter observes all client transaction submissions; negative checks also inspect nonce, request state/count, recipient balances or complete decoded account snapshots as appropriate. Native and token fixtures use disposable test accounts, including the public standard Anvil owner fixture, never real owner secrets.

| Regression | Evidence and acceptance checks |
|---|---|
| **R1**, test beginning at line 57 | On the same cold six-decimal client, RPC rejection, empty data, truncated data, high-bit value 262, unsupported decimals 81 and overlong return data each reject pay and preview. **Zero broadcasts**, unchanged nonce, account ledger, recipient balance and request count. After a real valid metadata read, excess precision still submits nothing; `"1"` delivers exactly **1,000,000** raw units and `"0.000001"` another **1**. Remaining budget formats as `8.999999 mUSD`. Missing symbol plus missing decimals still rejects; later valid units with missing symbol show `8.999999 TOKEN` without guessing units. |
| **R4 native and ERC-20**, two tests beginning at line 113 | Each of pending, approved, rejected and cancelled requests is read as the **first operation of a newly created client**, with exact amount, memo, recipient, reason and unchanged response keys. Unknown IDs produce the clear existing error. Lookups cause **zero broadcasts**, unchanged wallet nonce and unchanged full account data. |
| **R4 MCP server**, test beginning at line 139 | A fresh stdio MCP server's first tool call is `allowance_request` for the six-decimal account. It returns `2 mUSD`, pending, the correct ID and exactly the existing six response keys; no status call or wallet transaction is required. |
| **R5**, test beginning at line 158 | Two allowances share one agent key. Client A rejects lookup and cancellation of B's request; unknown cancellation also fails. No broadcast/nonce change, and B's request remains pending. Correct-account cancellation works; B's current agent can cancel while frozen and separately while expired. After rotation, the old agent is rejected with **zero additional broadcasts** and the hold remains pending; the funded local replacement agent can cancel it. |

Before production edits, all **five** new tests failed against the base: R1/R5 with missing expected rejection, both cold-client tests with the undefined-decimals TypeError, and the stdio test with the same failure through MCP. Afterward, the **exact final test file** was replayed against an isolated scratch copy of base `lib.js`, `index.js`, ABI and package metadata, with links to unchanged artifacts/dependencies: **0 passed, 5 failed**, exit **1** for the same defects. The fixed full MCP run passes **42/42**, including all five new tests and the original 37 unchanged tests.

During test development, ethers `Result` wrapper identity prevented direct deep comparison of otherwise equal account snapshots. The assertions were corrected to compare their complete recursively decoded arrays (`toArray(true)`), retaining the full unchanged-state check. This was a test representation issue, not an additional production defect or a weakened assertion.

No duplicate permutations were registered as additional tests: the malformed metadata variants and terminal request states are assertions within five focused regressions. Existing tests and assertions were not edited.

## Actual commands and validation results

Reused tooling: Forge **1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), solc **0.8.28+commit.7893614a.Linux.g++**, Node **24.19.0**, ethers **6.13.4**, and existing project dependencies. No installation or dependency/lockfile change. CI config still selects Node 22; the following are **local results**, not newly executed GitHub CI. The existing MCP test glob automatically discovers the added file; CI was not modified.

From the repository root, using the existing tools in this workspace:

```sh
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2a -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
npm test --prefix substrate
node script/spending-view.test.cjs
python3 build.py
node --check mcp/lib.js
node --check mcp/index.js
node --check mcp/test/mcp.test.js
node --check mcp/test/reliability.test.js
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

| Check | Actual result |
|---|---|
| Foundry build with sizes, unchanged Solidity | **Exit 0**, existing lint warnings retained |
| Complete Foundry, seed `0x5a2a` | **58 passed, 0 failed/skipped**, exit 0; four suites |
| Included native fuzz | **1,000 runs**, passed |
| Included stateful campaign | **128 runs × depth 128 / 16,384 calls**, zero handler reverts; invariant and deterministic handler-coverage test passed |
| Complete MCP | **42 passed, 0 failed/skipped/cancelled**, exit 0; original 37 + five focused regressions |
| Native read-only units | **24 passed, 0 failed/skipped/cancelled**, exit 0 |
| Spending-display units | **10 passed, 0 failed/skipped/cancelled**, exit 0 |
| Existing frontend build | **Exit 0**, HTML and pinned simulation/native bundles rebuilt; hashes of all seven generated/copied assets match their pre-build bytes; no generated changes |
| JavaScript syntax | Four commands above passed |
| `forge fmt --check` | **Exit 1**, pre-existing formatting in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`; no formatting applied |
| Report links, final whitespace and protected scope | Passed; only the three files below change |

Raw local logs remain excluded under `work/phase5a2a/`. Representative final summaries:

```text
Exact final new tests on base: tests 5, pass 0, fail 5; exit 1
Fixed complete MCP: tests 42, pass 42, fail 0, cancelled 0, skipped 0
Foundry: 58 tests passed, 0 failed, 0 skipped (58 total tests)
Native units: tests 24, pass 24, fail 0, cancelled 0, skipped 0
Display units: tests 10, pass 10, fail 0, cancelled 0, skipped 0
```

Focused reproduction against the fixed branch is `ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil node --test mcp/test/reliability.test.js`; those five tests were also executed in the complete passing suite. The red replay used `node --test work/phase5a2a/baseline/mcp/test/reliability.test.js` after copying the final regression file and base MCP files there, linking that scratch root's `out` and `mcp/node_modules` to the existing build/dependencies. Production files were never switched back during red replay. Test ports **8546** (existing suite) and **8547** (new suite) must be free. No new RPC service is used outside localhost.

Browser/performance suites and static scanners were not rerun: frontend, Solidity, ABI, native implementation and their configuration are unchanged; those suites would not establish these MCP metadata/request guarantees. Live Portaldot compatibility was not exercised in this phase. The earlier [network verification blocker](RELIABILITY-GAP-AUDIT-PHASE5A1.md#environmental-verification-blocker) remains unresolved; no fresh live-RPC success or current runtime/fee claim is made.

## Compatibility and protected scope

- All **five MCP tool names, input schemas and successful response fields** remain unchanged. `mcp/index.js` is untouched. Status, preview, pay, refuel, fee and transaction-confirmation logic retain their existing bodies; shared metadata initialization supplies validated units. Valid native and standard-token outputs retain existing formatting. The new stdio regression explicitly checks request response keys.
- Intended failure behavior changes: metadata that previously fell back, narrowed invalid data or failed later now rejects early; cold valid lookup succeeds; wrong-account cancellation stops before signing/submission. This is compatible for valid supported inputs, while callers relying on guessed/noncanonical metadata or cross-account cancellation must correct those operations.
- Cancellation adds one read-only `getRequest` before the existing write path. Cold lookup adds a read-only account/metadata initialization. These are the existing deployed selectors with the same EVM provider/network settings, not new runtime APIs or contract methods.
- Successful metadata remains cached, with no new retries, payment recovery journal, nonce queue, owner power, invoice registry, asset allowlist or changed spending limits. No automatic transaction retry was added.
- `src/`, contract tests, all ABI files, network IDs/addresses, configuration, deployment scripts, native code, frontend/source/generated assets, CI and dependencies/lockfiles match the base. Existing untracked `lib/` and `work/` remain excluded. Contract source hash remains `3a84a84647c051aa2015316d86ffbf70777ae824932fe7e9c5ad875a7df27474`.

## Remaining Phase 5A-2B work and limitations

1. **R2 — submission/recovery:** accepted-but-unacknowledged broadcast can still lose the returned hash; confirmation still has no application deadline or durable restart recovery. Earlier successful refuel progress can still be absent from a later parent error. Do not resend an uncertain payment automatically. Measurable next benefit: retain operation/hash/phase and partial progress, return bounded unknown/pending, and reconcile without creating another payment.
2. **R3/R6 — duplicate intent and concurrency:** repeated calls still produce separate transactions/holds; concurrent writers can collide on wallet nonces. No exactly-once invoice guarantee follows from this patch. Measurable next benefit: define stable intent binding and supported same-wallet writer coordination, with restart/concurrency tests and explicit legacy limitations.
3. **R7 — nonpayment event verification:** refuel/cancel confirmation still uses the existing receipt-status logic; strict matching-event additions were outside the three authorized fixes. Existing pay matching for contract/account/recipient/amount/memo and no-retry tests continue to pass. Measurable next benefit: apply matching Refueled/RequestResolved evidence checks without losing uncertain hashes.
4. **Runtime/asset boundaries:** local Anvil does not validate V3 storage-deposit pricing, finality, current live deployment or native signed-wallet support. Zero-gas agents still cannot self-bootstrap refuel; no funding escalation was added. Tokens can lie or change behavior after cached metadata; supported accounting exclusions, nominal-versus-net limitations, owner authority and fixed-window semantics remain in [SECURITY.md](../SECURITY.md). Accurate decimals do not make unsupported tokens safe.

**CONDITIONAL GO** for review of this bounded feature branch and supervised testnet use after approval. R1/R4/R5 regression gates pass; this is not a claim that RPC failures, duplicated purchases or production funds are generally safe. Production/material-value operation and native signed writes remain **NO-GO** under the existing security/readiness boundaries. No PR is opened until the diff and test evidence are reviewed.

## Exact changed files

```text
docs/RELIABILITY-HARDENING-PHASE5A2A.md
mcp/lib.js
mcp/test/reliability.test.js
```
