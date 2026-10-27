# Allowance — Phase 2A security review

Date: 2026-10-27. Status: audit only; no production fixes.

**This is an internal review assisted by an AI coding agent, not an independent security audit or a certification of safety.** It does not replace a professional external audit before mainnet or material-value use.

## Executive summary

Reviewed the complete Allowance contract against authorization, accounting, external-call, token, and request-lifecycle threats. No Critical or High finding was confirmed. No unauthorized native-token withdrawal, ordinary-token cross-account drain, double approval, or autonomous limit bypass was reproduced under the stated asset assumptions. Passing tests do not establish absence of vulnerabilities.

One **Medium** finding concerns unsupported token economics: negative rebases or outbound sender surcharges can make pooled ERC-20 backing smaller than recorded account balances, expose other users of that same token to losses, and prevent withdrawals. One **Low** finding concerns overflow of the cumulative spending counter at an extreme raw-unit bound. Five **Informational** observations define important security and integration limitations; several are intentional behavior rather than implementation defects.

The existing deployment and application were preserved. This branch adds only this report and local audit tests. No public RPC or public-chain transaction was used for validation. No deployed bytecode, token implementation, Portaldot precompile behavior, or live account balance was independently verified in this phase.

## Baseline, scope, and method

- Repository: `https://github.com/Oziman13/allowance`.
- `git fetch origin main` succeeded; fetched `main` exactly matched the expected commit: **`64b696c7fb5588c82ff87c299186854da1e02633`**.
- Audit branch: `codex/allowance-security-audit-phase2a`, created directly from that commit. `main` was not checked out, modified, or merged into.
- Primary scope: all of `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`, and `foundry.toml`.
- Documentation reviewed: `README.md`, `docs/ARCHITECTURE.md`, relevant security/cost claims in `docs/JUDGING.md`, `docs/CHECKIN.md`, `mcp/README.md`, and `mcp/SKILL.md`. These were read as documentation, not relied on as security boundaries or invoked as agent skills.
- Method: source tracing of every external entry point and external call, baseline tests, adversarial local mocks, boundary tests, return-data tests, and manual triage of Foundry lint output. Reproduction assertions deliberately describe current behavior; they are not speculative fixes.
- Runtime: Foundry 1.7.1, Solidity 0.8.28, Cancun, optimizer enabled with one run, `via_ir = true`; existing fuzz setting 1,000 runs. Local mocks are compiled and executed inside Forge, with no broadcast.

## Threat model and trust boundaries

| Actor | Trust and capabilities | Assets / boundaries affected |
|---|---|---|
| Account owner | Fully trusted for its own account. Can withdraw any budget, change rules/trust/freeze, rotate agent, and individually approve spending outside caps. Owner key compromise defeats that account's policy. | Own escrow, recipient policy, agent identity, pending approvals. Cannot authorize another owner's account. |
| Authorized agent | Untrusted within the limits. Can call `pay`, `refuel` for native accounts, and cancel pending requests for its current accounts. Can submit arbitrary recipient/memo/amount without the frontend or MCP. | Own account's autonomous budget and period capacity; agent wallet gas; request storage. |
| Compromised agent key | Same on-chain powers as an authorized agent, including repeated cap-sized transfers, requests and refuels. Cannot be distinguished by the contract. Can front-run a pending freeze/rotation before it takes effect. | Up to remaining autonomous capacity and budget; all assets already in the agent wallet. Cannot sign as owner. |
| Malicious recipient contract | Can reject payment, consume gas, or callback during native transfer. May independently be an owner/agent, but gains no permissions from being a recipient. | Individual payment availability and authorized callback actions; guarded transfers must not reenter. |
| Malicious / nonstandard ERC-20 | Controls its own transfer logic and return values, can lie about balances, rebase, charge fees, blacklist, callback, or upgrade. `balanceOf` executes via static call, but may still lie or revert. | All accounts using that same asset depend on it; no generic adapter can make a malicious asset honest. Cannot directly alter Allowance storage or another asset. |
| Third-party funder | Anyone may add budget. For tokens needs sufficient balance and approval. Funding gives no owner or agent rights and is not refundable on demand by the funder. | Can increase the selected account's budget and its owner's control of that funding. |
| External contract / unrelated caller | Can create its own accounts, fund others, inspect state, donate assets, and attempt arbitrary calls. No global admin exists. | Only its authorized accounts, external assets and gas; no assumed frontend checks. |

