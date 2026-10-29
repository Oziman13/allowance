# Phase 5A-1 — reliability and failure-mode gap audit

Date: **29 October 2026, Europe/Istanbul (UTC+03)**. Repository: `Oziman13/allowance`.

**Internal, AI-assisted reliability analysis; not an independent security audit, certification, or production-funds recommendation.** Audit only. No production fix is included.

## 1. Executive summary

The existing contract protections and MCP payment-event matching are substantial and pass their existing suites. The highest-value next work is at the client/workflow boundary, rather than another generic contract test campaign:

1. **Fail closed on unknown token units.** A temporary ERC-20 `decimals()` RPC failure is converted to 18 and cached. With the existing honest six-decimal mock, a request for `0.000000000001 mUSD` actually transferred **1 mUSD**, while the client reported the smaller amount. Contract raw-unit limits still held. This is a new confirmed MCP defect, separate from unsupported token economics.
2. **Make uncertain submission recoverable.** A localhost relay accepted a payment at Anvil, then returned a simulated upstream timeout error instead of the successful RPC result. The payment settled, but the MCP-facing explanation contained no transaction hash. Existing post-submission timeout tests start after a transaction response exists and miss this boundary. There is also no bounded receipt wait or persisted operation record, and an earlier successful refuel disappears from the parent error if later payment preparation fails.
3. **Coordinate repeated and concurrent operations deliberately.** Identical calls produce separate payments or requests; two simultaneous calls can select the same nonce. These are workflow/design limitations, not demonstrations of exceeding contract caps. Two smaller confirmed defects also obstruct recovery: a cold client's first request lookup crashes, and cancellation omits the configured-account check used by request lookup.

**CONDITIONAL GO for a narrowly scoped Phase 5A-2 MCP reliability implementation.** Keep small native-POT testnet demonstrations under operator supervision. Do not represent current workflows as exactly-once, restart-recoverable, or resilient to arbitrary RPC failure. ERC-20 automation should not proceed with unknown metadata. Production/material-value use and native signed-wallet writes remain **NO-GO** under the existing security/readiness boundaries.

No new unauthorized native withdrawal, contract double approval, or aggregate autonomous-cap bypass was established. Existing unsupported-token insolvency and lifetime-counter limitations remain. No public-chain write, real-wallet operation, deployment, dependency installation, PR, merge, or production-code edit occurred.

## 2. Verified baseline and actual execution

`git fetch origin main` succeeded. Both fetched `origin/main` and `git ls-remote --heads origin main` returned **`4d67bb28dafb80a230c6eb9759a0d4c3fa49b7de`**, exactly the requested base. Branch **`codex/allowance-reliability-audit-phase5a1`** was created directly from it. Local `main` was not checked out or modified. This report is the sole committed change; existing untracked `lib/` and `work/` are excluded.

Reviewed the complete production contract and MCP implementation/registration, all four Foundry suites and their mocks, MCP integration tests, CI, [SECURITY.md](../SECURITY.md), [Phase 2A](SECURITY-REVIEW-PHASE2A.md), [Phase 2B-2](SECURITY-VALIDATION-PHASE2B2.md), [Phase 2B-3 static analysis](SECURITY-STATIC-ANALYSIS-PHASE2B3.md), relevant architecture/agent guidance, and the October 23 proof/export. `mcp/SKILL.md` was inspected as product guidance, not invoked as an instruction to perform payments.

Production `src/Allowance.sol` SHA-256 remains `3a84a84647c051aa2015316d86ffbf70777ae824932fe7e9c5ad875a7df27474`. Its bytes also match security-policy review commit `870610392140fee3a69d017c95f4657e444f99cb`. Compiler configuration remains Solidity 0.8.28, Cancun, optimizer enabled/one run, via IR, fuzz runs 1,000.

Tools reused without installation: Forge **1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), solc **0.8.28+commit.7893614a.Linux.g++**, Node **24.19.0**, Python **3.12.14**, existing ethers **6.13.4** and project packages. CI specifies Node 22; these local results are not a new CI run.

Exact commands, from the repository root:

```sh
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a1 -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
npm test --prefix substrate
node script/spending-view.test.cjs
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
node work/phase5a1/probe.mjs
git diff --cached --check
```

The final command for the probe uses the exact local-only harness embedded in Appendix A. Existing dependency/compiler paths are environment-specific; no automatic installation or version substitution is part of replay.

