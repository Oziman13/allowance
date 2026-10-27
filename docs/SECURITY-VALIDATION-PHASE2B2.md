# Allowance — Phase 2B-2 advanced security validation

Date: 2026-10-27. **Internal validation, not an independent audit or a certification of safety.** No production fix is included. The testnet-only guidance and exclusions in [SECURITY.md](../SECURITY.md) remain in force.

## Baseline and scope

- Repository: `Oziman13/allowance`; `git fetch origin main` succeeded.
- Exact fetched and tested production base: **`cdb7f4aa7f1b52b404e57d610428319c06ea7def`**, matching the requested starting commit.
- Branch: `codex/allowance-advanced-security-phase2b2`, derived directly from that base.
- Reviewed: all of `src/Allowance.sol`, the original contract tests, `test/audit/Phase2A.t.sol`, the [Phase 2A report](SECURITY-REVIEW-PHASE2A.md), [SECURITY.md](../SECURITY.md), and `foundry.toml`.
- Production-source SHA-256: `3a84a84647c051aa2015316d86ffbf70777ae824932fe7e9c5ad875a7df27474` (`src/Allowance.sol`). Source was unchanged.
- New files: this report; `test/invariant/AllowanceStateful.t.sol`; `test/audit/TokenCompatibility.t.sol`. Existing assertions, tests, configuration, ABI, MCP code, frontend, addresses and production dependencies were not changed.
- All execution used local Forge EVMs or localhost Anvil. Local test deployments are fixtures only; no public RPC token testing, broadcast, deployment, live-collateral verification or merge occurred.

## Results at a glance

| Execution | Actual result |
|---|---|
| Existing Foundry suite before additions | **46 passed**, zero failed/skipped; original 1,000-run native-account fuzz test included |
| Final complete Foundry suite, seed `0x2b2` | **58 passed**, zero failed/skipped: 46 existing + 10 token tests + 1 deterministic handler coverage test + 1 invariant property |
| Stateful campaign, seed `0x2b2` | **128 runs × depth 128 = 16,384 handler calls**; zero handler reverts/discards |
| Second stateful campaign, seed `0x2b2002` | Same configuration, **16,384 calls**; invariant and deterministic handler test both passed; zero handler reverts/discards |
| Existing MCP suite (supplementary compatibility check) | **37 passed**, zero failed/skipped; localhost only |
| Build (including `--sizes`) / formatting / whitespace | Passed; Foundry lint warnings manually triaged below |
| Slither / Aderyn | Unavailable: availability and analysis commands exited 127; **neither scanner executed** |

The two reported stateful seeds cover **256 traces and 32,768 randomized handler calls**, excluding fixture setup and deterministic coverage steps. They are finite sampled executions, not a proof over arbitrary sequences. An earlier 8-run/depth-32 development smoke run and initial full run also passed; the figures above describe the final reproducible campaigns rather than inflating coverage with development reruns.

No new Critical or High finding was established. Known unsupported-asset failures still reproduce. The previously unconfirmed positive-rebase-during-funding behavior is now demonstrated locally, with a specifically limited impact described below.

## Stateful reference model

### Actors, pools and bounds

The handler starts nine accounts: three distinct owners each own one account for native currency and one for each of two independent standard ERC-20 pools. Each initially uses the corresponding one of three agent keys. Additional openings choose owners, agents and assets separately, up to eighteen accounts per trace. Rotation permits different owners' accounts to share an agent.

Participants are three owner EOAs (`0x1101`–`0x1103`), three agent EOAs (`0x2101`–`0x2103`), an unrelated caller/funder (`0x3101`) and three recipient EOAs (`0x4101`–`0x4103`). Call selection includes the correct owner/current agent, another real owner/agent, the most recently revoked key where distinct, and the outsider. It does not assume that being another account's owner gives global authority.

Random actions are limited to twelve explicitly targeted handler selectors: `open`, `fund`, `pay`, `refuel`, `withdraw`, `resolve`, `policy`, `trust`, `freeze`, `rotate`, `advance`, `donate`. Getters, assertions and raw token mint/approval methods are not fuzz targets. Amounts are zero through 200 raw units for ordinary operations; openings deposit 100–1,099 units, initially 1,000. Rules use per-call caps 10–100, period caps one to four times the per-call cap, and periods one to three hours. Expiry may be disabled, effective immediately or in the future. Monotonic jumps are zero through six hours. Native opening seeds are separately modeled.

`open` no-ops after the eighteen-account bound. `resolve` no-ops until a request exists. These are explicit bounded-harness choices, not production restrictions. Selector counts below include attempts, expected denials and these no-ops; they are not counts of successful settlements.