Assets include native escrow; pooled balances per ERC-20; recorded account entitlements; trusted-recipient policy; request integrity; the separately held gas wallet; and transaction/storage deposits. The key boundary is escrow versus funds already transferred to the agent. All ERC-20 accounts with the same asset share one actual token balance.

### Expected invariants and necessary assumptions

1. Only the current owner can withdraw, approve/reject, or change its policy. Only the current agent can pay/refuel/cancel. Account IDs are bounds-checked.
2. An autonomous settlement requires a live, unfrozen account and a valid recipient/amount/memo. It debits the account budget and increments period spending before transfer. `refuel` shares caps but deliberately does not apply the trusted-recipient list.
3. With unchanged policy, each **contract-defined fixed window**, not every rolling interval, bounds successful autonomous nominal debits by `perPeriod`; each such call is bounded by `perPayment`. Owner approvals and withdrawals are outside that cap. Changing policy is an owner power.
4. For native currency and honest tokens that debit exactly the recorded amount and do not change escrow balances independently, aggregate recorded budgets cannot exceed actual backing. Donations may produce an unallocated surplus. M01 demonstrates why this invariant is conditional for tokens.
5. A request settles at most once. Approval uses its immutable recipient and amount and the current budget; pending requests reserve nothing. Failed transfers must roll back budget, status and counters.
6. State-changing callbacks cannot reenter fund-moving entry points. Authorized non-fund-moving operations may run during a callback; permissions and request status still apply.
7. Direct gas seeds and refuels become ordinary wallet assets. Neither their subsequent use nor assets independently received by that wallet are controlled by Allowance.

## Finding summary

| ID | Severity | Status | Description |
|---|---|---|---|
| M01 | Medium | Confirmed locally; asset-dependent | Rebases / sender surcharges can break pooled token solvency and account isolation |
| L01 | Low | Confirmed at extreme bound | Lifetime `uint128 totalSpent` exhaustion prevents further settlement |
| I01 | Informational | Confirmed; owner authority is intentional | Requests survive freeze, expiry, policy changes and rotation |
| I02 | Informational | Confirmed; gas exception is intentional | Gas funds leave the recipient-policy boundary; claims need qualification |
| I03 | Informational | Confirmed; token trust limitation | A nominal `Paid` amount does not guarantee net recipient receipt |
| I04 | Informational | Confirmed; integration limitation | Contract `preview` classifies holds, not full executability |
| I05 | Informational | Source-confirmed, documented limitation | Requests retain storage and have no cleanup path |

Severity assesses demonstrated impact and prerequisites, not just a theoretical maximum. No Critical or High issue is asserted. M01 is an unsupported-asset risk, not proof that a stranger can steal native POT or a conventional ERC-20.

## Confirmed findings

### M01 — Unsupported token balance changes undermine pooled account backing (Medium)

**References:** `src/Allowance.sol:185` (`openAccount` credits `_pull`), `:198` (`fund`), `:213` (`withdraw`), `:254` (`approve`), `:282` (`pay`), `:419` (`_send`), `:432` (`_pull`). Overbroad support claim: `README.md:40`, “any ERC-20.”

`_pull` correctly credits the observed inbound increase for ordinary recipient-deducted transfer fees. Subsequent accounting assumes the pool's only decreases are nominal successful payouts. There is no share accounting for rebases or debit-delta check on outbound transfer. All accounts with the same token share the backing affected by those assumptions.

