# Allowance

**Give your AI agent an allowance, not a wallet.**

Programmable spending rules for AI agents, bots and automated payments on **Portaldot V3**.

> Built for the [Portaldot Hacker House 2026](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), Track 4 (Ecosystem DApps). Work in progress: see [Status](#status).

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

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```
forge install foundry-rs/forge-std --no-git
forge test
```

27 tests, including a fuzz test of the core guarantee: across 1,000 random sequences of payments, gas refuels and time jumps, money that leaves an account without an owner's approval never exceeds the period limit. Also covered: approvals and trust-on-approve, rejection and cancellation finality, freeze, expiry, key rotation, reentrancy on approval, recipients that refuse funds, ERC-20 fee-on-transfer and false-returning tokens.

## Deploy

```
forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
```

Network values live in `config/networks.json`. Portaldot V3 testnet and mainnet entries will be filled in as soon as the official endpoints are published.

## Status

| | |
|---|---|
| ✅ | Core contract and test suite |
| ⏳ | Deployment on Portaldot V3 testnet (waiting for official endpoints) |
| ⏳ | Owner dashboard (web) |
| ⏳ | MCP server: lets any AI assistant use an Allowance account as a tool |
| ⏳ | "Getting started with Solidity on Portaldot V3" guide |

Not audited. Keep budgets small.

## Roadmap after the Hacker House

Security review and Portaldot mainnet launch, a JS/TS SDK for other Portaldot projects, per-recipient limits and spend categories, integrations with iSwap and Portaldot game projects, and approval notifications in Portaldot Wallet.

## Prior work disclosure

The idea of rule-bound agent budgets builds on an earlier proof of concept by the same author on another chain: [Leash on Arc](https://github.com/Oziman13/leash). **No code from that project is reused.** This repository is a new codebase, written for Portaldot V3 during the Hacker House (from October 14, 2026), with a different design: multi-account and multi-asset (POT and ERC-20), configurable periods, expiry, key rotation and typed hold reasons.

Open-source dependencies: [Foundry](https://github.com/foundry-rs/foundry) / forge-std (testing and deployment).

## License

MIT
