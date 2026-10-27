# Security policy and supported assets

Allowance is an experimental **Portaldot V3 testnet** application. Keep budgets and agent-wallet balances small. **It has not been independently audited and is not recommended for production funds or mainnet use.**

## Deployment status and scope

The documented deployment is `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` on Portaldot V3 Testnet, chain ID `420420777`. There is no supported mainnet deployment. Local Anvil and browser simulation deployments are for testing. Addresses and network values are recorded in [config/networks.json](config/networks.json); this policy does not change them.

This policy describes the current [Allowance source](src/Allowance.sol), reviewed against `main` commit `870610392140fee3a69d017c95f4657e444f99cb`, and the operational assumptions around its dashboard and MCP client. It is not a fresh verification of live bytecode, collateral, token implementations or chain-specific precompiles. The [Phase 2A internal review](docs/SECURITY-REVIEW-PHASE2A.md) records evidence, limitations and local reproductions. Neither that review nor this policy is an independent security audit or a certification of safety.

## Trusted owner, untrusted agent

The owner is fully trusted for its own account: it can withdraw budget, change policy, rotate the agent and explicitly approve payments outside autonomous rules. A compromised owner key defeats that account's protections. There is no global administrator or on-chain owner-transfer function.

Treat the agent as potentially compromised. It can call the contract directly without the MCP or dashboard. Contract rules apply to its authorized escrow operations; frontend checks, agent instructions and previews are conveniences, not on-chain security boundaries. Funding someone else's account gives the funder no owner or agent rights.