### Independent accounting and execution checks

The handler maintains its own account/request records from supplied inputs and operations, not from production getters or `preview` results. Expected authorization, freeze/expiry state, trusted-recipient decisions, amounts, window starts, request status and resulting debits are computed before invoking the contract. Production getters are used only afterward as observations against that reference. Actual recipient and agent balance deltas are also checked.

For every model account:

```text
funded = remaining budget + owner withdrawals + autonomous debits + approved debits
totalSpent = initial gas seed + autonomous debits + approved debits
```

For native currency and each of the two compatible-token pools separately:

```text
actual escrow holdings = sum(model account budgets) + tracked unallocated surplus
```

`donate` models forced native surplus using `vm.deal` on escrow, and unsolicited tokens using direct mint; neither credits any account. Actor balances and token supplies are replenished as local fixtures for funding. This is a budget/custody model, not a model of real transaction fee economics.

The aggregate `invariant_referenceLedgerPermissionsAndBacking` compares balances, current owner/agent/policy, freeze state, stored/effective period usage, lifetime totals, payment counters, trust entries, every known request's immutable fields/status, and actual backing with the reference after handler actions. It also enforces reference conservation and at-most-one approval settlement. Expected failures require both failure and the **exact expected custom-error data**; unexpected success, unexpected failure and assertion failures fail the test. Production reverts are checked outcomes, not silently swallowed exceptions.

### Threat coverage

| Threat / invariant | How checked |
|---|---|
| Unauthorized escrow movement or policy change | Caller chosen independently of the target account; owner and agent methods must return the appropriate authorization error. Any unexpected successful call fails immediately; all account ledgers/backing are checked afterward. Third-party funding grants no authority. |
| Native budget backing including surplus | Independent conservation ledger plus actual native contract holdings, with tracked forced donations and seed transfers outside budget. |
| Current autonomous policy | Expected settlement/hold/error is derived from current modeled owner policy, trust, budget, freeze/expiry, and the fixed window at execution time; successful pay/refuel must match actual receiver balance changes and reference debits. |
| Request finality / replay | Requests are independently recorded when expected holds occur. Resolution samples pending and already resolved requests. Replayed approval/cancel/reject must fail; actual statuses and amounts must match. |
| Frozen / expired agent operations | `pay` and `refuel` fail against modeled live state, including exact expiry; the coverage script explicitly exercises both denials. |
| Revoked keys | Modeled current and revoked keys are distinct; old pay/refuel/cancel attempts require `NotAgent`. Rotation does not invalidate pending requests or prevent owner approvals. |
| Owner approvals versus autonomy | Separate autonomous/approved ghost totals; approval does not roll/debit modeled period usage. Successful `Paid` logs check contract emitter, account, recipient, amount and memo; owner resolution additionally requires a `RequestResolved` event, absent on autonomous pay. Full request state and actual delivery are also checked. |
| Compatible ERC-20 backing | Two shared standard-token pools are measured separately; model budgets and observed transfers must conserve each asset. Unsupported assets are deliberately excluded from this solvency invariant and tested as counterexamples separately. |

The model permits legitimate owner withdrawals, policy edits and approval while frozen/expired, and leaves stale requests intact until resolved. If rules are lowered below previous spending, remaining capacity clamps to zero; it does not retroactively require the historical spend to fit the new cap. Windows roll on successful pay/refuel after their duration elapses, including a pay that creates a hold. There is no rolling-window invariant or invoice-level restriction.

### Configuration, coverage and fail behavior

Contract-local `forge-config` annotations set **runs 128, depth 128, fail-on-revert true**. They preserve the repository's compiler/deployment settings and default fuzz-run count. The second campaign and final full campaign ran without environment overrides, confirming the inline run/depth configuration is picked up. `fail-on-revert` is essential: a failed handler assertion must not be treated as an acceptable discarded action.

The deterministic `test_handlerScriptExercisesSuccessesDenialsAndOldRequests` checks positive counters for instant payments, holds, approvals, cancellations, refuels, withdrawals, rotations, denials and expiry denials. It performs cross-asset transfers, third-party funding, trust/policy changes, time passage, donations, approval during freeze after rotation, explicit revoked-key cancellation denial, and replay denial. It ensures the suite can exercise real transitions rather than only rejecting transactions. It does not claim that every randomized trace contains every successful transition.

Recorded random selector attempts:

| Selector | Seed `0x2b2` | Seed `0x2b2002` |
|---|---:|---:|
| advance | 1,368 | 1,379 |
| donate | 1,317 | 1,370 |
| freeze | 1,356 | 1,328 |
| fund | 1,380 | 1,323 |
| open | 1,385 | 1,363 |
| pay | 1,282 | 1,445 |
| policy | 1,350 | 1,339 |
| refuel | 1,416 | 1,380 |
| resolve | 1,362 | 1,369 |
| rotate | 1,373 | 1,332 |
| trust | 1,395 | 1,385 |
| withdraw | 1,400 | 1,371 |
| **Total** | **16,384** | **16,384** |

All listed selectors had zero handler reverts and zero Forge discards. Expected contract-level denials occur inside successful handler calls; zero handler reverts does not mean no production operation was rejected.

## Local token compatibility matrix

This matrix combines the unchanged Phase 2A adversarial tests with the ten added compatibility tests. No real Portaldot token, deployed asset contract or Assets precompile was exercised. “Compatible” below means the tested local behavior fits the current accounting assumptions for testing; **no token or deployment is endorsed for production funds**. There is no on-chain allowlist.

| Local class | Deposit credit | Escrow solvency | Does nominal payment equal net delivery? | Withdrawal availability | Assessment |
|---|---|---|---|---|---|
| Standard ERC-20 | Exact observed deposit and top-up | Preserved across shared accounts and stateful operations | Yes for this honest mock | Full recorded balance available | Compatible model for testing |
| Honest no-return, both directions | Exact; empty return accepted on deposit/top-up | Preserved in round trip | Yes for this honest mock | Full recorded balance available | Compatible if transfer/balance semantics are honest; empty return is no proof of honesty |
| Inbound recipient-deducted fee | Deposit 100 credits 99; another 100 credits another 99 | Preserved in this specific inbound-only fee mock | Outbound transfer is exact in this mock | Full credited 188 remains withdrawable after payment 10 | Conditional; does not establish generic fee-token support |
| Outbound recipient-deducted fee | Exact in this mock (no inbound fee) | Preserved when escrow debit equals nominal amount | No: payment 10 delivers 9 | Ledger withdrawal 90 succeeds but delivers 89 | Conditional gross/net semantics; unsuitable for guaranteed exact net delivery |
| Additional sender surcharge | Initially correct; ordinary deposit alone is not sufficient | **Not preserved:** outbound excess debit consumes same-token pooled backing | Recipient may get nominal amount while collector receives extra | Victim's full recorded claim can revert | Unsupported, M01 |
| Negative rebase | Correct before rebase | **Not preserved:** two 100 claims backed by 100 after a 50% rebase | Early payout can be nominally full; later claims lack backing | First withdrawer can exhaust pool, leaving another claim stranded | Unsupported, M01 |
| Positive rebase outside funding | Original deposits credited; growth not attributed | Surplus instead of insolvency in this scenario | Nominal withdrawals can succeed | Recorded budgets withdraw, but growth remains unallocated | Unsupported; no rebase-share accounting |
| Positive rebase during funding | Observed delta includes pool growth: funding 1 credits 102 in the specific proof | Nominal claims remain backed in the proof | The funding account can withdraw growth attributable to existing holdings | Withdrawal succeeds; other account keeps principal but not its growth attribution | Unsupported; newly confirmed attribution behavior, not a demonstrated principal drain |
| False-returning token | Failed deposit/top-up rolls back | Prior backing preserved on failure | No completed payout if transfer returns false | Fails while false-return mode is enabled; succeeds after honest mode restored | Restricted/misbehaving behavior; not dependable settlement |
| Malformed boolean return data | Invalid data reverts and rolls back | Prior backing preserved on failure | No completed payout for malformed transfer return | Fails until valid mode restored | Unsupported malformed interface |
| Reverting / blacklist-like transfer | Prior deposit remains when outbound restriction is enabled | Recorded/actual balance preserved after failed calls | No delivery; pay and approval revert | Unavailable while restricted, restored in mock when restriction is removed | Conditional token-admin availability risk, not unrestricted settlement |
| Callback / reentrancy token and native recipient | Honest transfer still credits normally in tested mocks | Preserved in tested callbacks | Honest outer transfer succeeds; nested fund-moving calls blocked | Full remaining token withdrawal succeeds in the new proof while a cross-asset callback is blocked | Conditional on honest token economics and callback success; no generic malicious-token endorsement |
| Dishonest true-returning no-op token | A successful initial deposit does not establish future honesty | Outbound no-op leaves an unattributed surplus after ledger debit in the proof | **No:** contract can record paid without recipient receipt | Not guaranteed by a success return | Unsupported |

### Evidence mapping

