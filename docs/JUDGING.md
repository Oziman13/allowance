# Allowance against the Hacker House criteria

The Hacker House judges on objective evidence: GitHub repositories, commit timelines, testnet transaction records, contract addresses, transaction hashes and live demo performance. This page maps each criterion to the evidence for it, so every claim can be checked in a minute. It also says plainly what is still missing.

**October 24 check-in:** [CHECKIN.md](CHECKIN.md), with a [two-minute demo and screenshots](CHECKIN-2026-10-24.md).

**Security scope:** This testnet deployment is not independently audited or recommended for production funds. See the [security policy](../SECURITY.md) and [Phase 2A internal review](SECURITY-REVIEW-PHASE2A.md).

**Quick links:** [Live dashboard](https://oziman13.github.io/allowance/) (press *Try Interactive Demo* if you don't have test POT) · [Contract on Portaldot V3 testnet](../README.md#live-on-portaldot-v3-testnet) · [All transactions](PROOF.md) · [Architecture](ARCHITECTURE.md) · [CI runs](https://github.com/Oziman13/allowance/actions)

---

## Technical Feasibility (30%)

> *Technical approach, system architecture, code completeness and actual delivery; whether core functions are complete, whether GitHub shows genuine and sustained development activity, and whether the project is deployed on Portaldot testnet with verifiable on-chain interactions.*

| What the judges look for | Evidence |
|---|---|
| Deployed on Portaldot testnet | Contract `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` on Portaldot V3 testnet (chain 420420777), deployed in block 102688. The code returned by `eth_getCode` is byte-for-byte this repository's build. |
| Verifiable on-chain interactions | [15 transactions](PROOF.md): the deployment; on October 19 an account opened, two instant payments, a payment held for being over the cap, its approval, a freeze and an unfreeze; on October 23 the same flow driven by a real AI assistant (Claude, through the MCP server). Each one can be checked against the public RPC through the events it emitted ([how](PROOF.md)), or with `python3 script/check_submission.py`. |
| Core functions complete | Per-payment cap, per-period cap (any period of 1 hour or more), trusted recipients, expiry, freeze, key rotation, held requests with approve / approve-and-trust / reject / cancel, gas refuels from the same budget, native POT and ERC-20 budgets. [Contract](../src/Allowance.sol), [function table](../README.md#contract). |
| Code completeness and quality | 46 contract tests, including 19 audit reproductions and a 1,000-run native-account fuzz test of combined autonomous debits per fixed window under unchanged rules. They also cover reentrancy, fee-on-transfer and false-returning tokens, and recipients that refuse funds. 37 MCP tests include local-chain, simulated-receipt and real MCP-protocol coverage. Both suites [run in CI on every push](https://github.com/Oziman13/allowance/actions). |
| System architecture | [ARCHITECTURE.md](ARCHITECTURE.md): component and sequence diagrams, account model, security properties. |
| Actual delivery | Three working parts, all public: the contract, the [owner dashboard](https://oziman13.github.io/allowance/) (GitHub Pages) and the [MCP server](../mcp/) for AI assistants. |
| Sustained development activity | 35 commits on 8 days (October 16–23), each one a reviewable step: contract and tests → dashboard → MCP server and CI → size-tuned build and guide → simulation mode → testnet deployment and proof → MCP fixes from a live Claude session → dashboard redesign. History: [commits](https://github.com/Oziman13/allowance/commits/main). |

## Innovation (30%)

> *Innovation in technical solutions, product models and application scenarios; effective use of Portaldot V3.0 features such as WASM/EVM compatibility, modular architecture and multi-chain capabilities; real value beyond existing solutions.*

| What the judges look for | Evidence |
|---|---|
| Real value beyond existing solutions | Today, giving an AI agent money means giving it a wallet key, a proxy, or a confirmation screen in an app. A wallet key can spend everything. A proxy limits *which* calls, not *how much*. A confirmation screen is a UI check, not an on-chain rule, so a compromised agent can skip it. Allowance puts the limits on chain, bounding authorized autonomous escrow debits for native POT and compatible tokens; owner approvals and funds in the agent wallet have separate boundaries. [Comparison table](../README.md#why-a-wallet-a-proxy-or-an-approval-screen-isnt-enough). |
| Application scenario | "Ask, don't fail": a payment outside the rules is held with the agent's memo and the reason, and the owner decides. The agent stays useful without being trusted with everything. |
| Product model | One contract serves any number of owners and agents. Owners get a dashboard; agents get five MCP tools any assistant can use (Claude, Cursor, …). |
| Use of Portaldot V3 EVM compatibility | Plain Solidity compiled with Foundry runs on V3's contract runtime (pallet-revive) unchanged. We measured what that costs and how to make it fit, and published the method ([guide](SOLIDITY-ON-PORTALDOT-V3.md)). |
| Designed for Portaldot specifically | Gas on Portaldot is POT, so native refuel withdrawals share autonomous payment caps. Initial seeds are outside those caps, and fees/storage costs paid from the wallet are not individually metered by Allowance. Storage writes cost a deposit on V3, so instant payments only update existing storage: 0.03 POT each, measured on chain. |
| Trying it is easy | The dashboard's simulation mode runs the real contract bytecode in an in-browser EVM, with a demo agent already spending, so anyone can try every rule in seconds without a wallet or test tokens. |

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
| Business model and growth path | **Open protocol, paid team layer, no token** ([details](../README.md#business-model)). The core is free and open source, so it can become shared infrastructure. Teams pay a subscription for alerts, approvals by more than one member, reports and hosted agent runners. On mainnet, a v2 contract adds a small, capped protocol fee on instant payments. Revenue grows with agent payment volume on Portaldot, which is the on-chain activity the ecosystem rewards. |

---

## Still missing (honest list)

| Item | Plan |
|---|---|
| Use of V3's Substrate side (WASM / multi-chain) | Today Allowance uses V3's EVM side. Next: let an owner fund and manage an allowance from a Portaldot (Substrate) wallet, not only from MetaMask. |
| Demo video (≤ 3 minutes) | Done: [2:21 narrated demo](https://youtu.be/fxO8grGr4PY). A new recording for the final will add the Portaldot-account owner actions. |
| Pitch deck | Done: [Allowance-pitch-deck.pdf](Allowance-pitch-deck.pdf), 11 pages. |
| MCP server published on npm | Before the final submission. |
| Block explorer links | Done: every transaction in [PROOF.md](PROOF.md) links to its block on the [Portaldot V3 testnet explorer](https://scanner-testnet-v3.portaldot.dev/). |

## Code compliance

| Rule | Status |
|---|---|
| Repository public during the event | ✅ |
| At least 3 valid commits during the Hacker House | ✅ 35 commits on 8 days (October 16–23); see [history](https://github.com/Oziman13/allowance/commits/main) |
| Code primarily produced during the Hacker House (Oct 14 – Nov 6) | ✅ First commit Oct 16. The idea builds on an earlier proof of concept on another chain; **no code from it is reused** ([disclosure](../README.md#prior-work-disclosure)). |
| Core modules not committed all at once in the last 24 hours | ✅ Core modules were committed on Oct 16–19; the final days are for polish, video and deck. |
| Third-party code properly licensed and disclosed | ✅ [Dependencies](../README.md#prior-work-disclosure): Foundry/forge-std, ethers, EthereumJS (MPL-2.0, bundled unmodified), MCP SDK, zod, and locally hosted Sora, Inter and JetBrains Mono (OFL). |