**Prerequisites:** users have funded accounts in a token that negatively rebases, takes an additional charge from the sender on outbound transfers, or otherwise reduces escrow independently. No owner/agent privilege over the victim account is needed to exercise a separately owned account. The token behavior must already apply to the chosen victim asset; deploying an unrelated malicious token alone cannot affect existing native or other-token accounts.

**Local sequences and impact:**

1. Negative rebase: two owners deposit 100 units each into separate accounts of a share-based token. A global 50% rebase reduces escrow from 200 to 100, while the two recorded claims remain 100 each. The first owner withdraws its full nominal 100; the other owner's 100-unit claim has zero backing and withdrawal reverts. This demonstrates loss allocation across accounts, not creation of the token's initial economic loss by Allowance. No attacker is necessary for insolvency; a competing holder can redeem ahead of another user.
2. Sender surcharge: victim deposits 100; another owner deposits 10 in the same test token. The other owner withdraws 10 and the token debits 20, delivering the extra 10 to its fee collector. The victim's recorded balance remains 100 while backing falls to 90; full withdrawal reverts. The exaggerated 100% surcharge makes the assertion simple; any nonzero additional sender charge creates the same discrepancy. Direct attacker profit requires that the fee collector be attacker-controlled; otherwise fees still consume other account backing. This is not an exploit independent of token economics or configuration.

**Evidence:** `test_M01_negativeRebaseMakesClaimsInsolventAndFirstWithdrawerWins`, `test_M01_senderSurchargeConsumesAnotherAccountsBacking` in `test/audit/Phase2A.t.sol`. Both passed. The ordinary-token isolation control also passed. These do not establish that any deployed Portaldot asset has these behaviors.

**Remediation for Phase 2B:** specify and enforce a supported-asset policy before advertising arbitrary ERC-20 support. Treat rebasing and extra-sender-charge tokens as unsupported by the present deployment. Evaluate shares/adapters or isolated custody for a future version; an outbound debit check can reject some surcharges but cannot repair an asynchronous rebase or dishonest token. Do not offer a global rescue that lets one owner claim another's backing. Existing deployments need operational restrictions/disclosure; no change is applied here.

### L01 — Cumulative spending counter exhaustion blocks settlement (Low)

**References:** `src/Allowance.sol:62` (`Account.totalSpent`), `:261` (`approve`), `:301` (`pay`), `:327` (`refuel`).

`totalSpent` is a checked `uint128` lifetime counter, while funding and spending can repeat across an account's life. Once successful cumulative spending reaches `2^128 - 1` base units, a further positive settlement panics, even with new budget and a reset period. `approve` fails for the same reason; native refuel shares that counter. This is safe against wraparound but creates an availability bound.

**Prerequisites and sequence:** an asset with enough supply/raw units and owner-authorized caps allows cumulative settlement of `type(uint128).max`; fund another 10 units, roll a day, and try a one-unit instant payment. It reverts with arithmetic panic. Lower the per-payment cap to one, create a two-unit request, and approve it: that also panics. The PoC uses a standard mock token with an intentionally enormous mint and owner-selected enormous rules. It does not corrupt storage or bypass access control.

**Impact:** future agent settlement and approval on that account fail; no unauthorized transfer or counter wrap. Owner withdrawal remains available and was verified. The bound is astronomically large for native POT and common token supplies, so no practical attack against the current native deployment is established. The `uint64 payments` counter has an analogous checked bound but was not driven to exhaustion in a local PoC.

**Evidence:** `test_L01_lifetimeCounterOverflowBlocksPayAndApproveButOwnerCanWithdraw` passed.

**Remediation:** evaluate wider lifetime counters or non-blocking statistics for a future version. Document supported token bounds; do not prioritize redeployment solely for the native-token theoretical bound.

### I01 — Old requests persist across security-sensitive state changes (Informational)

**References:** `src/Allowance.sol:235` (`setFrozen`), `:243` (`rotateAgent`), `:254` (`approve`), `:269` (`reject`), `:333` (`cancel`). Inaccurate absolute claim: `docs/ARCHITECTURE.md:77`, “A frozen or expired account cannot move funds or create requests.”