New `test/audit/TokenCompatibility.t.sol`:

- `test_standardTokenDepositFundPayWithdraw`, `test_honestNoReturnOnBothDirectionsDepositFundPayWithdraw`: deposit, top-up, instant settlement, exact receipt, full remaining withdrawal and empty escrow.
- `test_inboundRecipientFeeCreditsDeltaAndAllowsFullCreditedWithdrawal`, `test_outboundRecipientFeeKeepsBackingButReducesPaymentAndWithdrawalReceipt`: credit/backing checks and actual recipient/owner balance deltas in both fee directions.
- `test_falseReturnsDoNotCreditDepositsOrDebitFailedWithdrawals`, `test_malformedReturnsDoNotCreditDepositsOrDebitFailedWithdrawals`: failed ingress and failed withdrawals preserve both budget and backing, then honest-mode recovery works.
- `test_blacklistRevertsPayApprovalAndWithdrawalWithoutAccountingLoss`: all three payout paths revert, the held request stays pending, backing remains and withdrawal recovers after the mock restriction is removed.
- `test_callbackTokenWithdrawalSucceedsWithoutReenteringOtherAsset`: the authorized token-agent callback is blocked during pay and withdrawal; the owner receives the full remaining token budget and the other native account retains its backing.
- `test_positiveRebaseOutsideFundingLeavesUnallocatedSurplus`, `test_positiveRebaseInsideFundingCreditsOtherAccountsYieldToFunder`: explicit separate rebase timing proofs.

Unchanged `test/audit/Phase2A.t.sol` remains necessary matrix evidence: `test_M01_senderSurchargeConsumesAnotherAccountsBacking`, `test_M01_negativeRebaseMakesClaimsInsolventAndFirstWithdrawerWins`, `test_incomingNoReturnWorksAndFalseMalformedRollBackOpenAndFund`, `test_tokenFalseMalformedAndBlacklistRevertAtomically_noDataWorks`, `test_I03_dishonestTrueReturnCanReportPaymentWithoutTransfer`, `test_callbacksBlockAllSixFundMovingEntryPointsAcrossAccounts`, and `test_tokenCallbackCannotReenterNativeAccountEvenWhenAuthorizedAgentOfBoth`. These ran as part of the complete suite, not merely as cited historical results. Callback evidence is bounded to the tested call patterns; it does not establish arbitrary token honesty or every callback interleaving.

## Findings and impact

### Newly reproduced: positive rebase during `_pull` credits unrelated pool growth

**References:** `src/Allowance.sol:432` (`_pull` before/after balance delta), `:198` (`fund`), and `:185` (`openAccount` also uses `_pull`). Local proof: `test_positiveRebaseInsideFundingCreditsOtherAccountsYieldToFunder`.

Prerequisite: an unsupported share-based token globally rebases upward during `transferFrom`. A victim account already holds 100 units; another account starts at zero. Funding that second account with one unit moves one share to the pool and then doubles the token index. Escrow grows from 100 to 202. `_pull` observes delta 102, so the funding account is credited 102 and can withdraw it. The original account retains a recorded and actually backed principal of 100; its 100 units of growth were attributed to the funder along with the funder's own rebased two units.

This locally confirms a concern formerly left unconfirmed in Phase 2A. It is an **Informational extension of the unsupported-rebase boundary**, not evidence of a new general authorization flaw, a native-token exploit, or loss of victim nominal principal in this proof. The mock's rebase hook is intentionally adversarial; no deployed token with that mechanism was identified. Ordinary positive rebases outside funding instead leave unallocated surplus in the separate proof. Both support keeping rebasing/reflection assets excluded under the existing policy.

### Prior findings remain

- **M01, Medium:** negative rebase / sender-surcharge pooled insolvency still reproduce. Same-token funds can be lost or unavailable under those economics; there is no evidence here of unrelated/native-asset loss.
- **L01, Low:** the original lifetime-counter overflow proof still passes. Its extreme bound and surviving owner withdrawal remain unchanged; no production fix was made.
- **I01–I05, Informational:** stale requests, free wallet use of gas funds, nominal versus net payout semantics, advisory preview and retained request storage remain limitations. Stateful testing permits intentional owner powers rather than flagging them as bypasses.

No successful unauthorized escrow drain, double settlement or applicable-rule violation was observed in the reported native/standard-token campaigns. This is sampled evidence under the bounded model, not an assertion that no such defect exists.

## Static analysis: blockers and manual triage

Tool availability and production-scope attempts were actually made:

| Tool / command | Actual outcome |
|---|---|
| `slither --version` | Exit 127, `slither: command not found` |
| `slither src/Allowance.sol` | Exit 127, same blocker; no analysis executed |
| `aderyn --version` | Exit 127, `aderyn: command not found` |
| `aderyn . --src src --output work/phase2b2-aderyn.json` | Exit 127, same blocker; no report produced |

Versions, scanner findings and scanner false positives are therefore **unavailable**, not clean. Running them requires separately provisioning Slither (and its compiler integration) and Aderyn. No project dependency/lockfile change, installer, third-party binary download or external scanning service was used. Downloads/installers need explicit approval under this task; the remaining validation proceeded without them. Absence from the executable path is the observed blocker, not a claimed scanner incompatibility with this source.

The available tools were **Forge 1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`) and **Solidity 0.8.28** (`7893614a`). The existing compiler flags remain Cancun, optimizer enabled with one run, via IR, and 1,000 fuzz runs.

`forge build` passed and emitted Foundry lint warnings. Production timestamp comparisons at `src/Allowance.sol:142`, `:401`, `:408` are intentional expiry/fixed-window checks, not randomness logic. Exact boundary ordering remains a chain/timestamp assumption. Uint128 casts at `:218`, `:299`–`:301`, `:309`, `:325`–`:327`, `:443` have balance, cap, explicit-width or `_u128` checks; no truncation bypass was established. Checked lifetime-counter overflow remains L01. Test-mock assembly is limited to manufacturing return data in local fixtures and is not a production change. This manual lint triage is not a substitute for either unavailable scanner.

## Reproduction

Use the existing Forge/forge-std installation and a Solidity 0.8.28 compiler. No dependency installation is needed for these additions. In this environment the commands used the direct installed binaries, avoiding the npm launcher behavior recorded in Phase 2A:

```sh
FORGE=/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge
SOLC=/workspace/.allowance-tools/solc-0.8.28
ANVIL_BIN=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil

# Before adding new files: existing 46-test baseline.
"$FORGE" test --use "$SOLC" -vv

# Final complete suite: 58 tests, including inline-configured 128 x 128 invariant.
"$FORGE" test --use "$SOLC" --fuzz-seed 0x2b2 -vv

# Independent second seed: invariant + deterministic coverage test.
"$FORGE" test --use "$SOLC" --match-contract AllowanceStatefulTest --fuzz-seed 0x2b2002 -vv

# Optional focused replay, no new tests or looser assertions.
"$FORGE" test --use "$SOLC" --match-contract TokenCompatibilityTest -vv
"$FORGE" build --use "$SOLC" --sizes
"$FORGE" fmt --check test/invariant/AllowanceStateful.t.sol test/audit/TokenCompatibility.t.sol
git diff --check
ANVIL="$ANVIL_BIN" npm test --prefix mcp
```

The focused token-only replay above is provided as an optional command; the ten tests were executed in the complete suite. Baseline was run before the additions, so replaying the current default suite now includes them. `foundry.toml` and existing tests were not edited. No invariant failure needed shrinking/replay, no assertion was weakened, and no failing production scenario was suppressed to obtain a green run.

## Limitations and prioritized next work

1. **Provision the missing scanners with approval**, pin versions and triage real findings before claiming static-analysis coverage. A professional independent audit remains necessary before material-value/mainnet use.
2. **Keep the asset exclusions.** Compatibility depends on token implementation, mutable policy and real chain behavior, not symbol or interface. No real Portaldot token/precompile or upgradeable implementation was tested. Positive-rebase proofs add support for existing exclusions rather than relaxing them.
3. **Extend the bounded campaign deliberately:** longer runs/depth, additional seeds, amount/boundary distributions and per-action success statistics, cross-role owner/agent smart contracts, multiple revoked generations, callback interleavings, invalid account/request IDs, invalid addresses/memos/rules, and rejecting receivers. The present property uses honest standard tokens and EOA recipients; adversarial callbacks/rebases/fees are deterministic separate tests. It does not require every operation to succeed in each random trace.
4. **Separate chain economics from the model:** the handler uses raw small units, local minting and balance replenishment, no transaction fees, no storage-deposit model, no fork or reorg/finality model. Extreme integer bounds retain existing dedicated tests; randomized small amounts do not re-prove them. Forced surplus is simulated directly rather than by deploying a force-send contract.
5. **Review future contract designs separately:** M01-compatible custody/adapters, non-blocking lifetime statistics, request invalidation/epochs and cleanup/refund attribution need explicit design and further review. No speculative fix, allowlist, source/ABI change, production dependency, frontend/MCP behavior change or public deployment is part of this branch.
