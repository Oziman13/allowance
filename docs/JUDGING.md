# Allowance against the Hacker House criteria

This page maps the Hacker House criteria to source, tests, dated transaction records and the delivered demo. It distinguishes local behavior, historical project records, roadmap items and unverified live conditions; current access may prevent an independent chain/video check.

**Current scope, 30 October 2026:** 58 Foundry tests, 118 MCP tests and 24 native read-only unit tests. Existing CI runs Foundry/MCP; native and frontend/browser checks are local validation, not extra CI jobs. See [Phase 4B changes and verification](FINAL-EXPERIENCE-IMPLEMENTATION-PHASE4B.md).

**Historical October 24 artifacts:** [CHECKIN.md](CHECKIN.md), its [walkthrough/screenshots](CHECKIN-2026-10-24.md), the pitch deck and the recorded **2:21** video retain their original dates and measurements. They are not current live-site or native signed-write proof.

**Security scope:** This testnet deployment is not independently audited or recommended for production funds. See the [security policy](../SECURITY.md) and [Phase 2A internal review](SECURITY-REVIEW-PHASE2A.md).

**Quick links:** [Live dashboard](https://oziman13.github.io/allowance/) (press *Try Interactive Demo* if you don't have test POT) · [Contract on Portaldot V3 testnet](../README.md#live-on-portaldot-v3-testnet) · [All transactions](PROOF.md) · [Architecture](ARCHITECTURE.md) · [CI runs](https://github.com/Oziman13/allowance/actions)

## Two-minute jury route

This is a guided **local browser simulation**, independent of public RPCs. Navigation does not submit an action: the visitor chooses each payment, approval and freeze. Start with **Try Interactive Demo**; use the seeded Research agent and its trusted recipient.

| Step | Action and expected result |
|---|---|
| Inspect | 19 POT recorded budget; 4 POT available fixed-window capacity; **1 POT maximum single autonomous payment** to an eligible recipient. Four POT is aggregate capacity, not one payment. |
| Pay | Send **0.1 POT**: a confirmed local payment, budget **18.9 POT**, capacity **3.9 POT**. |
| Hold | Change the amount to **2.5 POT** and send. It is held, **not paid**, with unchanged budget/capacity. Use **Review request #N** to select your newly confirmed request, not a seeded card with the same amount. |
| Approve | The owner approves that exact request: budget **16.4 POT**, autonomous capacity still **3.9 POT** in this example. Approval still requires budget and does not consume autonomous period headroom; a smaller budget could reduce available capacity. |
| Freeze | Use **Freeze agent**: current autonomous capacity and single-payment ceiling are **0**, and new agent payment/refuel/request operations stop. Owner withdrawals and pre-existing approvals remain possible. |
| Compare proof | Open **Recorded Claude testnet proof · 23 October 2026**, still reachable during simulation. Recorded agent 0.3 POT payment → held 2 POT request → owner approval → freeze. These are historical events, not this browser's local hashes or a live Claude session. |

Windows are fixed contract periods, not rolling or calendar days. Native gas refuels share autonomous caps; initial seeds, wallet spending and actual fees/deposits have separate boundaries. Invalid/frozen/expired calls can fail instead of becoming held requests. Recipient restrictions and execution still require a current contract preview.

The historical [October 23 record](PROOF.md#a-real-ai-assistant-on-chain-2026-10-23) and [event export](../evidence/onchain.json) identify the contract, account, recipient, amount and hashes. The recorded recipient was the documented owner address; API/compute service delivery was not independently verified. The reported MCP refusal after freeze produced **no new transaction**. Native inspection is an optional **read-only** technical follow-up; native signed owner operations remain [NO-GO pending live verification](NATIVE-WALLET-VALIDATION-PHASE3B2.md).

---

## Technical Feasibility (30%)

> *Technical approach, system architecture, code completeness and actual delivery; whether core functions are complete, whether GitHub shows genuine and sustained development activity, and whether the project is deployed on Portaldot testnet with verifiable on-chain interactions.*

| What the judges look for | Evidence |
|---|---|
| Deployed on Portaldot testnet | Recorded contract `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f`, chain 420420777, deployment block 102688. Bytecode matched the repository build at evidence capture; this is not a fresh live-availability attestation. |
| Verifiable on-chain interactions | [15 recorded transactions](PROOF.md): deployment plus 14 event-bearing transactions from October 19/23. The latter include Claude/MCP-attributed agent steps, owner interventions and a separate dashboard request. The checked-in export is dated; current RPC/explorer access may be unavailable. Verification instructions and full hashes remain available in the repository. |
| Core functions complete | Per-payment cap, per-period cap (any period of 1 hour or more), trusted recipients, expiry, freeze, key rotation, held requests with approve / approve-and-trust / reject / cancel, gas refuels from the same budget, native POT and ERC-20 budgets. [Contract](../src/Allowance.sol), [function table](../README.md#contract). |
| Code completeness and quality | **58 Foundry tests:** 27 core, 19 Phase 2A, 10 token-compatibility and 2 stateful tests, including 1,000-run fuzz and invariants. **118 MCP tests** cover local-chain, simulated receipts and protocol behavior. These two suites run in CI. **24 native read-only unit tests**, display regressions and browser checks are local validation. Internal [static analysis](SECURITY-STATIC-ANALYSIS-PHASE2B3.md) includes documented findings and limitations; it is not an independent audit. |
| System architecture | [ARCHITECTURE.md](ARCHITECTURE.md): component and sequence diagrams, account model, security properties. |
| Actual delivery | Three working parts, all public: the contract, the [owner dashboard](https://oziman13.github.io/allowance/) (GitHub Pages) and the [MCP server](../mcp/) for AI assistants. |
| Sustained development activity | Historical October 23 snapshot: 35 commits on 8 days (October 16–23). Work continued through security analysis, native read-only validation and jury-experience corrections. See the [current commit history](https://github.com/Oziman13/allowance/commits/main); the dated count is not a live total or certification of qualifying contest commits. |

## Innovation (30%)

> *Innovation in technical solutions, product models and application scenarios; effective use of Portaldot V3.0 features such as WASM/EVM compatibility, modular architecture and multi-chain capabilities; real value beyond existing solutions.*

| What the judges look for | Evidence |
|---|---|
| Real value beyond existing solutions | A wallet key can spend its wallet funds; call permissions alone do not create a spending budget, and an app confirmation screen is not contract enforcement. Allowance bounds authorized autonomous escrow debits for native POT and compatible tokens, with separate owner-approval and agent-wallet boundaries. This is a technical comparison, not a claim that no other product offers spending limits. [Comparison table](../README.md#why-a-wallet-a-proxy-or-an-approval-screen-isnt-enough). |
| Application scenario | "Ask, don't fail": a payment outside the rules is held with the agent's memo and the reason, and the owner decides. The agent stays useful without being trusted with everything. |
| Product model | One contract serves any number of owners and agents. Owners get a dashboard; agents get five MCP tools any assistant can use (Claude, Cursor, …). |
| Use of Portaldot V3 EVM compatibility | Plain Solidity compiled with Foundry runs on V3's contract runtime (pallet-revive) unchanged. We measured what that costs and how to make it fit, and published the method ([guide](SOLIDITY-ON-PORTALDOT-V3.md)). |
| Designed for Portaldot specifically | Native POT refuel withdrawals share autonomous caps; seeds and wallet fees/deposits have separate boundaries. Recorded October 19/23 instant payments cost about 0.03 POT by updating existing storage. These are historical testnet measurements, not fee guarantees. |
| Trying it is easy | The wallet-free browser EVM runs the real bytecode for the core native-POT lifecycle. A navigation-only guide follows your own confirmed payment/request, owner approval and freeze; recorded testnet proof stays accessible. This does not expose every contract feature or constitute a live Claude session. |

## Ecosystem Contribution (20%)

> *Contribution to Portaldot infrastructure, developer tools, node ecosystem, application ecosystem and user growth; potential for sustained building, open-source value and long-term ecosystem collaboration.*

| What the judges look for | Evidence |
|---|---|
| Developer tools and knowledge | [Getting started with Solidity on Portaldot V3](SOLIDITY-ON-PORTALDOT-V3.md): how to fund a MetaMask address through its Substrate twin, what deploying really costs, the storage-deposit pattern, and the wallet fee setting that makes a large deploy fit, all with numbers measured on the live testnet. [`script/fallback_address.py`](../script/fallback_address.py) computes the Substrate account for any 0x address (standard library only). |
| Infrastructure other projects can use | The Allowance contract is a shared spending layer: any Portaldot AI tool, bot, game or wallet can give its agents limited budgets instead of full keys. The [MCP server](../mcp/) turns that into five tools any AI assistant can use. |
| Application ecosystem and user growth | Agents and bots make many small payments, which is the kind of steady on-chain activity the ecosystem wants. Use cases: AI agents paying for APIs and compute, game bots and guild treasuries, subscriptions, team spending. |
| Open-source value | MIT licence, full test suite, CI, reproducible build (`forge build && python3 build.py`), dependencies disclosed. |
| Sustained building | Post-Hacker House roadmap in the [README](../README.md#roadmap-after-the-hacker-house), starting with request-storage cleanup and verification of refund attribution for a future version; the current contract cannot clear resolved requests. |

## Business Potential (20%)

> *Whether the project addresses real market needs, whether target users and use cases are clear, whether the business model and growth path are feasible, and whether the team can continue development, operations and delivery.*

| What the judges look for | Evidence |
|---|---|
| Real market need | AI agents are starting to pay for APIs, data and compute on their own. Every team that deploys one faces the same question, "how much can it spend without asking me?", and today's answer is either too much trust or no autonomy. |
| Target users | Teams running AI agents or bots on Portaldot; game studios and guilds; DAOs and teams that want members to spend within limits. |
| Ability to continue | One developer delivering steadily: a deployed contract, a dashboard, an MCP server, a guide, CI and a simulation mode in the first six days, all public. |
| Business model and growth path | **Open core, proposed paid team layer, no token** ([details](../README.md#business-model)). Subscriptions, multi-person approvals, hosted runners and a capped mainnet v2 fee are roadmap proposals, not delivered features or proven revenue. The current testnet contract has no protocol fee. |

---

## Still missing (honest list)

| Item | Plan |
|---|---|
| Native signed owner operations | The deployed application uses the EVM owner-write path. Native browser inspection is implemented **read-only**, with no signing, mapping or WASM/multi-chain execution claim. Live/runtime/real-wallet gates remain unverified; writes require separate authorization. |
| Demo video (≤ 3 minutes) | Historical [2:21 narrated check-in demo](https://youtu.be/fxO8grGr4PY), not a current live session. A final recording should show delivered EVM/simulation behavior and clearly labeled read-only native inspection; native owner writes are not promised. |
| Pitch deck | Historical [October 24 deck](Allowance-pitch-deck.pdf), 11 pages. Its older counts/plans remain dated; use this page for current scope. |
| MCP server published on npm | Not verified as published; remains a separate release task. |
| Block explorer links | Done: every transaction in [PROOF.md](PROOF.md) links to its block on the [Portaldot V3 testnet explorer](https://scanner-testnet-v3.portaldot.dev/). |

## Code compliance

| Rule | Status |
|---|---|
| Repository public during the event | ✅ |
| At least 3 valid commits during the Hacker House | Historical October 23 snapshot: 35 commits on 8 days (October 16–23); see [history](https://github.com/Oziman13/allowance/commits/main). Current qualifying-commit assessment is separate from this dated count. |
| Code primarily produced during the Hacker House (Oct 14 – Nov 6) | ✅ First commit Oct 16. The idea builds on an earlier proof of concept on another chain; **no code from it is reused** ([disclosure](../README.md#prior-work-disclosure)). |
| Core modules not committed all at once in the last 24 hours | ✅ Core modules were committed on Oct 16–19; the final days are for polish, video and deck. |
| Third-party code properly licensed and disclosed | ✅ [Dependencies](../README.md#prior-work-disclosure): Foundry/forge-std, ethers, EthereumJS (MPL-2.0, bundled unmodified), MCP SDK, zod, and locally hosted Sora, Inter and JetBrains Mono (OFL). |