A current owner may approve a pending request after freeze, expiry, agent rotation, lowered caps, or trust-policy changes. Approval intentionally uses owner authority, not `_agentOf` or current autonomous caps. The owner cannot change a request's destination through approval. Rotation revokes the old key's pay/refuel/cancel authority, but requests are account-bound, not agent-epoch-bound. The new agent can cancel them. The current agent can also cancel while frozen or expired; cancellation moves no funds.

**Sequence / evidence:** create a two-POT hold, freeze, expire, rotate, and lower both caps to one wei. The new agent's approval attempt fails; owner approval pays the original two POT exactly once. Tests `test_I01_staleRequestsRequireOwnerButSurviveFreezeExpiryRotationAndRules`, `test_I01_currentAgentCanCancelWhileFrozenAndExpired`, and `test_revokedAgentCannotPayRefuelOrCancelOldRequest_newAgentCanCancel` passed.

**Impact:** an owner who mistakenly treats freeze/rotation as request invalidation can approve an old malicious request later. No automatic execution or authorization bypass was shown. Owner withdrawal while frozen/expired is also intentional, useful emergency recovery.

**Recommendation:** describe freeze/expiry as blocking new agent payments, refuels and requests. Advise reviewing/rejecting old holds after compromise. Decide explicitly whether a future design should bind requests to a policy/agent epoch or add owner batch invalidation; do not silently change present owner powers.

### I02 — The security guarantee ends at the agent wallet (Informational)

**References:** `src/Allowance.sol:149` (gas seed), `:317` (`refuel`), `:415` (`_hold` trust check); `README.md:38` and `:56`; `docs/ARCHITECTURE.md:76`; `mcp/SKILL.md:43`.

The agent may refuel to its own address even when that address is untrusted, and can transfer that native currency to any address afterward. The contract checks native refuel amount, budget, period cap, freeze and expiry, but cannot prove that the transferred value will be spent on gas. Initial gas seeds are expressly outside period accounting. Gas/storage deposits paid directly by the agent wallet, including for failed or held transactions, are not charged by Allowance on a per-transaction basis.

**Evidence:** `test_I02_gasRefuelCanBeSpentAtUntrustedRecipientOutsideContract` passed: an untrusted direct payment is held, a capped refuel succeeds, then the agent sends those funds directly to that untrusted address. Period capacity still decreases correctly. No period-cap bypass on escrow withdrawals is demonstrated.

**Precise promise:** for native or compatible honest tokens, a compromised agent cannot debit the account through autonomous `pay`/`refuel` beyond its remaining budget or configured fixed-window caps. It may use multiple cap-sized calls; the contract has no notion of invoice splitting. Native refuels are an explicit recipient-policy exception. Owner approvals can spend beyond autonomous caps; owner withdrawals are unrestricted by those caps. Funds already in the agent wallet, including seeds, refuels and independently received assets, are freely spendable and cannot be clawed back by freeze or rotation. Fixed windows allow two limits close together across a boundary; the boundary test passed.

**Recommendation:** qualify “only trusted recipients,” “cannot overspend” and “gas included” statements accordingly. True gas-only sponsorship would need a different design; it is not a small safety fix to `refuel`.

### I03 — Token return success and nominal events do not guarantee net delivery (Informational)

**References:** `src/Allowance.sol:303` (`Paid` in `pay`), `:265` (`Paid` in approval), `:419` (`_send`), `docs/ARCHITECTURE.md:80`.

A token that deducts a fee from the recipient can debit ten units while delivering nine; `Paid.amount` is the gross ten. This remains solvent if the sender loses exactly ten. A dishonest token can return true without moving anything: the ledger is debited and an event is emitted. Empty return data is intentionally supported and also is not proof of transfer. The original `FeeToken` test mock only overrides inbound `transferFrom`, so its passing test does not establish outbound-fee behavior.

