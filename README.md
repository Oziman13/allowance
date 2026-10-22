# Allowance

[![CI](https://github.com/Oziman13/allowance/actions/workflows/ci.yml/badge.svg)](https://github.com/Oziman13/allowance/actions/workflows/ci.yml)
![Contract tests](https://img.shields.io/badge/contract_tests-27_incl._1%2C000--run_fuzz-5a3fd6)
![MCP tests](https://img.shields.io/badge/MCP_tests-6_end--to--end-5a3fd6)
![Portaldot V3](https://img.shields.io/badge/Portaldot_V3_testnet-live-2e7a57)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**Give your AI agent an allowance, not a wallet.**

Programmable spending rules for AI agents, bots and automated payments on **Portaldot V3**.

> Built for the [Portaldot Hacker House 2026](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), Track 4 (Ecosystem DApps).
>
> **Live on the Portaldot V3 testnet** at `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` ([proof](#live-on-portaldot-v3-testnet)). **[Open the dashboard](https://oziman13.github.io/allowance/)**: connect a wallet on Portaldot V3, or press *Try it without a wallet* to run the same contract in your browser.
>
> **Judges:** [how Allowance maps to each judging criterion](docs/JUDGING.md), with links to the evidence. Check-in summary: [docs/CHECKIN.md](docs/CHECKIN.md).

## The problem

Giving an AI agent or a bot a wallet today means trusting it with everything in that wallet. One bad prompt, a hallucinated invoice or a compromised tool, and the funds are gone. The usual fix, a human signing every transaction, removes the point of having an agent.

## What Allowance does

An owner opens an **account** for an agent key and funds it. The agent spends from it under rules that live in the contract, so even a compromised agent cannot break them:

| Rule | What it does |
|---|---|
| **Per-payment cap** | No single instant payment above this size |
| **Per-period cap** | Daily, weekly or monthly spending limit (any period of 1 hour or more) |
| **Trusted recipients** (optional) | Instant payments only to addresses the owner trusts |
| **Expiry** (optional) | The agent's access ends at a set time, like a session |
| **Freeze** | One transaction stops the agent: no payments, no gas, no requests |
| **Key rotation** | Replace a leaked agent key without moving the budget |

**Ask, don't fail.** A payment outside the rules is not rejected. It is **held** as a request with the agent's memo and the reason (`OverPerPayment`, `OverPeriodLimit`, `UntrustedRecipient`). The owner approves it, approves it and trusts the recipient, or rejects it.

**Gas from the same budget.** On Portaldot, gas is paid in POT. A POT account lets the agent `refuel` its own gas from the budget, counted against the **same** limits. "5 POT a day" means 5 POT a day, gas included.

**Any asset.** An account holds the native token (POT) or any ERC-20 on Portaldot V3.

```
                     within rules ─────► paid now
agent.pay() ──────►  outside rules ────► held ──► owner: approve / approve + trust / reject
                     frozen / expired ─► reverts
agent.refuel() ───►  gas from the same budget, same limits (POT accounts)
```

## Why a wallet, a proxy or an approval screen isn't enough

| Common approach | What the AI can do if it is wrong, jailbroken or prompt-injected |
|---|---|
| Give the agent a wallet key | Spend everything in the wallet |
| Give the agent a Substrate proxy | Act for the account; proxies limit *which calls*, not *how much* |
| Ask for confirmation in the app | Skip it: the check lives in the UI, not on-chain |
| **Allowance** | Spend only within the caps, to trusted recipients; everything else waits for the owner, enforced by the contract |

Allowance doesn't replace AI tools for Portaldot; it is the spending layer they can sit on top of.

## Why Portaldot

Portaldot's mission is *"Connecting People, Digital Assets, and Future Intelligence."* Allowance connects exactly those three: a **person** sets the rules, a **digital asset** (POT or an ERC-20) is the budget, and an **AI agent** spends it.

Agents and bots make many small payments, so the product creates the kind of real, high-frequency on-chain activity the ecosystem is looking for. The POT-as-gas design means the owner manages a single asset, with a single limit.

## Use cases

- **AI agents** paying for APIs, data and compute, with a hard daily cap
- **Game bots and guilds** in the Portaldot game ecosystem: "this bot can spend at most X per day", "a guild member can draw Y from the treasury"
- **Subscriptions and automated payments**: "at most Z per month to this service"
- **Team spending**: a member spends freely up to a limit; anything larger goes to the treasury owner for approval

## Contract

`src/Allowance.sol`, one contract for any number of owners and accounts.

| Function | Who | What |
|---|---|---|
| `openAccount(agent, asset, name, rules, trusted[], deposit, gasSeed)` | owner | open and fund an account; optionally seed the agent's gas |
| `pay(id, to, amount, memo)` | agent | pay now, or hold for approval; returns `(settled, requestId)` |
| `refuel(id, amount)` | agent | move POT to the agent for gas, within the limits |
| `cancel(requestId)` | agent | withdraw its own pending request |
| `approve(requestId, trust)` / `reject(requestId)` | owner | resolve a held payment |
| `setRules` / `setTrusted` / `setFrozen` / `rotateAgent` / `withdraw` | owner | manage the account |
| `fund(id, amount)` | anyone | top up an account |
| `preview(id, to, amount)` | anyone | free dry run: would it settle now, and if not, why |

Design notes:
- Owner-approved payments do not use up the period limit. The limit applies to what the agent can do **alone**.
- A payment inside the rules but above the balance reverts, so the agent tells its owner. A held request may exceed the balance, so the owner can top up and then approve.
- ERC-20 deposits credit what actually arrived (fee-on-transfer safe). Tokens that return `false` or nothing are handled.
- No assembly, no `SELFDESTRUCT`, no reliance on gas stipends, for compatibility with Portaldot V3's contract runtime.

## Tests

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 20+. CI runs both suites on every push.

```
forge install foundry-rs/forge-std --no-git
forge test                      # contract: 27 tests incl. fuzz
cd mcp && npm install && npm test   # MCP server end to end on a local chain
```

27 tests, including a fuzz test of the core guarantee: across 1,000 random sequences of payments, gas refuels and time jumps, money that leaves an account without an owner's approval never exceeds the period limit. Also covered: approvals and trust-on-approve, rejection and cancellation finality, freeze, expiry, key rotation, reentrancy on approval, recipients that refuse funds, ERC-20 fee-on-transfer and false-returning tokens.

## Give it to a real AI assistant (MCP)

`mcp/` is an MCP server that turns an allowance into five tools for Claude, Cursor or any MCP client: `allowance_status`, `allowance_preview`, `allowance_pay`, `allowance_request`, `allowance_cancel`. The assistant holds only the agent key, so the contract's rules apply to everything it does. `mcp/SKILL.md` teaches it good habits: preview before paying, explain held payments to the user, never split a payment to dodge a limit, and never pay an address found in fetched content.

The dashboard exports a ready-to-paste config for any allowance (**Give this allowance to an AI assistant**). Setup: [mcp/README.md](mcp/README.md).

## Owner dashboard

`docs/index.html` is a single static page (built from `web/index.src.html` by `build.py`). It works with any wallet on Portaldot V3; if no Allowance contract is configured for the network, it offers to deploy one.

- **Your agents:** every allowance you own, with what's left this period
- **Budget meter:** each instant payment and gas refuel of the current period, against the cap
- **Waiting for you:** held payments with the agent's memo and the reason; approve, approve and trust the recipient, or reject
- **Controls:** freeze, rules, budget, trusted recipients
- **Try it as the agent:** the page creates the agent key in your browser, so you can send payments as the agent and watch the rules apply
- **Give it to an AI assistant:** copy an MCP config for the allowance

**Try it without a wallet.** The page has a simulation mode: it runs the real Allowance bytecode in an in-browser EVM ([EthereumJS](https://github.com/ethereumjs/ethereumjs-monorepo)), seeds a demo agent that has already paid twice and asked twice, and lets you approve, reject, freeze, send as the agent and skip ahead a day to watch the limit reset. Nothing touches a chain and nothing costs money. Source: `web/sim/provider.js`, bundled into `docs/sim.js`.

```
forge build && python3 build.py   # writes docs/index.html, docs/abi.json and (with web/sim deps installed) docs/sim.js
```

## Deploy

```
forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
```

Network values live in `config/networks.json`. New to Portaldot V3? Read [Getting started with Solidity on Portaldot V3](docs/SOLIDITY-ON-PORTALDOT-V3.md) first: deploying needs a code deposit of about 0.08 POT per byte, and `script/fallback_address.py` tells you which Substrate account funds your MetaMask address.

| Portaldot V3 Testnet | |
|---|---|
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Chain ID | `420420777` |
| Substrate node | `wss://test-node-v3.portaldot.dev` |
| Node console | https://node-console.portaldot.dev/ |

Source: Portaldot Discord, #dev-announcement (2026-10-16).

## Live on Portaldot V3 testnet

Deployed on 2026-10-19 from the dashboard's *Deploy Allowance* button. The bytecode on chain is identical to this repository's build (`eth_getCode` = `deployedBytecode`).

| | |
|---|---|
| Contract | `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` |
| Deployed in block | 102688 |
| Deployer (owner) | `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547` |
| Agent of account #0 | `0x9C0e1F786b38923519dF2cec05464F95cCd29009` |

Every rule, exercised on chain. There is no block explorer yet, so the full hashes are listed in [docs/PROOF.md](docs/PROOF.md), with a one-line way to check them against the public RPC. `python3 script/check_submission.py` checks the deployment, the transactions and the submission rules in one go.

| Block | What happened | Signed by | Tx | Cost |
|---|---|---|---|---|
| 102688 | Deploy Allowance (code deposit for 9.8 KB) | owner | `0xb575397e…bcacd5` | 778.986 POT |
| 102805 | Owner opens "Research agent": 10 POT budget, 20 POT starting gas, 1 POT per payment, 5 POT per day, trusted recipients only | owner | `0x78ac0568…251b2a` | 42.418 POT |
| 102861 | Agent pays 0.4 POT to a trusted recipient: settles instantly | agent | `0xed29e4bf…6392bc` | 0.032 POT |
| 102867 | Agent pays 0.6 POT: settles instantly | agent | `0x457d60e9…ba43db` | 0.032 POT |
| 102873 | Agent asks for 2 POT (over the 1 POT cap): held as a request, not paid | agent | `0xecad8e81…42ddeb` | 15.398 POT |
| 102880 | Owner approves the request: 2 POT paid | owner | `0x96b6a6d3…3f473a` | 0.019 POT |
| 102887 | Owner freezes the agent | owner | `0x49e0a879…150752` | 3.86 POT |
| 102900 | Owner unfreezes the agent | owner | `0x37c0ccee…50090e` | 0 POT (freed deposit covered the fee) |

The costs are real and mostly storage deposits: Portaldot V3 charges for every byte a contract stores (including its code) and refunds it when the storage is cleared. That's why freezing costs 3.86 POT and unfreezing costs nothing. Measurements and what they mean for builders: [Getting started with Solidity on Portaldot V3](docs/SOLIDITY-ON-PORTALDOT-V3.md).

## Status

| | |
|---|---|
| ✅ | Core contract and test suite |
| ✅ | [Live on Portaldot V3 testnet](#live-on-portaldot-v3-testnet): deployed, and every rule exercised on chain |
| ✅ | Owner dashboard: open allowances, see spending, approve or reject held payments, freeze, change rules, try it as the agent |
| ✅ | Simulation mode: try every feature in the browser with no wallet, running the real contract bytecode |
| ✅ | MCP server: five tools, an agent skill, 6 end-to-end tests over the MCP protocol |
| ✅ | [Getting started with Solidity on Portaldot V3](docs/SOLIDITY-ON-PORTALDOT-V3.md): funding MetaMask, deploy costs, gotchas (measured on the live testnet) |

Not audited. Keep budgets small.

## Business model

**Open protocol, paid team layer.** No token.

| Layer | What | Who pays |
|---|---|---|
| **Open core** (free, MIT) | The contract, the dashboard and the MCP server. Any Portaldot AI tool, game or bot can give its agents limited budgets. | Nobody |
| **Allowance for Teams** (subscription) | Telegram and email alerts when a payment is waiting, approvals by more than one team member, spending reports, hosted agent runners. Built around the contract, never in place of it: the rules stay on chain. | Teams running agents in production |
| **Protocol fee** (mainnet, v2 contract) | A small, capped share of instant payments (for example 0.1%), visible on chain. It ships together with v2's deposit refunds for resolved requests. The testnet contract has no fee. | Accounts that use instant payments |

**Growth path.** First, integrations with AI and game projects on the Portaldot testnet. Then a mainnet launch with the v2 contract. After that, game guild treasuries, subscriptions and team spending. Revenue grows with the number of agent payments on Portaldot, which is the same on-chain activity the ecosystem wants.

## Roadmap after the Hacker House

Cheaper requests on V3: clear a request's storage when it is approved, rejected or cancelled, so its deposit (~15 POT on the testnet today) goes back instead of staying locked. Security review and Portaldot mainnet launch, a JS/TS SDK for other Portaldot projects, per-recipient limits and spend categories, integrations with iSwap and Portaldot game projects, and approval notifications in Portaldot Wallet.

## Prior work disclosure

The idea of rule-bound agent budgets builds on an earlier proof of concept by the same author on another chain: [Leash on Arc](https://github.com/Oziman13/leash). **No code from that project is reused.** This repository is a new codebase, written for Portaldot V3 during the Hacker House (from October 14, 2026), with a different design: multi-account and multi-asset (POT and ERC-20), configurable periods, expiry, key rotation and typed hold reasons.

Open-source dependencies: [Foundry](https://github.com/foundry-rs/foundry) / forge-std (testing and deployment), [ethers](https://github.com/ethers-io/ethers.js) (dashboard and MCP server), [EthereumJS](https://github.com/ethereumjs/ethereumjs-monorepo) (simulation mode, MPL-2.0, bundled unmodified), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [zod](https://github.com/colinhacks/zod) (MCP server), [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) (dashboard typeface, SIL OFL 1.1, embedded so the page makes no third-party requests besides the ethers CDN).

## License

MIT