For native POT and compatible honest tokens, successful autonomous `pay` and native `refuel` calls debit no more than the recorded budget and configured per-call and fixed-window limits. Owner-approved payments debit the budget but **do not consume the autonomous period limit**. Owner withdrawals are outside autonomous limits. Token economics can invalidate the connection between recorded budget and actual backing; see [Supported assets](#supported-assets).

### Fixed windows, not rolling limits

`perPayment` caps one autonomous payment or refuel. `perPeriod` caps their combined nominal debits in the account's current fixed window. An instant `pay` also applies the trusted-recipient policy when enabled. Requests outside these rules can be held for the owner; invalid, frozen or expired calls still fail, and an otherwise instant payment needs enough budget.

A window starts at account creation; once its duration has elapsed, the next successful `pay` or `refuel` rolls it forward to that call's block time. Views report reset capacity after expiry of the window without writing state. These are not calendar days or rolling intervals: two period limits can be spent close together across a boundary. An owner can change the policy. The contract does not recognize invoices or stop splitting one purchase into multiple cap-sized payments; the MCP guidance forbids that behavior as an agent instruction.

### Freeze, expiry, rotation and old requests

| Operation | Current behavior |
|---|---|
| Freeze / expiry | Blocks new agent payments, refuels and held-request creation once effective on chain. Expiry applies at `block.timestamp >= expiresAt` when nonzero. |
| Owner control while frozen / expired | Owner can still withdraw, change rules and approve or reject an existing pending request. Freeze is not a stop on all account movement. |
| Agent rotation | Old key loses pay/refuel/cancel authority; the new key controls those agent operations. Historical `accountsOfAgent` entries are not proof of current authorization. |
| Existing requests | Remain pending through freeze, expiry, rotation, changes to caps or recipient trust. Owner approval can still pay the original amount to the original recipient, subject to current budget and transfer success. No automatic invalidation occurs. |
| Cancellation | Current agent can cancel pending requests, including old-key requests and while frozen/expired. It transfers no funds. Owner uses `reject` instead. |

Requests reserve no budget and may exceed it. Successful resolution is final; failed approval leaves the request pending. After a compromise, review and explicitly reject suspect requests rather than assuming freeze or rotation invalidated them. A transaction included before a freeze or rotation can still execute under the previous state.

### Gas seeds, refuels and the agent wallet

The native gas seed in `openAccount` goes directly to the agent, outside the account budget and autonomous period limit. It is included in `totalSpent`. Native refuels debit escrow and share the per-payment and period caps with instant payments, but **do not use the trusted-recipient list**: they go to the current agent.

Once a seed or refuel reaches the wallet, the agent can transfer it anywhere, not just spend it on gas. Freeze, expiry and rotation do not recover it. Assets received independently by the wallet are also outside Allowance's control.

Transaction fees and storage deposits are paid from that wallet, including costs of held or failed transactions. They are not metered by Allowance against each transaction's period limit. “Gas from the same budget” means capped refuel withdrawals, not a cap on all wallet gas costs. A zero-gas agent cannot pay for its own refuel transaction. Refueling can fail or be unavailable under the account rules; there is no guaranteed self-funding or automatic funding service. ERC-20 accounts do not refuel native gas from token budget.

## Supported assets

**Technical acceptance is not a safety endorsement.** The contract accepts token addresses without an on-chain token allowlist, token certification or compatibility enforcement. There is no named-token production approval list. Owners must evaluate the exact token address, implementation, upgrade powers and chain behavior before even small testnet use.

| Asset / behavior | Current accounting and guidance |
|---|---|
| Native POT | Primary testnet asset. Escrow debits track native transfers; seeds and refuels have the separate wallet boundary above. No production-safety claim follows from testnet operation. |
| Standard, predictable ERC-20 | Suitable compatibility model for testing: honest stable balances, correct `balanceOf`, and outbound transfers that debit exactly the nominal amount. For net delivery equal to the requested amount, the recipient must also receive that amount. Check both inbound and outbound behavior, including withdrawals. |
| Honest tokens returning no data | Accepted on `transfer` / `transferFrom`; an empty return alone proves neither honesty nor delivery. False returns, reverts and malformed boolean data cause failure and roll back that operation. |
| Recipient-deducted fee on inbound transfer | `openAccount` / `fund` credit the observed increase in escrow, which may be less than requested. This assumes the delta is attributable to that deposit, not a simultaneous rebase/reflection. It does not establish general fee-token safety. |
| Recipient-deducted fee on outbound transfer | Recipient can receive less than the nominal `Paid.amount`. If escrow loses exactly the nominal amount, accounting can remain solvent, but exact-payment integrations must not treat it as net receipt. Avoid fee tokens unless their behavior and gross/net requirements have been explicitly evaluated. |
| Rebasing / balance-changing or reflective tokens | Unsupported by the current accounting model. Balances can change without matching ledger updates; negative rebases can make pooled claims insolvent, and later withdrawers can lose backing. Positive changes during funding can also affect delta attribution. Do not use them as allowance budgets. |
| Additional sender-surcharge tokens | Unsupported. A transfer that debits more than the nominal amount can consume other accounts' backing in the same token. Do not use them as allowance budgets. |
| Upgradeable tokens | Upgrade/admin trust is an additional risk: today's compatible behavior can change. No compatibility guarantee across upgrades. Avoid unless those powers are understood and monitored; this policy does not endorse any specific implementation. |
| Malicious / misleading tokens | Unsupported. A token can lie about `balanceOf`, return success without moving funds or change its economics. Contract success or a `Paid` event does not establish actual net receipt. |
| Pausable / blacklist / recipient-restricted tokens | Can prevent payment or withdrawal. Reverting or false-returning transfers roll back Allowance state, but funds may remain unavailable under the token's own policy. Not suitable where unrestricted settlement is required. |
| Portaldot Assets precompiles / other token classes | Require separate chain-specific validation. An ERC-20-shaped interface is not evidence of compatible accounting; Phase 2A did not validate these live. |

Accounts with the same ERC-20 share one actual contract balance. An unsupported behavior can affect other owners of that token, not just the account exercising a transfer. An unrelated malicious token does not by itself demonstrate a way to steal native POT or another asset. On-chain checks do not enforce the operational exclusions in this table.

A `Paid` event records a nominal settlement according to Allowance and the token's reported success. It is not a generic proof of net recipient balance change. Validate actual receipt when exact token delivery matters. Send budget through `openAccount` or `fund`; unsolicited transfers do not credit an account and can become stranded. Avoid self-transfers to the Allowance contract.

## Known risks and validation limits

The [Phase 2A report](docs/SECURITY-REVIEW-PHASE2A.md#finding-summary) is the evidence reference:

- **M01, Medium:** unsupported token economics can break pooled solvency and account isolation; locally reproduced with negative rebase and sender surcharge mocks. No affected deployed token was established.
- **L01, Low:** checked `uint128 totalSpent` exhaustion blocks further payments, approvals and refuels at an extreme lifetime raw-unit bound; owner withdrawal remains possible. No practical native-POT attack was established.
- **I01–I05, Informational:** stale requests, unrestricted gas-wallet funds, nominal-versus-net token delivery, narrow contract preview, and permanent request storage are current limitations. Resolved requests have no cleanup/refund mechanism in this contract.

No Critical or High issue was confirmed in that internal review; that is not proof that none exists. Slither and Aderyn were unavailable in Phase 2A and were not run. Local Foundry tests do not validate every token, live collateral, Portaldot storage-deposit/refund behavior, RPC honesty or finality. Timestamp boundaries, transaction ordering, malicious recipients, token controls and owner-key compromise remain operational risks.

Contract `preview` is only a hold-reason classifier. MCP preview adds checks; even a successful `pay.staticCall` is an advisory snapshot, not a reservation or promise that a later transaction succeeds. Report completion only with sufficient receipt/event evidence. If submission or confirmation is uncertain, retain the hash when available, check the original transaction and do not automatically retry a payment.

## Safe operations

- Use testnet only, small budgets, low autonomous caps and minimal agent-wallet balances. Keep owner and agent keys separate; do not give an assistant the owner key. Never paste keys or seed phrases into issues, logs or reports.
- Evaluate the exact asset behavior and administrator powers before funding; do not infer compatibility from its symbol or ERC-20 interface. Prefer native test POT or tested predictable tokens, and do not fund excluded asset classes.
- Check account, network, contract and recipient addresses independently. A trusted recipient is an address permission, not proof that a vendor or invoice is legitimate. Protect owner approvals from social engineering.
- After suspected agent compromise, freeze and rotate using the owner key, inspect on-chain state and reject suspicious old requests. Move remaining budget to a safe destination if needed. Account for transaction inclusion delays and funds already outside escrow.
- Keep held-request memos short and free of secrets: they are public and retain storage deposits. Track request IDs and distinguish held, approved, reverted and uncertain outcomes. Never treat a preview as settled payment.
- Verify actual net token receipt where required, retain transaction references and monitor token policy changes. Do not automatically resubmit an uncertain payment or try to bypass a hold by splitting it.

## Reporting a security issue

Use this repository's GitHub **Security → Report a vulnerability** option if private reporting is available. If it is unavailable, open a minimal issue asking the [maintainer](https://github.com/Oziman13) for a private reporting channel without publishing exploit details, secrets or information about exposed funds. No dedicated private email, response-time commitment or bounty program is asserted here.

Include the source commit and affected function, network/contract/asset address if relevant, prerequisites, impact, and a minimal **local** reproduction or transaction reference. Distinguish confirmed behavior from hypotheses. Do not exploit public deployments or move other users' funds to demonstrate a report. Coordinate disclosure with the maintainer before publishing a fund-loss exploit.