**Evidence:** `test_I03_recipientFeeMeansPaidAmountIsGrossNotNet` and `test_I03_dishonestTrueReturnCanReportPaymentWithoutTransfer` passed. Separate tests show false, malformed and reverting returns roll back, while honest no-data returns work on ingress and egress.

**Impact / recommendation:** gross nominal settlement is not guaranteed net receipt for arbitrary tokens. A `Paid` event, even from a correctly matched receipt, proves what Allowance recorded, not arbitrary token economics. Define net/gross semantics and supported assets. No generic code check fully secures a token that lies about transfers and balances. Narrow the absolute “money that did not move” documentation claim to transfers that revert or explicitly report failure for compatible tokens.

### I04 — Contract preview is not a full execution simulation (Informational)

**Reference:** `src/Allowance.sol:344` (`preview`), compared with `:282` (`pay`).

`preview` only returns the first hold reason and current nominal period capacity. It does not enforce agent identity, freeze, expiry, zero/invalid recipient, positive/uint128-bounded amount, memo size, budget, or external transfer success. For extremely large amounts, arithmetic can also revert. A `Hold.None` response is not a settlement guarantee; concurrent transactions can invalidate even a full static simulation.

**Evidence:** `test_I04_contractPreviewIsOnlyAHoldClassifier` passed: zero recipient/amount and a frozen account can return `Hold.None`, while actual calls revert. Current MCP adds checks and contract `pay.staticCall`; this review relies on `pay` enforcing on-chain rules, never those client checks.

**Recommendation:** document the narrow meaning of this existing public view. A future full-simulation helper must preserve actual `pay` semantics, including legal above-budget held requests. Do not use preview as authorization or a reservation.

### I05 — Request storage is permanent (Informational)

**References:** `src/Allowance.sol:308` (append), `:254`, `:269`, `:333` (status updates only); `README.md` Limitations; `docs/ARCHITECTURE.md:84`.

No cleanup method deletes resolved request storage or memos. A live authorized agent can create arbitrarily many held requests if it can pay their transaction/storage costs; no amount is reserved or debited from the account for a hold. Per-call memo length is bounded to 140 bytes. This can grow history and lock storage deposits; creating accounts, trust lists and rotating repeatedly can also grow indexes. Constant-index core payment/request lookup does not scan all history, so a protocol-wide payment DoS was not demonstrated.

**Evidence:** source review confirms status-only resolution; Portaldot deposit amounts/refund ownership were not remeasured. Repository cost claims are historical context, not fresh audit measurements.

**Recommendation:** retain the current warning; evaluate bounded cleanup and deposit refund attribution in a separately reviewed version. A cleanup design must preserve finality of old IDs and prevent double settlement or improper refunds. Do not promise that existing locked deposits can already be reclaimed.

## Controls validated and review coverage

