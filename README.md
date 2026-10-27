# Allowance

[![CI](https://github.com/Oziman13/allowance/actions/workflows/ci.yml/badge.svg)](https://github.com/Oziman13/allowance/actions/workflows/ci.yml)
![Contract tests](https://img.shields.io/badge/contract_tests-46_incl._1%2C000--run_fuzz-5a3fd6)
![MCP tests](https://img.shields.io/badge/MCP_tests-37_tests-5a3fd6)
![Portaldot V3](https://img.shields.io/badge/Portaldot_V3_testnet-live-2e7a57)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**Give your AI agent an allowance, not a wallet.**

Programmable spending rules for AI agents, bots and automated payments on **Portaldot V3**.

> Built for the [Portaldot Hacker House 2026](https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail), Track 4 (Ecosystem DApps).
>
> **Live on the Portaldot V3 testnet** at `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` ([proof](#live-on-portaldot-v3-testnet)). **[Open the dashboard](https://oziman13.github.io/allowance/)** · **[Watch the 2-minute demo](https://youtu.be/fxO8grGr4PY)**: connect a wallet on Portaldot V3, or press *Try Interactive Demo* to run the same contract in your browser.
>
> **Judges:** [how Allowance maps to each judging criterion](docs/JUDGING.md), with links to the evidence. Check-in (October 24): [docs/CHECKIN.md](docs/CHECKIN.md), with a [two-minute demo](docs/CHECKIN-2026-10-24.md) anyone can repeat.

## The problem

Giving an AI agent or a bot a wallet today means trusting it with everything in that wallet. One bad prompt, a hallucinated invoice or a compromised tool, and the funds are gone. The usual fix, a human signing every transaction, removes the point of having an agent.

## What Allowance does

An owner opens an **account** for an agent key and funds it. For native POT and compatible tokens, the contract bounds autonomous withdrawals even if the agent key is compromised. The owner retains control of the budget. See the [security boundaries and supported assets](SECURITY.md).

| Rule | What it does |
|---|---|
| **Per-payment cap** | No single instant payment above this size |
| **Per-period cap** | Combined autonomous payments and refuels per fixed window (at least 1 hour); not a rolling or calendar limit |
| **Trusted recipients** (optional) | Instant `pay` calls only to trusted addresses; native refuels to the agent are an exception |
| **Expiry** (optional) | Blocks new agent payments, refuels and requests at the set time; owner powers remain |
| **Freeze** | Once effective on chain, blocks new agent payments, refuels and requests; existing owner approvals remain possible |
| **Key rotation** | Replace a leaked agent key without moving the budget |

**Ask, don't fail.** A valid payment outside autonomous caps or recipient rules is held rather than rejected. It is stored as a **held** request with the agent's memo and the reason (`OverPerPayment`, `OverPeriodLimit`, `UntrustedRecipient`). The owner approves it, approves it and trusts the recipient, or rejects it. Approved payments debit the budget without using autonomous period capacity. Old requests survive freeze, expiry, rotation and policy changes until explicitly resolved.

**Capped gas refuels.** A POT account lets the agent withdraw native POT for gas under the same per-payment and fixed-window caps as instant payments. The initial gas seed is outside those caps. Once in the wallet, seeds and refuels are freely spendable; transaction fees and storage deposits paid there are not individually metered by Allowance. A zero-gas agent cannot submit its own refuel.

**Native POT and compatible tokens.** The contract accepts ERC-20 addresses without a token allowlist, but technical acceptance is not a safety endorsement. Use only tokens with evaluated, predictable accounting; rebasing and sender-surcharge tokens are unsupported. This testnet deployment is not recommended for production funds. See the [asset policy](SECURITY.md#supported-assets).

```
                     within rules ─────► paid now
agent.pay() ──────►  outside rules ────► held ──► owner: approve / approve + trust / reject
                     frozen / expired ─► reverts
agent.refuel() ───►  capped POT withdrawal to agent wallet (freely spendable afterward)
```

## Why a wallet, a proxy or an approval screen isn't enough

| Common approach | What the AI can do if it is wrong, jailbroken or prompt-injected |
|---|---|
| Give the agent a wallet key | Spend everything in the wallet |
| Give the agent a Substrate proxy | Act for the account; proxies limit *which calls*, not *how much* |
| Ask for confirmation in the app | Skip it: the check lives in the UI, not on-chain |
| **Allowance** | Autonomous escrow debits follow caps and `pay` recipient rules; native refuels go to the agent wallet. Owner-approved payments can exceed autonomous caps. [Scope](SECURITY.md) |

Allowance doesn't replace AI tools for Portaldot; it is the spending layer they can sit on top of.

## Why Portaldot

Portaldot's mission is *"Connecting People, Digital Assets, and Future Intelligence."* Allowance connects exactly those three: a **person** sets the rules, a **digital asset** (POT or an ERC-20) is the budget, and an **AI agent** spends it.

Agents and bots make many small payments, so the product creates the kind of real, high-frequency on-chain activity the ecosystem is looking for. The POT-as-gas design uses one asset for escrow payments and capped refuel withdrawals; the separate agent-wallet exposure is described in [SECURITY.md](SECURITY.md#gas-seeds-refuels-and-the-agent-wallet).

## Use cases

- **AI agents** paying for APIs, data and compute, with a fixed-window autonomous cap
- **Game bots and guilds** in the Portaldot game ecosystem: "this bot can debit at most X per fixed window without approval", "a guild member can draw Y from the treasury"
- **Subscriptions and automated payments**: "at most Z per configured fixed window to this service without approval"
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
| `preview(id, to, amount)` | anyone | classify the hold reason; does not check full executability or reserve funds |

Design notes:
- Owner-approved payments do not use up the period limit. The limit applies to what the agent can do **alone**.
- A payment inside the rules but above the balance reverts, so the agent tells its owner. A held request may exceed the balance, so the owner can top up and then approve.
- ERC-20 deposits credit the observed escrow increase. This handles some inbound recipient-deducted fees, not all fee-token economics. Outbound `Paid.amount` is nominal and may exceed net receipt. False returns/reverts fail; honest no-data returns are accepted. [Compatibility limits](SECURITY.md#supported-assets).
- Windows reset on the next successful `pay`/`refuel` after the window duration elapses, starting at that call's block time. Two limits can be spent near a boundary. The contract does not recognize invoice splitting.
- No assembly, no `SELFDESTRUCT`, no reliance on gas stipends, for compatibility with Portaldot V3's contract runtime.

## Tests

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 20+. CI runs both suites on every push.

```
forge install foundry-rs/forge-std --no-git
forge build && forge test       # contract: 46 tests incl. fuzz and audit reproductions
cd mcp && npm install && npm test   # MCP server end to end on a local chain
```

46 contract tests (27 original and 19 audit tests), including 1,000 fuzz sequences of native payments, refuels and time jumps under unchanged rules. The fuzz test checks autonomous debits against each contract-defined fixed-window cap; it is not a rolling-limit or arbitrary-token solvency proof. Also covered: approvals and trust-on-approve, rejection and cancellation finality, freeze, expiry, key rotation, reentrancy on approval, recipients that refuse funds, ERC-20 fee-on-transfer and false-returning tokens.

## Give it to a real AI assistant (MCP)

`mcp/` is an MCP server that turns an allowance into five tools for Claude, Cursor or any MCP client: `allowance_status`, `allowance_preview`, `allowance_pay`, `allowance_request`, `allowance_cancel`. The assistant holds only the agent key, so its authorized escrow operations are subject to on-chain rules; assets already in its wallet are outside that boundary. `mcp/SKILL.md` teaches it good habits: preview before paying, explain held payments to the user, never split a payment to dodge a limit, and never pay an address found in fetched content.

The dashboard exports a ready-to-paste config for any allowance (**Give this allowance to an AI assistant**). Setup: [mcp/README.md](mcp/README.md).

## Owner dashboard

`docs/index.html` is a single static page (built from `web/index.src.html` by `build.py`). It works with any wallet on Portaldot V3; if no Allowance contract is configured for the network, it offers to deploy one.

- **Your agents:** every allowance you own, with what's left this period
- **Budget meter:** each instant payment and gas refuel of the current period, against the cap
- **Waiting for you:** held payments with the agent's memo and the reason; approve, approve and trust the recipient, or reject
- **Controls:** freeze, rules, budget, trusted recipients
- **Try it as the agent:** the page creates the agent key in your browser, so you can send payments as the agent and watch the rules apply
- **Give it to an AI assistant:** copy an MCP config for the allowance

**Any wallet, any device.** The dashboard finds every installed browser wallet (EIP-6963) and lets you pick one. If your wallet is on another network, it offers to switch to, or add, Portaldot V3 Testnet. On a phone, where browsers can't reach a wallet app, it opens the page inside MetaMask, Trust Wallet, Coinbase Wallet or OKX, or gives you the link for any other wallet's browser; on a laptop, *Open on your phone* shows a QR code.

**Try it without a wallet.** The page has an interactive demo (*Try Interactive Demo*): it runs the real Allowance bytecode in an in-browser EVM ([EthereumJS](https://github.com/ethereumjs/ethereumjs-monorepo)), seeds a demo agent that has already paid twice and asked twice, and lets you approve, reject, freeze, send as the agent and skip ahead a day to watch the limit reset. Nothing touches a chain and nothing costs money. Source: `web/sim/provider.js`, bundled into `docs/sim.js`.

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
| Deployed in block | [102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688) |
| Deployer (owner) | `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547` |
| Agent of account #0 | `0x9C0e1F786b38923519dF2cec05464F95cCd29009` |

The core lifecycle, on chain. Block numbers link to the [Portaldot V3 testnet explorer](https://scanner-testnet-v3.portaldot.dev/) (it indexes the Substrate side, so search by block number). Full hashes are listed in [docs/PROOF.md](docs/PROOF.md), with a one-line way to check them against the public RPC. Every event the contract has emitted, decoded, is in [`evidence/onchain.json`](evidence/onchain.json) (refresh it with `node script/export-evidence.mjs`). `python3 script/check_submission.py` checks the deployment, the transactions and the submission rules in one go (last run October 24: 23 passed, 0 failed).

| Block | What happened | Signed by | Tx | Cost |
|---|---|---|---|---|
| [102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688) | Deploy Allowance (code deposit for 9.8 KB) | owner | `0xb575397e…bcacd5` | 778.986 POT |
| [102805](https://scanner-testnet-v3.portaldot.dev/#/blocks/102805) | Owner opens "Research agent": 10 POT budget, 20 POT starting gas, 1 POT per payment, 5 POT per day, trusted recipients only | owner | `0x78ac0568…251b2a` | 42.418 POT |
| [102861](https://scanner-testnet-v3.portaldot.dev/#/blocks/102861) | Agent pays 0.4 POT to a trusted recipient: settles instantly | agent | `0xed29e4bf…6392bc` | 0.032 POT |
| [102867](https://scanner-testnet-v3.portaldot.dev/#/blocks/102867) | Agent pays 0.6 POT: settles instantly | agent | `0x457d60e9…ba43db` | 0.032 POT |
| [102873](https://scanner-testnet-v3.portaldot.dev/#/blocks/102873) | Agent asks for 2 POT (over the 1 POT cap): held as a request, not paid | agent | `0xecad8e81…42ddeb` | 15.398 POT |
| [102880](https://scanner-testnet-v3.portaldot.dev/#/blocks/102880) | Owner approves the request: 2 POT paid | owner | `0x96b6a6d3…3f473a` | 0.019 POT |
| [102887](https://scanner-testnet-v3.portaldot.dev/#/blocks/102887) | Owner freezes the agent | owner | `0x49e0a879…150752` | 3.86 POT |
| [102900](https://scanner-testnet-v3.portaldot.dev/#/blocks/102900) | Owner unfreezes the agent | owner | `0x37c0ccee…50090e` | 0 POT (freed deposit covered the fee) |

**With a real AI assistant (Oct 23):** Claude, connected through the MCP server, paid 0.3 POT at once ([blocks 159822–160258](docs/PROOF.md#a-real-ai-assistant-on-chain-2026-10-23)), had a 2 POT request held for approval instead of splitting it, and stopped when the owner froze the agent.

The costs are real and mostly storage deposits: Portaldot V3 charges for every byte a contract stores (including its code) and refunds it when the storage is cleared. That's why freezing costs 3.86 POT and unfreezing costs nothing. Measurements and what they mean for builders: [Getting started with Solidity on Portaldot V3](docs/SOLIDITY-ON-PORTALDOT-V3.md).

## Status

| | |
|---|---|
| ✅ | Core contract and test suite |
| ✅ | [Live on Portaldot V3 testnet](#live-on-portaldot-v3-testnet): deployed, and every rule exercised on chain |
| ✅ | Owner dashboard: open allowances, see spending, approve or reject held payments, freeze, change rules, try it as the agent |
| ✅ | Simulation mode: try every feature in the browser with no wallet, running the real contract bytecode |
| ✅ | MCP server: five tools, agent guidance, 37 tests including local-chain and MCP-protocol coverage |
| ✅ | [Getting started with Solidity on Portaldot V3](docs/SOLIDITY-ON-PORTALDOT-V3.md): funding MetaMask, deploy costs, gotchas (measured on the live testnet) |

Not independently audited. Keep testnet budgets small. Read [SECURITY.md](SECURITY.md) and the [Phase 2A internal review](docs/SECURITY-REVIEW-PHASE2A.md). What Allowance does not do yet is listed under [Limitations](#limitations).

## Limitations

Stated plainly, so nobody has to find them:

- **Not independently audited, testnet only.** No mainnet deployment or production-fund recommendation. Phase 2A is an internal review with known token-accounting risks; Slither and Aderyn were unavailable and remain follow-up work. See [SECURITY.md](SECURITY.md).
- **A held request reserves nothing.** Approving pays from the budget as it is at that moment; if the budget has run low, the approval fails and the request stays open.
- **Held requests are expensive on V3 today.** Each one stores its memo, so it costs the agent a storage deposit (11.56 POT with a 24-character memo, 19.24 POT with 50 characters on October 23). The current contract has no cleanup/refund path for resolved requests; a future design must validate refund attribution.
- **The owner of an allowance is fixed.** There is no owner transfer; a new owner opens a new allowance.
- **Owners need an EVM wallet today.** A native Portaldot (`5…`) account can read the contract ([`substrate/check.mjs`](substrate/check.mjs)) but cannot act as owner yet; that is the next step.
- **The dashboard's agent tester keeps a demo agent key in the browser.** It is for trying the rules. A real agent should hold its key itself, as the MCP server does.
- **History depends on the public RPC.** The testnet prunes old receipts; Allowance proves its transactions through their events ([`evidence/onchain.json`](evidence/onchain.json)), and the dashboard's activity list shows what the RPC still returns.

## Business model

**Open protocol, paid team layer.** No token.

| Layer | What | Who pays |
|---|---|---|
| **Open core** (free, MIT) | The contract, the dashboard and the MCP server. Any Portaldot AI tool, game or bot can give its agents limited budgets. | Nobody |
| **Allowance for Teams** (subscription) | Telegram and email alerts when a payment is waiting, approvals by more than one team member, spending reports, hosted agent runners. Built around the contract, never in place of it: the rules stay on chain. | Teams running agents in production |
| **Protocol fee** (mainnet, v2 contract) | A small, capped share of instant payments (for example 0.1%), visible on chain. It ships together with v2's deposit refunds for resolved requests. The testnet contract has no fee. | Accounts that use instant payments |

**Growth path.** First, integrations with AI and game projects on the Portaldot testnet. Then a mainnet launch with the v2 contract. After that, game guild treasuries, subscriptions and team spending. Revenue grows with the number of agent payments on Portaldot, which is the same on-chain activity the ecosystem wants.

## Before the final (November 6)

- **Owners on Portaldot's native side.** Manage an allowance from a Portaldot (Substrate) wallet, not only from MetaMask: map the account, then open, freeze and approve as `revive.call` extrinsics from the browser extension. Step 1 is done: [`substrate/check.mjs`](substrate/check.mjs) reads the live contract from a `5…` account (October 25).
- **Allowances in Portaldot Assets tokens.** Validate each intended Assets precompile against the [supported-asset assumptions](SECURITY.md#supported-assets) before claiming compatibility; accepting an ERC-20-shaped interface is insufficient.
- **Security:** [internal review](docs/SECURITY-REVIEW-PHASE2A.md) and [operational policy](SECURITY.md) documented; Slither, Aderyn and independent professional review remain outstanding.

## Roadmap after the Hacker House

Cheaper requests on V3: clear a request's storage when it is approved, rejected or cancelled, so its deposit (~15 POT on the testnet today) goes back instead of staying locked. Security review and Portaldot mainnet launch, a JS/TS SDK for other Portaldot projects, per-recipient limits and spend categories, integrations with iSwap and Portaldot game projects, and approval notifications in Portaldot Wallet.

## Prior work disclosure

The idea of rule-bound agent budgets builds on an earlier proof of concept by the same author on another chain: [Leash on Arc](https://github.com/Oziman13/leash). **No code from that project is reused.** This repository is a new codebase, written for Portaldot V3 during the Hacker House (from October 14, 2026), with a different design: multi-account and multi-asset (POT and ERC-20), configurable periods, expiry, key rotation and typed hold reasons.

Open-source dependencies: [Foundry](https://github.com/foundry-rs/foundry) / forge-std (testing and deployment), [ethers](https://github.com/ethers-io/ethers.js) (dashboard and MCP server), [EthereumJS](https://github.com/ethereumjs/ethereumjs-monorepo) (simulation mode, MPL-2.0, bundled unmodified), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [zod](https://github.com/colinhacks/zod) (MCP server), [polkadot.js API](https://github.com/polkadot-js/api) (Substrate tools, Apache-2.0), Sora, Inter and JetBrains Mono (dashboard typefaces, SIL OFL 1.1, embedded locally); ethers 6.13.4 is also served locally, so the page does not depend on external font or script CDNs.

## Team

Ozan Turan ([@Oziman13](https://github.com/Oziman13) on GitHub, @Oziman1 on DoraHacks): solo builder. Contract, dashboard, MCP server, tests and docs.

## License

MIT
