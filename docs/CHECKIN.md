# Allowance: Hacker House check-in (October 24, 2026)

**Give your AI agent an allowance, not a wallet.** Programmable spending rules for AI agents on Portaldot V3: small payments go through on their own, anything outside the rules waits for the owner, and the rules are enforced by the contract.

Track 4, Ecosystem DApps · Solo builder: Ozan Turan ([@Oziman13](https://github.com/Oziman13))

## Links

| | |
|---|---|
| Live demo | https://oziman13.github.io/allowance/ (connect a wallet on Portaldot V3, or press *Try Interactive Demo* to run the real contract in your browser, no wallet needed) |
| Repository | https://github.com/Oziman13/allowance |
| Pitch deck | [Allowance-pitch-deck.pdf](Allowance-pitch-deck.pdf) (11 pages) |
| Demo video | https://youtu.be/fxO8grGr4PY (2:21, narrated, captions): the interactive demo, Claude on the testnet, and wallet support |
| Two-minute demo script and screenshots | [CHECKIN-2026-10-24.md](CHECKIN-2026-10-24.md) |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Judging criteria → evidence | [JUDGING.md](JUDGING.md) |

## Portaldot testnet deployment

| | |
|---|---|
| Network | Portaldot V3 testnet, chain ID 420420777 |
| Contract | `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` |
| Deployment transaction | `0xb575397eea5c93908c43f13e4e9aff874f4777e0b4ab61164b36005ea0bcacd5` ([block 102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688)) |
| Explorer | [deployment block 102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688), [owner account](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v); every transaction is listed in [PROOF.md](PROOF.md) with block links |

The code on chain is byte-for-byte this repository's build. 14 more transactions show the core lifecycle on chain, in two runs:

- **October 19, from the dashboard (7):** an account opened, two instant payments, a payment held for being over the cap, its approval, a freeze and an unfreeze.
- **October 23, with a real AI assistant (7):** Claude, connected through the Allowance MCP server and holding only the agent key, paid 0.3 POT at once, had a 2 POT request held for the owner, was approved, and stopped paying when the owner froze it. A second held request from the dashboard, its approval and the unfreeze complete the run.

`python3 script/check_submission.py` re-checks all of it against the public RPC, read-only. Last run, October 24: **23 passed, 0 failed**; the deployed code matches the build, and 14 of 14 proof transactions are found through the events they emitted.

## Progress

**Done**

- **Contract** (`src/Allowance.sol`). Accounts that an owner funds and an agent key spends from, in POT or any ERC-20. Each account has a per-payment cap, a cap per period, trusted recipients, an expiry, a freeze switch and key rotation. A payment outside the rules is held with the agent's reason; the owner approves it (optionally trusting the recipient) or rejects it. The agent's gas comes from the same budget, under the same caps.
- **Tests and CI.** 27 contract tests, including a 1,000-run fuzz test of the core guarantee (money that leaves without the owner's approval never exceeds the period limit), plus 6 end-to-end tests of the MCP server over the MCP protocol. Both suites run on every push.
- **Deployed on Portaldot V3 testnet** and exercised on chain (above), including by a real AI assistant.
- **Owner dashboard** on GitHub Pages, redesigned on October 23: the agent's spending policy drawn as a field, a spending ring, an approval inbox, freeze, rules, budget and trusted recipients, and an activity feed with copyable transaction hashes. It works with any browser wallet, on desktop and from a phone's wallet app.
- **Interactive demo**: the real contract bytecode runs in an in-browser EVM with a demo agent already spending, so anyone can try every rule without a wallet or test tokens.
- **MCP server** for AI assistants (Claude, Cursor, any MCP client) with five tools. It holds only the agent key. Used from Claude Desktop against the live testnet contract.
- **Ecosystem guide**: [Getting started with Solidity on Portaldot V3](SOLIDITY-ON-PORTALDOT-V3.md). It covers funding a MetaMask address, what deploying really costs, the storage-deposit pattern, transaction-pool errors and the testnet's pruned history, all measured on chain.
- **Business model** written up: open protocol, a paid layer for teams, no token ([README](../README.md#business-model)).

**Development record.** 35 commits on 8 days (October 16–23), each one a reviewable step. [Commit history](https://github.com/Oziman13/allowance/commits/main).

## Outstanding

| Item | Plan |
|---|---|
| Final demo video | A new recording for the final, including owner actions from a Portaldot account. |
| Owner actions from a Portaldot (Substrate) account | Approve and freeze from a native Portaldot account, sent on chain, so V3's two sides work together. Next step, from October 25. |
| Security review | Automated analysis (Slither, Aderyn) and a written threat model (`SECURITY.md`) before the final. The contract is not audited. |
| MCP server on npm | Before the final submission. |
| Cheaper requests | Clear a request's storage when it is resolved, so its deposit returns. Planned for the v2 contract. |

## Questions for mentors

1. Is a native Portaldot wallet path (owner signs through the Portaldot extension, contract on the EVM side) the right way to use V3's two sides, or is there a preferred pattern?
2. Testnet RPC prunes receipts after a day or two. Is an archive endpoint planned, or should projects prove activity through event logs as we do now?
3. What would the ecosystem support program want to see from an infrastructure project like this before mainnet, and does it help with security reviews?