| Area | Source reasoning and test evidence |
|---|---|
| Owner authorization | `_owned` checks the exact stored owner. `test_allOwnerEntryPointsRejectStranger` covers withdraw, rules, trust, freeze, rotation, approve and reject. Funder status gives no authority. No `tx.origin` authentication or arbitrary delegatecall exists. |
| Agent authorization and rotation | `_agentOf` checks current key before freeze/expiry. Old key pay/refuel/cancel rejected; new key can cancel old requests. `accountsOfAgent` is historical and may include rotated-away/duplicate IDs, as its NatSpec states; it is not authority. |
| Freeze and expiry | Exact-expiry tests block instant payment, held request creation and refuel. Frozen paths are covered in the existing suite; cancellation/owner powers are the intentional exceptions in I01. Reordering a valid spend ahead of a freeze is a normal transaction-ordering risk. |
| Budget / asset isolation | Native conservation test balances deposits + third-party funds against payments, refuel, owner approvals, withdrawals and remaining budget. Conventional shared-token accounts plus uncredited donations remain isolated. M01 states the token assumptions. |
| Caps and periods | Existing 1,000-run fuzz test mixes payments, refuels and time jumps. Exact fixed-window boundary test permits the documented reset. Lowering caps below prior spending yields zero remaining capacity; owner-approved payments do not consume period capacity. No rolling-window or invoice-level guarantee is claimed. |
| Integer safety | Solidity checked arithmetic, `_u128`, positive-amount checks and `pay`'s explicit uint128 bound prevent ordinary truncation/wrap exploitation. L01 records the cumulative bound. `payments` and timestamps also have finite widths; practical exhaustion was not demonstrated. |
| Request finality | Status is checked and set before external transfer; outer revert restores status on failure. Existing tests reject replay of resolved/rejected/cancelled requests, permit owner top-up before approval, and confirm no reservation. Request amount/recipient/memo are stored, not accepted again from approver input. |
| External-call reentrancy | All six fund-moving entries (`openAccount`, `fund`, `withdraw`, `pay`, `refuel`, `approve`) share `_lock`. Native callback test attempts all six across accounts and gets `Reentrancy` for each. Authorized ERC-20 callback cannot reenter even into a native account. Existing approval reentry test passes. |
| Unguarded mutations | `setRules`, `setTrusted`, `setFrozen`, `rotateAgent`, `reject`, `cancel` require appropriate owner/current-agent authority and do not send funds. Reentrant authorized changes affect future policy/request state, not a second guarded payout. `balanceOf` is static-call constrained. No unauthorized callback privilege escalation was found. |
| Return data / transfer failures | New tests cover ingress and egress false/malformed/no-data returns, blacklist/revert behavior and atomic rollback. A rejecting recipient blocks its individual payout; the owner can reject a held request and still withdraw elsewhere. Token-wide blacklisting/pausing can freeze that token by external policy; other assets are unaffected. |
| Unsolicited transfers | Tokens sent directly without `fund` do not increase account budgets and have no recovery function. Forced native surplus has no account attribution either. This prevents a random caller from claiming surplus, but direct donations can become stranded. ERC-20 `withdraw` to the Allowance address itself can similarly orphan the owner's entitlement; native self-transfer normally reverts because there is no payable receiver. Avoid self/incorrect destinations. |

Native callbacks occur after ledger effects. Inbound token funding needs an external call before the final received amount is known; it is protected by the global lock. Arbitrary recipient/token gas consumption or token behavior can deny that transaction; a revert rolls back the entire call. There is no persistent lock poisoning from a reverted call. Large trust arrays can exhaust the caller's transaction gas; there is no untrusted loop over all accounts in settlement.

## Unconfirmed concerns and limits

- **Portaldot-specific behavior:** no public RPC inspection or broadcast was performed. Assets precompiles, upgradeable-token behavior, native account/storage-deposit mechanics, gas exhaustion semantics, and refund destinations need chain-specific validation separately. The local EVM results are not an attestation of live collateral or bytecode.
- **Positive rebase/reflection during `_pull`:** the before/after delta could include unrelated balance growth and credit it to the funding account. This follows from source reasoning but no positive-rebase PoC or concrete deployed affected token was validated; no additional confirmed theft finding is asserted.
- **Arbitrary malicious tokens:** a token can lie about `balanceOf`, dynamically disable transfers or change implementation. No proof of arbitrary native/other-token theft by such a token was found. Restricting assets is an operational/design decision, not a guarantee against future token-administrator compromise.
- **Lifetime metadata bounds:** `payments` overflow and uint64 timestamp exhaustion are theoretical checked-revert limits, not demonstrated practical attacks. No chain-reachable native `totalSpent` overflow is claimed.
- **Stateful testing:** the existing fuzz test is one native-account sequence with stable rules. New deterministic tests broaden coverage but do not replace a multi-account state-machine invariant campaign including policy changes and adversarial assets.
- **No finality or UI guarantee:** owner key management, social engineering of approval, stale UI reads, wallet transaction ordering, RPC honesty and reorgs remain external risks. No frontend/MCP check is treated as on-chain enforcement. This phase is not a new audit of their implementations.

## Execution results and static-analysis triage

The tool paths used were:

