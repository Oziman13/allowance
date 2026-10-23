# Allowance: Hacker House check-in — overview

**Current October 24 check-in package:** [CHECKIN-2026-10-24.md](CHECKIN-2026-10-24.md) — updated pitch, two-minute demo, validation notes, screenshots, and remaining items. This shorter page is a project overview.

**Give your AI agent an allowance, not a wallet.** Programmable spending rules for AI agents on Portaldot V3: small payments go through on their own, anything outside the rules waits for the owner, and the rules are enforced by the contract.

Track 4, Ecosystem DApps · Solo builder: Ozan Turan ([@Oziman13](https://github.com/Oziman13))

## Links

| | |
|---|---|
| Live demo | https://oziman13.github.io/allowance/ (connect a wallet on Portaldot V3, or press *Try it without a wallet*) |
| Repository | https://github.com/Oziman13/allowance |
| Demo video | **Pending creator recording** (not yet published) |
| Architecture | [docs/ARCHITECTURE.md](ARCHITECTURE.md) |
| Judging criteria → evidence | [docs/JUDGING.md](JUDGING.md) |

## Portaldot testnet deployment

| | |
|---|---|
| Network | Portaldot V3 testnet, chain ID 420420777 |
| Contract | `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` |
| Deployment transaction | `0xb575397eea5c93908c43f13e4e9aff874f4777e0b4ab61164b36005ea0bcacd5` ([block 102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688)) |
| Explorer | [deployment block 102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688), [owner account](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v); every transaction is listed in [PROOF.md](PROOF.md) with block links |

The code on chain is byte-for-byte this repository's build. Six additional transactions demonstrate the core lifecycle on chain: an account opened, two instant payments, a payment held for being over the cap, its approval, a freeze and an unfreeze. `python3 script/check_submission.py` can attempt read-only rechecks when RPC access is available; the October 23 cloud attempt returned `403`, so the recorded chain evidence was not freshly reverified there.

## Progress

**Done**

- **Contract** (`src/Allowance.sol`). Accounts that an owner funds and an agent key spends from, in POT or any ERC-20. Each account has a per-payment cap, a cap per period, trusted recipients, an expiry, a freeze switch and key rotation. A payment outside the rules is held with the agent's reason; the owner approves it (optionally trusting the recipient) or rejects it. The agent's gas comes from the same budget, under the same caps.
- **Tests and CI.** 27 contract tests, including a 1,000-run fuzz test of the core guarantee (money that leaves without the owner's approval never exceeds the period limit), plus 6 end-to-end tests of the MCP server over the MCP protocol. Both suites run on every push.
- **Deployed on Portaldot V3 testnet** and exercised on chain (above).
- **Owner dashboard** on GitHub Pages: allowances, a spending meter, an inbox for held payments, freeze, rules, budget and trusted recipients, an activity feed with copyable transaction hashes, and a way to send payments as the agent.
- **Simulation mode**: the real contract bytecode runs in an in-browser EVM with a demo agent already spending, so anyone can try every rule without a wallet or test tokens.
- **MCP server** for AI assistants (Claude, Cursor, any MCP client) with five tools. It holds only the agent key. It works against the live testnet contract from Claude Desktop.
- **Ecosystem guide**: [Getting started with Solidity on Portaldot V3](SOLIDITY-ON-PORTALDOT-V3.md). It covers funding a MetaMask address, what deploying really costs, the storage-deposit pattern, and the testnet's pruned history, all measured on chain.
- **Business model** written up: open protocol, a paid layer for teams, no token ([README](../README.md#business-model)).

**Development record.** Regular commits since October 16, including UI, demo, and evidence updates through October 23. [Commit history](https://github.com/Oziman13/allowance/commits/main).

## Outstanding

| Item | Plan |
|---|---|
| Demo video (≤ 3 min, narrated) | A real AI assistant (Claude) paying through Allowance on the testnet: an instant payment, a held payment, the owner's approval, a freeze. |
| Manage an allowance from a Portaldot (Substrate) wallet | So owners can fund and approve from the Portaldot wallet, not only from MetaMask. |
| Cheaper requests | Clear a request's storage when it is resolved, so its deposit returns. This is planned for the v2 contract. |
| Pitch deck | [11-page PDF prepared](Allowance-pitch-deck.pdf); final review and competition upload remain pending. |
| MCP server on npm | Before the final submission. |

## Questions for mentors

1. Is a native Portaldot wallet path (owner signs through the Portaldot extension, contract on the EVM side) the right way to use V3's two sides, or is there a preferred pattern?
2. Testnet RPC prunes receipts after a day or two. Is an archive endpoint planned, or should projects prove activity through event logs as we do now?
3. What would the ecosystem support program want to see from an infrastructure project like this before mainnet?