| Check | Actual result |
|---|---|
| Foundry build with sizes | Exit **0**; existing lint warnings retained |
| Complete Foundry suite, seed `0x5a1` | Exit **0**, **58 passed, 0 failed, 0 skipped**, four suites: original 27, Phase 2A 19, token compatibility 10, stateful 2 |
| Native spending fuzz | **1,000 runs**, included in the 58 |
| Stateful reference invariant | **128 runs, depth 128, 16,384 calls, zero handler reverts**, included in the 58; a separate deterministic handler-coverage test also passed |
| Existing MCP integration suite | Exit **0**, **37 passed, 0 failed/skipped/cancelled**; local Anvil only |
| Existing native read-only unit suite | Exit **0**, **24 passed, 0 failed/skipped/cancelled** |
| Existing spending-display unit suite | Exit **0**, **10 passed, 0 failed/skipped/cancelled** |
| Final scratch audit harness | Exit **0**, **11 scenario probes completed**; evidence of current behavior, not 11 newly added regression tests |
| Repository formatting | Exit **1**, pre-existing formatting in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`; no formatting applied |
| Staged whitespace / final changed-file scope | Pass; report only |

Raw terminal logs remain untracked under `work/phase5a1/`. The final probe output and executable harness are embedded below so the committed report retains the new reproduction evidence. Development harness corrections (fixture symbol and exclusion of its opening seed event) were not production defects; the final run is the one counted here. No existing test or assertion was altered. Frontend/browser/performance suites and scanners were not rerun: production/frontend scope is unchanged, and these suites would not establish MCP submission/recovery guarantees. Prior scanner reports were reviewed as historical analysis, not claimed as new executions.

### Environmental verification blocker

At **09:33:16 Istanbul / 06:33:16 UTC**, the following repository-configured read-only RPC request failed:

```sh
curl --max-time 15 -sS -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://test-evm-rpc-v3.portaldot.dev
```

Actual result: **curl exit 56**, `CONNECT tunnel failed, response 403`; proxy response **HTTP/1.1 403 Forbidden**, `server: envoy`. No target RPC response was obtained. The enforced environment policy does not allow the configured Portaldot host. No alternative RPC, VPN, direct-route or proxy bypass was attempted. This is an **environmental verification blocker**, not evidence that the network is down. Current chain identity, runtime/storage economics, deployed code and finality were not freshly verified.

## 3. Existing protections and coverage matrix

The contract enforces authorization and raw-unit accounting. MCP checks interpret input and observe outcomes. Agent instructions constrain behavior only when the agent follows them. Documentation and historical evidence are neither reservations nor enforcement.

| Scenario / intended guarantee | Implementation and existing tests / direct evidence | Untested assumptions and remaining failure modes |
|---|---|---|
| A — Failures before submission | `mcp/lib.js:179–186`: account read, parse, `pay.staticCall`, optional refuel, fee/block read and estimate precede pay submission. Frozen/expired/invalid/insufficient-budget/zero-gas tests at `mcp/test/mcp.test.js:129–177`, `:192–196`, `:238–244`. Contract authorization is at `src/Allowance.sol:133–143`. | Most existing negative tests exercise contract preflight, not RPC outages at each stage. “Before pay” can be **after a successful refuel**. No complete preflight/read/estimate/nonce/broadcast fault matrix. |
| A/B — Failure during broadcast | `send` awaits fees then contract submission (`mcp/lib.js:75–80`, `:186`). `explain` conservatively warns for raw network errors (`:35–46`). New accepted-broadcast probe is direct local evidence. | If sending rejects before returning `tx`, `confirmed` never runs; no returned hash/operation record. A dropped response is not proof of non-submission. No read-only hash reconciliation tool among the five registrations. |
| B — Receipt confirmation and safe retry | `confirmed` requires status 1 and retains the original hash on uncertain wait/replacement (`mcp/lib.js:167–176`). Four synthetic wait cases assert one submission at `mcp/test/mcp.test.js:198–222`. | `tx.wait()` has no timeout, defaults to one confirmation in pinned ethers; no persisted recovery across restart, no finality/reorg test, and replacement hash/lineage is not returned. Existing “pending” mock returns null; a real default `wait()` normally stays pending instead. Never infer dropped/replaced/cancelled from missing receipt alone. |
| C — Duplicate calls / invoice settlement | Each `pay` is a distinct contract call; MCP has no intent ID, operation journal or replay gate (`mcp/lib.js:179–196`, `mcp/index.js:46–50`). New duplicate probe delivers 0.2 POT for two identical 0.1 calls and creates two identical holds with different IDs. | Transaction nonce prevents replay of the **same signed transaction**, not repeated tool calls with fresh nonces. Memo equality is not invoice identity; identical payments can be legitimate. Agent “do not retry” guidance helps, but is not exactly-once enforcement. |
| D — Concurrent operations on one account / wallet | Contract transitions execute serially; period/budget checks use execution state (`src/Allowance.sol:293–311`, `:317–329`). Stateful reference model samples ordered interleavings; `testFuzz_instantSpendingNeverExceedsPeriodLimit` covers native windows. | MCP uses a plain Wallet (`mcp/lib.js:65`), with no submission queue, local reservation or shared nonce coordination. New relay barrier makes two calls read the same pending nonce; one succeeds, one fails. Invariant tests do not model a mempool or concurrent RPC preparation. Different accounts sharing the same wallet also share its nonce stream. |
| E — Freeze, expiry, rotation, policy/trust changes | Current state is rechecked by `_agentOf`, `_roll`, `_hold`; owner powers remain separate. Original freeze/expiry/rotation/trust tests; Phase 2A `test_I01_staleRequestsRequireOwnerButSurviveFreezeExpiryRotationAndRules`, `test_exactExpiryBlocksInstantHeldAndRefuelButOwnerKeepsControl`; invariant policy/trust/freeze/rotate/advance actions. MCP advisory-preview freeze test exists. | Tests mainly impose ordered state transitions, not adversarial transaction-pool schedules or reorgs. A payment ordered before freeze can execute; afterward it is checked against the new state. A formerly instant preview can become a hold after cap/trust changes. Static preflight does not reserve state or a nonce. MCP status/preview also combine multiple latest-state reads without a pinned block snapshot; their reported fields can straddle a state change. No single-snapshot or current-finalized-state guarantee is established. |
| F — Receipt success must match requested payment | `mcp/lib.js:188–194` checks source contract, account ID, recipient, amount **and memo** for Paid/PaymentHeld; the 12 identity cases at `mcp/test/mcp.test.js:246–283` cover both events. Missing logs also reject (`:183–190`). | Preserve these protections. `cancel` and `ensureGas` use status-only confirmation; synthetic empty-log receipts are accepted for those outcomes. A receipt from the correct signed call to the genuine fixed contract should emit its event; mocks do not prove an honest-chain eventless cancellation exploit. RPC truth and token honesty are still assumptions. |
| G — Request identity and final resolution | Contract bounds IDs and checks pending state (`src/Allowance.sol:254–274`, `:333–339`, `:382–384`). Original final-state/authority tests; explicit repeated-approval denial in `test/audit/Phase2A.t.sol:266–291`; stateful `resolve` and settlement-count assertion. MCP request lookup checks account (`mcp/lib.js:199–202`). | New cold-lookup crash; cancellation lacks the same account check. Request IDs are global, not account-local. Two duplicate holds have different valid IDs and may each be approved; at-most-once **per ID** is not at-most-once per invoice. Truly unknown IDs and owner approve/cancel transaction races lack dedicated MCP regression coverage. |
| H — Native gas/refuel/storage constraints | `ensureGas` bounds refuel by per-call cap, unreserved budget and period headroom (`mcp/lib.js:151–165`). Existing tests verify zero-gas bootstrap failure, budget reservation, exhaustion and rollover. NativeOnly and contract refuel caps tested. October 23 costs provide historical held-storage context. | No V3 economics model in Anvil. Refuel threshold is not an estimate of held storage costs; old 11–19 POT holds can greatly exceed a 0.1 POT refill. Frozen/expired/exhausted/empty accounts do not guarantee refueling, and zero gas cannot bootstrap. Wallet gas may still pay for a hold after autonomous capacity is exhausted. No automatic funding escalation is justified. |
| I — Malformed inputs / untrusted recipients | Contract validates address, positive uint128 amount and memo **bytes**, then hold classifier. MCP invalid input, budget/hold and trusted-recipient tests exist. Unit/compatibility tests verify token return handling, reverts, actual native/standard-token deltas. | MCP suite fixtures are native; Solidity token tests bypass human-unit parsing. New honest-token metadata failure is not covered. Symbol is not asset identity; missing decimals must not mean 18. MCP numeric inputs also have JavaScript precision limits; prefer exact decimal strings, with validation. |
| I — Asset accounting limits | Phase 2A M01/I03, Phase 2B-2 token matrix and `test/audit/TokenCompatibility.t.sol` show fees, dishonest success, rebases, surcharge, no-data/false/malformed/blacklist/callback behavior. `SECURITY.md` excludes unsafe models; no on-chain token allowlist. | Nominal Paid amount is not net token delivery. Same-token pooled backing can be affected by unsupported economics. Existing finite standard-token invariant does not certify arbitrary assets, upgrades, precompiles or live collateral. These are known limitations, not new scanner discoveries. |
| J — Per-call versus purchase-level limits | `_hold`/`refuel` enforce each call and aggregate **fixed-window** debits. New split probe: a 2 POT request is held, three 1 POT calls settle under a 3 POT window, next 0.1 is held. `SECURITY.md` and `mcp/SKILL.md:35–36` distinguish intent. | Contract cannot identify one purchase split into calls, recipients or windows. Two limits can be spent near a boundary. “Never split” is an agent instruction; approval, invoice identity and business authorization are separate controls. No aggregate-cap bypass is demonstrated. |
| CI and bounded model | `.github/workflows/ci.yml:7–38` builds/runs complete Foundry and MCP suites. Invariant uses 12 action selectors, honest native/two token pools, max 18 accounts, small amounts, 128×128 traces. | CI does not run native/display/browser suites or this scratch harness. No network-fault, crash-recovery, multi-process, finality or V3 storage-deposit campaign. Foundry/forge-std setup is not fully version-pinned in CI; record tool versions rather than treating local and CI environments as identical. More random runs alone would not close these workflow gaps. |

### October 23 evidence: what it establishes

Reviewed [PROOF.md](PROOF.md#a-real-ai-assistant-on-chain-2026-10-23) and [evidence/onchain.json](../evidence/onchain.json). The export records native testnet account 0, documented recipient/owner `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547`, with:

| Block / full recorded hash | Evidence |
|---|---|
| 159822 / `0xc26b7d632cc5d334dfc46c5c8cb8d31aac22cf69036cd7661bd9b08c0bf0899b` | Paid 0.3 POT; memo “Market data API access” |
| 160197 / `0xb60b8adad44bf3068b55a7672150d4956732785e2f66b999c631368b44a824b7` | PaymentHeld request 2, 2 POT; **not payment** |
| 160213 / `0x8be27fd120405d37c4d8329f676b03d113dee62451fceadcfbd38d5460924435` | Owner Paid 2 POT and RequestResolved approved for request 2 |
| 160231 / `0x8427471d9b800c41d30ba811b96f96231916c439c2f8a2784435a842a5bd9d2d` | FrozenSet true |

Claude attribution and subsequent MCP refusal come from the project session record/linked historical recording, not event identity. The refusal generated no new transaction. No vendor service delivery, model authorship, fault injection, retry safety or current deployment was independently verified by this export. The separate dashboard request 1 and its owner approval are not Claude request 2. The export is a repository snapshot read at block 206637 on October 26; it was not re-attested through the blocked RPC. Browser simulation and the probes below are local evidence, not new October 23/testnet transactions. The external video was not newly watched in this phase.

## 4. Ranked reproducible findings

Severity below assesses demonstrated financial/operational harm under stated prerequisites, not a claim of an externally exploitable contract vulnerability. Cost estimates are solo-founder planning estimates in focused workdays; implementation/review may change them. Rankings weigh harm, plausible usage, existing mitigation, reproduction, cost and regression risk rather than test counts.

| Rank / ID | Classification and impact | Likelihood / mitigation | Solo cost / regression risk |
|---|---|---|---|
| 1 / R1 | **Confirmed defect — Medium:** wrong token units after metadata failure | Conditional on ERC-20 metadata failure; no malicious token needed. Raw-unit contract caps still constrain debit, but cannot correct human-unit interpretation. Direct six-decimal local transfer proof. | 0.5–1 day; low if failing closed without guessing decimals |
| 2 / R2 | **Confirmed defect — Medium:** accepted-broadcast error loses recoverable transaction identity; associated pending/partial-progress design limitations | Network instability is plausible. Current uncertainty warning and no automatic retry mitigate risk, but human/agent recovery can still duplicate work. Local relay and real receipt prove lost identity. | 2–4 days for reviewed bounded recovery; medium/high regression risk around signing/submission |
| 3 / R3 | **Design limitation — Medium operational risk:** repeated calls pay/hold repeatedly | Common retry/restart pattern. Caps limit aggregate escrow exposure; instructions discourage repeats. Local duplicate and split proofs. | 2–4 days for scoped intent tracking/coordination; medium risk and explicit compatibility decisions |
| 4 / R4 | **Confirmed defect — Low:** first request lookup after restart crashes | Predictable whenever request is first operation; status/preview/pay initialize metadata and mask it. Direct local proof. | Under 0.5 day; low |
| 5 / R5 | **Confirmed defect — Low:** cancel crosses the client's configured allowance when one agent controls both | Requires shared agent and wrong global ID. No contract authority bypass or fund transfer; wrong hold can be lost. Direct two-account proof. | Under 0.5 day; low |
| 6 / R6 | **Design limitation + confirmed test-coverage gap — Medium availability:** concurrent same-wallet nonce collision | Concurrent MCP calls/multiple sessions are plausible; no server/client queue. Contract caps remain sound. Deterministic nonce-read barrier proves failure. | Included with R3 coordination; medium, especially multi-process scope |
| 7 / R7 | **Confirmed test-coverage gap — Low under trusted RPC/code assumptions:** refuel/cancel success lacks matching-event checks | Synthetic receipts show inconsistency; honest deployed code is not shown to produce such receipts. Existing payment matcher is strong. | 0.5–1 day; low, retain replacement handling and hash preservation |
| 8 / R8 | **Design limitation / environmental verification blocker:** gas bootstrap, held-storage costs and request accumulation | Known limits, potentially severe availability/cost impact; seed/refuel bounds and explicit warnings mitigate. Local tests cover arithmetic, historical V3 evidence covers old costs only. | No safe automatic funding fix; read-only measurement first when access is restored |
| 9 / R9 | **Documentation/validation gap — Low:** memo “characters” versus contract bytes; recovery route unclear | Non-ASCII memo can be within schema length but exceed 140 bytes; staticCall rejects, so no demonstrated transfer loss. Operator guidance lacks an implemented hash-recovery path. | Under 0.5 day for scoped wording/UTF-8 validation tests; low |

### R1 — Unknown ERC-20 decimals silently become authoritative

Affected: `mcp/lib.js:92–106`, especially `:100`; `:136–148` preview and `:179–194` pay/format paths. `test/mocks/MockTokens.sol:5–8` supplies the existing honest six-decimal `mUSD`. All MCP `fresh` fixtures at `mcp/test/mcp.test.js:121–126` are native.

On any decimals lookup rejection, `.catch(() => 18)` chooses units and stores them in `meta` for the client lifetime. The token need not lie: the harness selectively returns a temporary RPC error for `decimals()` while transfers and other calls work. With budget 2 mUSD, per-call cap 1 mUSD, period cap 3 mUSD, the client accepts `0.000000000001`, parses it as 1,000,000 raw units, transfers **1 mUSD**, and reports `0.000000000001 mUSD`. Subsequent status still formats the remaining 1 mUSD using the cached incorrect units after the RPC recovers. Correct six-decimal parsing should reject that excess-precision input.

This proves conversion/reporting error, not a cap bypass or token-pool insolvency. Larger intended ordinary amounts can instead become oversized holds, causing unnecessary request-storage costs. Exact production incidence and affected live assets are unverified. **Measurable benefit:** a failed metadata read must cause zero payment/refuel submissions and zero guessed unit conversions; successful recovery must parse a one-token string to the actual token unit amount. Symbol fallback must not imply verified asset identity.

### R2 — Submission/recovery is only safe after a transaction response exists

Affected: `mcp/lib.js:63–80`, `:154–175`, `:184–196`; error formatting `:35–46`; MCP wrapper `mcp/index.js:26–28`. Existing uncertainty tests: `mcp/test/mcp.test.js:179–190`, `:198–222`.

The relay forwards `eth_sendRawTransaction` to local Anvil, receives acceptance, then returns JSON-RPC error `-32000`, “simulated upstream timeout after acceptance,” to the client. This is a deliberately injected **RPC error response after acceptance**, not a claim that the test dropped a physical TCP packet. Direct Anvil lookup confirms status 1 and a 0.1 POT recipient increase. `pay()` rejects before `tx` is assigned; the error has no `transactionHash`, and `explain()` omits the hash even though the signed transaction determines it. One raw submission was observed; the client did **not** automatically retry or falsely report paid.

Pinned ethers constructs its wrapped response only after successful broadcast (`mcp/node_modules/ethers/lib.esm/providers/abstract-provider.js:740–753`); this is why testing `tx.wait()` errors alone misses the loss. Error payload internals may contain signed bytes, but the public MCP explanation does not reconcile or persist a safe operation identity. Never dump raw signing payloads as a recovery log.

Two related workflow boundaries were also observed:

- `confirmed()` calls `tx.wait()` without a timeout. Pinned ethers defaults to one confirmation and timeout 0 (`providers/provider.js:1024–1027`). With local automining disabled, an accepted pay stayed unresolved during the measured 1,000 ms interval; after manual mining it returned paid, with one submission. The finite observation does not prove infinite delay; the absence of a configured deadline is source-confirmed. A one-confirmation receipt is not a separately verified Portaldot finality guarantee.
- Refuel and pay are separate transactions. Injecting pay-estimation failure after a real 0.1 POT refuel leaves budget 4.9/period headroom 2.9 from initial 5/3. No pay is submitted, but the error omits the successful refuel/hash because `gas_refuel` is attached only to a successful parent result. This is partial progress, not atomic rollback or unauthorized funding. If refuel itself is uncertain, current control flow stops before pay and preserves its known hash.

The wrapper's generic **“Not done”** is therefore not proof that nothing moved. A generic `insufficient funds` formatter likewise should not erase known earlier refuel progress. **Measurable benefit:** preserve locally computable hash and operation phase across accepted-but-unacknowledged submission, timeout and restart; return bounded pending/unknown rather than block forever; surface prior confirmed refuel separately; never automatically send a new payment to recover an uncertain one.

### R3 — Duplicate operation identity and purchase intent are absent

Affected: `src/Allowance.sol:282–311`, `:254–266`; `mcp/lib.js:179–196`; tool schema at `mcp/index.js:46–50`; agent instruction `mcp/SKILL.md:33–43`.

Two sequential calls with the same account, recipient, 0.1 POT amount and memo each settle, with distinct hashes and total delivery 0.2 POT. Two identical 2 POT calls yield different pending request IDs. Each ID can in principle be approved once; `NotPending` prevents re-approval of **that ID**, not approval of a second duplicate hold.

Separately, the local split probe demonstrates that a held 2 POT purchase can be followed by three distinct 1 POT payments under the 3 POT aggregate cap; another 0.1 is held. The original hold remains pending and reserves nothing. The per-call and fixed-window aggregate rules are satisfied. This is **not** proof of preventing all splitting, and a memo does not bind invoice identity, intent or total purchase price. Refuels/free wallet funds and spending across window boundaries further differ from invoice authorization.

There is no exactly-once API promise to “repair” in Solidity here. **Measurable benefit:** a deliberately supplied stable intent ID should return the known pending/confirmed result or block a replay, including after restart, while different IDs can still authorize legitimate identical purchases. Client intent controls cannot restrain a compromised agent calling the contract directly. Do not deduplicate all equal recipient/amount/memo tuples or reinterpret fixed windows as rolling limits.

### R4 — Request lookup depends on an unrelated earlier call

Affected: `mcp/lib.js:92–106`, `:199–202`; MCP registration `mcp/index.js:52–56`.

`createClient` can resolve the account without initializing `meta`. A fresh/restarted client's first `request(validId)` reaches `fmt`, then throws `Cannot read properties of undefined (reading 'decimals')`. The same client succeeds after `status()`. Existing held-request tests call `pay()` on the same client first and mask the problem. The repository guidance recommends checking held requests later; restart is a normal recovery path.

**Measurable benefit:** after restart, the first request tool call must return correct amount/status without a preceding status/preview/pay call, for native and known-metadata ERC-20 accounts, and fail explicitly on unavailable token units rather than fabricate them. Preserve existing request status and account checks.

### R5 — Configured-account scope is checked on read but not cancellation

Affected: `mcp/lib.js:199–208`; contract authority `src/Allowance.sol:333–339`; shared-agent use is explicitly documented in `docs/ARCHITECTURE.md:78`.

With two native accounts sharing one agent key, client A's request lookup rejects a request from B as “another allowance.” Client A's `cancel(B_requestId)` nevertheless sends the call and cancels it. This is **authorized at contract level** because the key is B's current agent too. It is a client scope inconsistency that can destroy an intended pending hold if a global ID is confused. It does not move funds or grant cross-owner powers.

**Measurable benefit:** wrong-account IDs must fail before fee estimation/submission for both read and cancel. Correct-account cancellation must remain possible while frozen/expired, and old keys after rotation must remain denied by the contract. Do not introduce a false requirement that freeze blocks cancellation.

### R6 — Concurrent preparation races the wallet nonce

Affected: `mcp/lib.js:65`, `:80`, `:179–196`; unqueued handler wrapper `mcp/index.js:28`. The plain pinned ethers wallet fills an absent nonce through `getNonce("pending")` in `providers/abstract-signer.js:65–66`.

The local relay holds the two nonce-read responses until both are obtained, then releases them. Two distinct concurrent payments from one client choose nonce **0, 0**; the final run returned **one paid and one REPLACEMENT_UNDERPRICED**, with two distinct signed submission attempts. Earlier schedules returned NONCE_EXPIRED for the rejected call. This deterministic network scheduling is a local race reproduction, not a measured V3 incidence rate. No double-cap spend follows: one tx did not execute. A shared nonce manager alone also does not solve duplicate intent, restarts, other processes or partial refuel workflows.

**Measurable benefit:** supported same-wallet concurrency must either execute distinct authorized operations serially without self-colliding nonces or reject the second **before signing/submission** with a clear busy outcome. Define the single-process/multi-process boundary explicitly; do not claim a process-local queue coordinates independent servers or direct wallet use.

### R7 — Event-confirmation coverage stops at payments

Affected: `mcp/lib.js:162–164`, `:205–208`; positive contrast `:188–191`. In synthetic contract-method fixtures, a status-1 receipt with empty logs lets cancellation report cancelled while the actual request is still pending, or adds `gas_refuel.refueled: "1 POT"` without an actual refuel. Those calls were mocked; they are not authentic successful transaction receipts from the deployed contract.

Classify this as a **confirmed test-coverage/verification gap**, with no new honest-contract exploit established. Honest contract cancellation emits RequestResolved and successful refuel emits Refueled; `confirmed` already refuses uncertain replacements. An adversarial RPC can also forge matching logs, so event checking does not eliminate RPC trust. **Measurable benefit:** negative missing/wrong-emitter/account/request/status/agent/amount fixtures must never report those actions complete and must retain the known hash, consistent with existing pay checks. This is lower priority than R1/R2.

### R8 — Keep gas and storage limitations explicit

Affected: `mcp/lib.js:69–78`, `:151–165`, `:183–186`; `src/Allowance.sol:147–150`, `:308–329`; `SECURITY.md` gas/asset sections. Existing zero-gas, budget-reservation and exhausted-headroom tests passed. Insufficient budget and exhausted limits do not justify bypassing caps; frozen/expired/new-agent authority is still checked on execution. Existing pending requests can still be owner-approved or current-agent-cancelled under their documented rules.

The refuel target is a threshold heuristic, not a guarantee of paying the next fee/storage deposit. A held request stores public data and reserves no budget; repeated holds consume sender gas/storage funds and permanent request/history storage without a request-rate or invoice limit. Local Anvil neither prices V3 deposits nor proves how a future runtime charges/refunds them. No protocol-wide payment DoS was demonstrated: indexed core lookup does not scan every historical request.

**Measurable benefit of follow-up:** read-only target-runtime fee/deposit estimates for representative short/long holds should produce an actionable insufficient-wallet-funds result without any automatic top-up or repeated submission. Keep the current self-bootstrap restriction and wallet/seed/refuel boundaries. Do not increase seeds, refill amounts or storage budgets speculatively to make a test pass.

### R9 — Wording and validation should not hide boundary conditions

Affected: `mcp/index.js:48–49` (`z.string().max(140)`), `mcp/lib.js:28` (“140 characters max”), versus `src/Allowance.sol:290` (`bytes(memo).length`). For example 80 `ş` characters occupy 160 UTF-8 bytes: schema string length and the documented character limit do not describe the contract byte limit. Preflight rejects excessive bytes, so this is a validation/documentation gap rather than a demonstrated payment-loss path. Also avoid interpreting the wrapper's “Not done” as no submitted/previously completed action (R2).

`SECURITY.md:75` correctly describes scanner unavailability **during Phase 2A**; it is not evidence that scanners never ran. Phase 2B-3 contains the later executions and their manual triage. Keep historical scope/date qualifications instead of rewriting earlier reviews as current guarantees. **Measurable benefit:** byte-correct inputs/errors and explicit pending/partial-progress instructions reduce futile calls without changing transaction policy; acceptance tests should exercise one multibyte boundary, not add redundant ASCII cases.

## 5. Top three Phase 5A-2 improvements and acceptance gates

This is a proposed scope, **not authorization to implement it in this audit**. Keep Solidity, ABI, deployment, network and frontend behavior out of Phase 5A-2 unless separately justified. Preserve existing five tool names and current successful response fields; any optional intent/recovery fields need explicit compatibility tests with existing clients. No automatic payment retries, funding escalation or automatic owner approvals.

### 1 — Small fail-closed metadata and request-lifecycle fixes

Address **R1, R4, R5** first in isolated MCP changes and their integration tests. This is the smallest risk-adjusted improvement: prevent wrong-unit sends, restore restart request lookup, and stop accidental cross-account cancellation. Estimated **1–2 days**, low regression risk if scope stays narrow.

Acceptance criteria:

- With the existing six-decimal mock and a failing/malformed/unavailable decimals RPC response, preview/pay must fail explicitly before refuel/pay submission. No silent 18-decimal fallback, no cached guessed units. Recovery with a successful verified read parses `"1"` as exactly 1,000,000 raw units; excessive precision is invalid.
- A cold native/ERC-20 client can immediately look up its own valid held request, with correct amount/status. Unknown and wrong-account IDs return clear errors; no startup-order dependency. Preserve statuses for approved/rejected/cancelled as well as pending.
- Cancel validates the request's configured account before any submission; two accounts sharing one agent reproduce a rejected cross-account attempt. Valid current-agent cancellation while frozen/expired still works; revoked-agent denial remains.
- Native positive paths and existing 37 MCP tests remain compatible. One meaningful failure test per boundary is preferable to many duplicated input examples.

### 2 — Bounded, truthful transaction outcome and recovery

Address **R2**, then the narrowly related R7 checks. Define explicit prepared/submitting/submitted/confirmed/reverted/unknown phases and partial refuel outcomes. Retain locally determined hashes before submission, bounded confirmation, and a protected minimal recovery record/read-only reconciliation procedure. Avoid persisting private keys or logging raw signed payloads. Estimated **2–4 days plus design review**; medium/high regression risk because signing/submission is sensitive.

Acceptance criteria:

- A pre-submission RPC/estimate failure submits zero transactions; an upstream error **after acceptance** returns the original locally derivable hash and unknown status. Cover a real localhost connection loss in addition to the JSON-RPC error fixture. No assertion that nothing was sent on ambiguous errors.
- Delay/drop receipt responses and impose a deterministic deadline: return pending/unknown with hash rather than hang, with exactly one broadcast attempt. A later read can recognize the original matching paid/held/reverted outcome without signing a replacement payment.
- Terminate/restart the local server around broadcast/receipt delivery; recover the operation's identity without automatically sending. Missing receipt alone never marks it dropped or safe to resend. Preserve original/replacement lineage and distinguish a cancellation/different replacement from the intended pay.
- If refuel confirms then pay preparation fails, expose that refuel amount/hash and the unsent/unknown pay phase separately. If refuel is uncertain, stop before pay. Validate matching Refueled/RequestResolved events before claiming those sub-actions complete, with hashes retained on mismatches.
- Retain all existing Paid/PaymentHeld emitter/account/recipient/amount/memo tests. Document the chosen confirmation/finality boundary; one EVM receipt must not be relabeled as independently verified V3 finality.

### 3 — Explicit intent/replay and concurrency boundary

Address **R3/R6** after the outcome model is reviewable. Start with a same-wallet mutation lane covering the entire refuel-plus-pay sequence; explicitly decline unsupported multi-writer configurations or design cross-process coordination. Define an opt-in stable intent key and immutable payment-parameter binding before promising deduplication. Estimated **2–4 days**, medium regression risk; persistent multi-process guarantees need a separate design decision, not an incidental queue patch.

Acceptance criteria:

- Concurrent distinct authorized operations have unique nonces or the unsupported second operation fails before signing/submission. Include same account and two accounts sharing one agent, two clients, and a documented restart/multiple-server boundary.
- Repeating a supplied intent key with the same parameters after success, hold, timeout or restart does not create a second payment/hold. Reusing that key with different account/asset/recipient/amount/memo is rejected. Reconciliation does not automatically resubmit. Legacy calls without a key retain an explicitly documented lack of invoice-level exactly-once protection.
- Different intentional purchases with identical amounts/memos remain possible; never use equality of those fields alone as identity. Two distinct request IDs remain distinct approvals. Unknown outcomes block blind repeat decisions; a local nonce queue is not an invoice guarantee.
- Keep a split-payment control proving aggregate fixed-window caps still hold. Describe invoice evasion as an agent/workflow policy failure, with no claim that the deployed contract blocks every split or that a client intent ID constrains direct contract callers.

Before implementation approval, agree on the observable outcome schema, persistence/crash semantics, deadline policy and supported concurrency scope. Review small commits independently and use the current Foundry/MCP suites as regression gates. A few targeted local fault tests that enforce these measurable properties deliver more value than increasing test counts or random invariant depth alone.

## 6. Non-goals, residual risks and recommendation

- **No production changes in this phase:** only this report is committed. Scratch fixtures/probes are local, excluded from Git; no new dependencies or permanent test files. No main edit, PR, push, merge, deployment or public-chain transaction is included.
- Existing owner authority is intentional. Freeze/expiry do not revoke owner withdrawals or old approvals. Rotation does not invalidate requests or recover wallet funds. Only contract execution order, not preview time, determines applicability. Preserve those boundaries.
- Unsupported-token M01, nominal-versus-net delivery I03, positive-rebase attribution, extreme lifetime-counter L01, permanent storage and free wallet-fund use remain as documented. No token allowlist, recovery administrator, request epoch or invoice registry was introduced or assumed.
- The stateful campaign samples bounded ordered traces with standard tokens/EOA recipients. It models neither fees/storage deposits nor chain reorgs, RPC dishonesty, network partitions, all callback interleavings or a distributed nonce service. Local mocks establish particular failures, not exploit prevalence or target-network behavior.
- RPC identity/current runtime, fee/storage units, account mapping, browser wallet signed-write compatibility, finality, real collateral and real service delivery remain unverified. The current RPC CONNECT 403 prevents dependent live checks; do not source alternative endpoints or weaken checks to claim a successful verification.
- Static analysis reports are historical internal evidence and were not rerun. Passing tests/scanners do not establish safety for arbitrary assets, compromised owners, prompt injection or malicious agents. Agent instructions about recipients, splitting and retries remain non-enforcing guidance.

**Decision: CONDITIONAL GO for the proposed MCP-only Phase 5A-2 work and continued small supervised native-POT testnet use.** Require fail-closed token units and reliable transaction reconciliation before describing ERC-20/agent workflows as dependable under failure. Production/material-value operation and native signed writes are **NO-GO** under the existing security/readiness limits. The measurable next milestone is correct amounts plus recoverable, non-replayed outcomes across the specific failure cases above, not a larger test-count headline.

## Appendix A — exact local reproduction harness

The following is evidence code embedded in the report, not a committed production/test implementation. It uses only **127.0.0.1 ports 8547/8548**, existing compiled artifacts/dependencies and the public default Anvil test fixture. Random accounts are local disposable fixtures, never real owner keys. It creates contracts only on the disposable local chain. Do not substitute a public endpoint or a real key.

To replay, save this fenced JavaScript as `work/phase5a1/probe.mjs` relative to the repository root after the existing pinned Foundry build, then run `node work/phase5a1/probe.mjs`. Both ports must be free; check for a previous probe/server before running. The absolute existing Anvil path is recorded for this environment; an equivalent installation of the same version can be selected deliberately on another machine. No install is required or performed by the harness. It cleans up its own providers/relay/Anvil on completion. Run in an isolated local development environment with the stated tools, not against production.

```js
// Local audit evidence only. Never connect this script to a public RPC.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { ethers } from '../../mcp/node_modules/ethers/lib.esm/index.js';
import { createClient, ABI, explain } from '../../mcp/lib.js';
const RPC = 'http://127.0.0.1:8547', RELAY = 'http://127.0.0.1:8548';
const E = ethers.parseEther;
const art = JSON.parse(readFileSync(new URL('../../out/Allowance.sol/Allowance.json', import.meta.url)));
const tokenArt = JSON.parse(readFileSync(new URL('../../out/MockTokens.sol/MockERC20.json', import.meta.url)));
const anvil = spawn('/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil', ['--host','127.0.0.1','--port','8547','--silent'], {stdio:'ignore'});
const provider = new ethers.JsonRpcProvider(RPC,31337,{staticNetwork:true,cacheTimeout:-1});
provider.pollingInterval=50;
let seq=0, relay, al, owner, token, address;
const clients=[];
const faults={drop:false, decimals:false, nonceBarrier:false, nonceWaiters:[], submissions:[], dropped:[]};
const log=(name,data)=>console.log(JSON.stringify({name,...data}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function forward(req) {
  const response=await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)});
  return response.json();
}
async function rpc(req) {
  if(faults.decimals && req.method==='eth_call' && req.params[0].to?.toLowerCase()===(await token.getAddress()).toLowerCase() && req.params[0].data==='0x313ce567') {
    return {jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'simulated temporary decimals RPC failure'}};
  }
  if(faults.nonceBarrier && req.method==='eth_getTransactionCount') {
    const result=await forward(req);
    return new Promise(resolve=>{
      faults.nonceWaiters.push(()=>resolve(result));
      if(faults.nonceWaiters.length===2) { faults.nonceBarrier=false; faults.nonceWaiters.splice(0).forEach(fn=>fn()); }
    });
  }
  const result=await forward(req);
  if(req.method==='eth_sendRawTransaction') {
    const tx=ethers.Transaction.from(req.params[0]);
    faults.submissions.push({hash:tx.hash,nonce:tx.nonce,error:result.error?.message});
    if(faults.drop && !result.error) {
      faults.drop=false; faults.dropped.push(tx.hash);
      return {jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'simulated upstream timeout after acceptance'}};
    }
  }
  return result;
}
async function client(id,key,rpcUrl=RPC,minGas=0n) {
  const c=await createClient({network:'local',rpc:rpcUrl,address,key,accountId:id,minGas});
  c.provider.pollingInterval=50; clients.push(c); return c;
}
async function fresh({wallet=ethers.Wallet.createRandom(),asset=ethers.ZeroAddress,budget=E('5'),seed=E('1'),rpcUrl=RPC,minGas=0n}={}) {
  const id=Number(await al.accountCount());
  const scale=asset===ethers.ZeroAddress?E('1'):1000000n;
  await (await al.openAccount(wallet.address,asset,'local audit',{perPayment:scale,perPeriod:scale*3n,period:86400,expiresAt:0,trustedOnly:false},[],budget,seed,{value:asset===ethers.ZeroAddress?budget+seed:0})).wait();
  if(asset!==ethers.ZeroAddress) await (await owner.sendTransaction({to:wallet.address,value:E('1')})).wait();
  return {c:await client(id,wallet.privateKey,rpcUrl,minGas),wallet,id};
}
async function run(name,fn) { await fn(); seq++; console.log('PASS '+name); }
try {
  for(let i=0;i<50;i++) { try { await provider.getBlockNumber(); break; } catch { await sleep(100); } }
  // Standard public Anvil fixture, never a real owner key.
  owner=new ethers.NonceManager(new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',provider));
  al=await new ethers.ContractFactory(ABI,art.bytecode.object,owner).deploy(); await al.waitForDeployment(); address=await al.getAddress();
  token=await new ethers.ContractFactory(tokenArt.abi,tokenArt.bytecode.object,owner).deploy(); await token.waitForDeployment();
  relay=createServer(async(req,res)=>{
    try {
      let body=''; for await(const chunk of req) body+=chunk;
      const input=JSON.parse(body);
      const result=Array.isArray(input)?await Promise.all(input.map(rpc)):await rpc(input);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    } catch(e) {res.writeHead(500);res.end('local relay error');}
  }); await new Promise(resolve=>relay.listen(8548,'127.0.0.1',resolve));
  await run('cold-request',async()=>{
    const {c,wallet,id}=await fresh(); const shop=ethers.Wallet.createRandom().address;
    const held=await c.pay(shop,'2','cold request');
    const restarted=await client(id,wallet.privateKey);
    let error; try {await restarted.request(held.request_id);} catch(e) {error=e;}
    assert.match(error.message,/decimals/);
    await restarted.status(); assert.equal((await restarted.request(held.request_id)).status,'pending');
    log('cold-request',{error:error.message,afterStatus:'pending'});
  });
  await run('cross-account-cancel',async()=>{
    const wallet=ethers.Wallet.createRandom(); const a=await fresh({wallet}); const b=await fresh({wallet});
    const held=await b.c.pay(ethers.Wallet.createRandom().address,'2','other allowance');
    await assert.rejects(a.c.request(held.request_id),/another allowance/);
    const out=await a.c.cancel(held.request_id);
    assert.equal(Number((await al.getRequest(held.request_id)).status),4);
    log('cross-account-cancel',{clientAccount:a.id,requestAccount:b.id,result:out.status});
  });
  await run('duplicate-payment-and-hold',async()=>{
    const {c}=await fresh(); const shop=ethers.Wallet.createRandom().address;
    const first=await c.pay(shop,'.1','invoice A'), second=await c.pay(shop,'.1','invoice A');
    assert.equal(await provider.getBalance(shop),E('.2')); assert.notEqual(first.tx,second.tx);
    const r1=await c.pay(shop,'2','invoice B'), r2=await c.pay(shop,'2','invoice B');
    assert.notEqual(r1.request_id,r2.request_id);
    log('duplicate-payment-and-hold',{recipientTotal:'0.2 POT',differentPaymentHashes:true,distinctRequestIds:[r1.request_id,r2.request_id]});
  });
  await run('split-purchase',async()=>{
    const {c}=await fresh(); const shop=ethers.Wallet.createRandom().address;
    assert.equal((await c.pay(shop,'2','one purchase')).result,'held for owner approval');
    for(let i=0;i<3;i++) assert.equal((await c.pay(shop,'1','one purchase')).result,'paid');
    assert.equal((await c.pay(shop,'.1','one purchase')).result,'held for owner approval');
    assert.equal((await c.status()).can_spend_now_without_asking,'0 POT');
    log('split-purchase',{perCall:'1 POT',threePayments:'3 POT paid',next:'held',aggregateCapRespected:true});
  });
  await run('accepted-broadcast-response-lost',async()=>{
    const {c}=await fresh({rpcUrl:RELAY});const shop=ethers.Wallet.createRandom().address;
    faults.drop=true; const before=faults.submissions.length; let error;
    try { await c.pay(shop,'.1','lost response'); } catch(e) {error=e;}
    assert(error); const hash=faults.dropped.at(-1);const receipt=await provider.getTransactionReceipt(hash);
    assert.equal(receipt.status,1);assert.equal(await provider.getBalance(shop),E('.1'));
    assert.equal(error.transactionHash,undefined);assert(!explain(error,c.iface).includes(hash));
    assert.equal(faults.submissions.length-before,1);
    log('accepted-broadcast-response-lost',{localHash:hash,receiptStatus:receipt.status,recipientTotal:'0.1 POT',returnedHash:null,submissions:1,message:explain(error,c.iface)});
  });
  await run('concurrent-shared-wallet',async()=>{
    const {c}=await fresh({rpcUrl:RELAY}); const before=faults.submissions.length;
    faults.nonceBarrier=true;
    const outcomes=await Promise.allSettled([c.pay(ethers.Wallet.createRandom().address,'.1','parallel A'),c.pay(ethers.Wallet.createRandom().address,'.1','parallel B')]);
    const sent=faults.submissions.slice(before);assert.equal(sent.length,2);assert.equal(sent[0].nonce,sent[1].nonce);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
    log('concurrent-shared-wallet',{nonces:sent.map(t=>t.nonce),outcomes:outcomes.map(o=>o.status==='fulfilled'?o.value.result:o.reason.code)});
  });
  await run('metadata-failure-wrong-units',async()=>{
    await (await token.mint(await owner.getAddress(),2000000n)).wait();
    await (await token.approve(address,2000000n)).wait();
    const {c}=await fresh({asset:await token.getAddress(),budget:2000000n,seed:0n,rpcUrl:RELAY});
    const shop=ethers.Wallet.createRandom().address;faults.decimals=true;
    const out=await c.pay(shop,'0.000000000001','unit confusion'); faults.decimals=false;
    assert.equal(await token.decimals(),6n);assert.equal(await token.balanceOf(shop),1000000n);
    assert.equal(out.amount,'0.000000000001 mUSD');
    const status=await c.status();assert.equal(status.budget_left,'0.000000000001 mUSD');
    log('metadata-failure-wrong-units',{actualDecimals:6,requested:out.amount,actualTransfer:'1 mUSD (1000000 raw units)',cachedBudget:status.budget_left});
  });
  await run('partial-refuel-before-pay-failure',async()=>{
    const {c,id}=await fresh({seed:E('.01'),minGas:E('.05')});const real=c.contract.pay;
    const fake=async(...args)=>real(...args); fake.staticCall=real.staticCall;
    fake.estimateGas=async()=>{throw new Error('simulated RPC failure after refuel');};
    Object.defineProperty(c.contract,'pay',{value:fake});
    const start=await provider.getBlockNumber(); await assert.rejects(c.pay(ethers.Wallet.createRandom().address,'.1','partial'),/after refuel/);
    const events=await al.queryFilter(al.filters.Refueled(id),start+1);
    assert.equal(events.length,1);const [a,left]=await al.getAccount(id);assert.equal(a.balance,E('4.9'));assert.equal(left,E('2.9'));
    log('partial-refuel-before-pay-failure',{refuel:'0.1 POT',remainingBudget:'4.9 POT',remainingPeriod:'2.9 POT',paySubmitted:false,errorOmitsRefuelHash:true});
  });
  await run('cancel-missing-resolution-evidence',async()=>{
    const {c}=await fresh();const held=await c.pay(ethers.Wallet.createRandom().address,'2','fake cancel');
    const fake=async()=>({hash:ethers.ZeroHash,wait:async()=>({status:1,logs:[]})});fake.estimateGas=async()=>100000n;
    Object.defineProperty(c.contract,'cancel',{value:fake});
    const out=await c.cancel(held.request_id);assert.equal(out.status,'cancelled');
    assert.equal(Number((await al.getRequest(held.request_id)).status),1);
    log('cancel-missing-resolution-evidence',{reported:out.status,actual:'pending',evidence:'synthetic receipt; no real cancellation sent'});
  });
  await run('refuel-missing-event-evidence',async()=>{
    const {c,id}=await fresh({seed:E('1'),minGas:E('2')});
    const fake=async()=>({hash:ethers.ZeroHash,wait:async()=>({status:1,logs:[]})});fake.estimateGas=async()=>100000n;
    Object.defineProperty(c.contract,'refuel',{value:fake});
    const out=await c.pay(ethers.Wallet.createRandom().address,'.1','fake refuel');assert.equal(out.gas_refuel.refueled,'1 POT');
    const [a]=await al.getAccount(id);assert.equal(a.balance,E('4.9'));
    log('refuel-missing-event-evidence',{reported:out.gas_refuel.refueled,actualRefuel:0,evidence:'synthetic refuel receipt; actual local payment only'});
  });
  await run('delayed-inclusion-unbounded-wait',async()=>{
    const {c}=await fresh({rpcUrl:RELAY});const before=faults.submissions.length;
    await provider.send('evm_setAutomine',[false]);let finished=false;
    const pending=c.pay(ethers.Wallet.createRandom().address,'.1','delayed').finally(()=>{finished=true;});
    for(let i=0;i<100 && faults.submissions.length===before;i++) await sleep(20);
    assert.equal(faults.submissions.length-before,1);await sleep(1000);assert.equal(finished,false);
    const hash=faults.submissions.at(-1).hash;
    await provider.send('evm_mine',[]);await provider.send('evm_setAutomine',[true]);
    const out=await pending;assert.equal(out.result,'paid');assert.equal(out.tx,hash);
    log('delayed-inclusion-unbounded-wait',{pendingAfterMs:1000,hashAvailableOnlyAtRelayWhilePending:true,afterManualMine:'paid',submissions:1});
  });
  console.log('LOCAL_PROBES_PASSED='+seq);
} finally {
  for(const c of clients)c.provider.destroy();provider.destroy();
  if(relay)await new Promise(resolve=>relay.close(resolve));anvil.kill();
}
```

## Appendix B — final local probe output

This output records the final successful run. Generated hashes/account IDs and the exact rejected nonce-race error can vary between local runs. Only assertions and scope are deterministic; no historical/testnet hash is created by these probes.

```text
{"name":"cold-request","error":"Cannot read properties of undefined (reading 'decimals')","afterStatus":"pending"}
PASS cold-request
{"name":"cross-account-cancel","clientAccount":1,"requestAccount":2,"result":"cancelled"}
PASS cross-account-cancel
{"name":"duplicate-payment-and-hold","recipientTotal":"0.2 POT","differentPaymentHashes":true,"distinctRequestIds":[2,3]}
PASS duplicate-payment-and-hold
{"name":"split-purchase","perCall":"1 POT","threePayments":"3 POT paid","next":"held","aggregateCapRespected":true}
PASS split-purchase
{"name":"accepted-broadcast-response-lost","localHash":"0x4b5270c432f986fdc37cf3686b48496a979fd4b1ec754b25bc023c4bb69bb099","receiptStatus":1,"recipientTotal":"0.1 POT","returnedHash":null,"submissions":1,"message":"The network returned an error (simulated upstream timeout after acceptance, code -32000). Submission or confirmation may be uncertain. Check the transaction status before retrying; don't retry in a loop."}
PASS accepted-broadcast-response-lost
{"name":"concurrent-shared-wallet","nonces":[0,0],"outcomes":["REPLACEMENT_UNDERPRICED","paid"]}
PASS concurrent-shared-wallet
{"name":"metadata-failure-wrong-units","actualDecimals":6,"requested":"0.000000000001 mUSD","actualTransfer":"1 mUSD (1000000 raw units)","cachedBudget":"0.000000000001 mUSD"}
PASS metadata-failure-wrong-units
{"name":"partial-refuel-before-pay-failure","refuel":"0.1 POT","remainingBudget":"4.9 POT","remainingPeriod":"2.9 POT","paySubmitted":false,"errorOmitsRefuelHash":true}
PASS partial-refuel-before-pay-failure
{"name":"cancel-missing-resolution-evidence","reported":"cancelled","actual":"pending","evidence":"synthetic receipt; no real cancellation sent"}
PASS cancel-missing-resolution-evidence
{"name":"refuel-missing-event-evidence","reported":"1 POT","actualRefuel":0,"evidence":"synthetic refuel receipt; actual local payment only"}
PASS refuel-missing-event-evidence
{"name":"delayed-inclusion-unbounded-wait","pendingAfterMs":1000,"hashAvailableOnlyAtRelayWhilePending":true,"afterManualMine":"paid","submissions":1}
PASS delayed-inclusion-unbounded-wait
LOCAL_PROBES_PASSED=11
```