```sh
# Shorthand used below for the installed local binaries; no dependency was added.
FORGE=/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge
SOLC=/workspace/.allowance-tools/solc-0.8.28
```

| Execution | Actual result |
|---|---|
| Baseline `forge test --use "$SOLC" -vv` before audit tests existed (installed npm Forge launcher) | 27 passed, 0 failed, including 1,000 fuzz runs; log inspected. |
| Initial audit test compilation | Failed: missing `stdError` import in the new PoC. Corrected only the audit test; no production change. |
| `"$FORGE" test --use "$SOLC" --match-path 'test/audit/*' -vv` | Initial 14 audit tests passed; further boundary/control tests then added. |
| `"$FORGE" test --use "$SOLC" -vv` | 46 passed: 27 existing + 19 audit tests; 0 failed/skipped, 1,000 fuzz runs. |
| `"$FORGE" build --use "$SOLC"` | Passed; Foundry lint warnings manually reviewed below. |
| `"$FORGE" fmt test/audit/Phase2A.t.sol` | Formatted only the isolated audit test file. |
| `"$FORGE" fmt --check test/audit/Phase2A.t.sol` and `git diff --check` | Passed after formatting the audit test. |
| `slither --version` | Exit 127: `slither: command not found`. Slither analysis was **not run**. |
| `aderyn --version` | Exit 127: `aderyn: command not found`. Aderyn analysis was **not run**. |

Slither and Aderyn are absent from this environment's executable path. No package installation, external scanner service, or unrelated repository access was attempted. This is an automated-analysis coverage gap, not a clean result from either tool. The direct Forge binary was used for PoC/final verification because the npm launcher was observed returning zero even on an initial compiler error; results above are based on inspected logs and final direct-binary execution.

Foundry's production warnings: timestamp comparisons at `src/Allowance.sol:142`, `:401`, `:408` implement expiry/fixed windows; normal block timestamp dependence is intended and not a randomness exploit. Validators may affect exact boundary inclusion; the economic policy must accept fixed-window timing. Uint128 casts at `:218`, `:299`–`:301`, `:309`, `:325`–`:327`, `:443` are bounded by balance/cap/explicit checks or `_u128`; manual review found no unchecked truncation route. The checked cumulative arithmetic availability issue is separately captured as L01. No Slither/Aderyn findings or false positives are claimed because those tools did not execute.

Audit tests live in `test/audit/Phase2A.t.sol`; all mocks and scenarios are clearly local. They require only the existing forge-std installation. No production mocks, dependencies, ABI, generated website, deployed addresses, or network configuration were edited.

## Prioritized Phase 2B plan

1. **Before expanding token use:** choose a supported-asset policy, explicitly exclude or design accounting for rebasing and sender-surcharge assets, and replace the “any ERC-20” claim. Review any intended Portaldot asset/precompile individually. Do not assume asset code length or a successful transfer proves compatibility.
2. **Before the final:** correct security wording about frozen owner powers, stale requests, gas-wallet freedom, fixed windows, gross token payouts and preview semantics. Explain that rotation does not invalidate pending holds; reject suspicious holds explicitly after compromise.
3. **For a future contract version:** address M01 with an audited token/custody design; consider wider/non-blocking lifetime statistics for L01. Specify request epoch/invalidation and storage cleanup/refund semantics before implementing them. No current deployment should be replaced on the strength of unreviewed patches.
4. **Validation follow-up:** run Slither and Aderyn in a prepared offline-capable development environment, triage actual results, and add multi-account stateful invariants for asset solvency, policy mutations, token callbacks and request races. Add practical token-specific compatibility tests rather than assuming every ERC-20 shares one model.
5. **Before mainnet/material value:** commission an independent professional audit, validate deployed bytecode and chain-specific accounting/refund behavior, and retain conservative budgets. Protect the owner key and minimize the separately exposed agent gas wallet.

No speculative fix, production implementation change, public-network deployment/transaction, or merge is included in Phase 2A.
