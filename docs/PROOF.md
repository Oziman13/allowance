# Allowance on Portaldot V3 testnet: transactions

Contract `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f`, chain ID 420420777, RPC `https://test-evm-rpc-v3.portaldot.dev`.

**Historical project evidence, separate from browser simulation.** The [stored event export](../evidence/onchain.json) was captured on October 26, 2026 at 21:07:47 UTC+03, read block 206637: **21 events in 14 event-bearing transactions**, plus the deployment (15 transactions total). This is not a fresh live/RPC or cryptographic attestation. See the [current jury route](JUDGING.md#two-minute-jury-route) and [verification limitations](FINAL-EXPERIENCE-IMPLEMENTATION-PHASE4B.md).

**Explorer:** each block number below opens the block in the [Portaldot V3 testnet explorer](https://scanner-testnet-v3.portaldot.dev/) (blocks, events and the owner's Substrate account: [5CcD…jq3v](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v)). The explorer indexes the Substrate side, so search by block number, not by 0x address.

At the recorded checks, the public node pruned older receipts while relevant logs remained available. Current retention/access is not guaranteed. A missing receipt or log is not proof of success or failure. This bounded read-only query covers the recorded range:

```
curl -s -X POST https://test-evm-rpc-v3.portaldot.dev -H 'content-type: application/json' \
 -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f","fromBlock":"0x19120","toBlock":"0x27202"}]}'
```

Match a payment's exact contract, account ID, recipient, amount and Paid event; an arbitrary event is insufficient. PaymentHeld is a request, not a payment. At capture, deployed bytecode matched the repository build. `python3 script/check_submission.py` can attempt fresh read-only checks when the configured RPC is accessible; a blocked request does not refresh stored evidence.

## October 19 dashboard run (historical)

| Block | What happened | Signed by | Cost |
|---|---|---|---|
| [102688](https://scanner-testnet-v3.portaldot.dev/#/blocks/102688) | Deploy Allowance (9.8 KB of code) | owner | 778.986 POT |
| [102805](https://scanner-testnet-v3.portaldot.dev/#/blocks/102805) | Owner opens "Research agent": 10 POT budget, 20 POT starting gas, 1 POT per payment, 5 POT a day, trusted recipients only | owner | 42.418 POT |
| [102861](https://scanner-testnet-v3.portaldot.dev/#/blocks/102861) | Agent pays 0.4 POT to a trusted recipient: paid at once | agent | 0.032 POT |
| [102867](https://scanner-testnet-v3.portaldot.dev/#/blocks/102867) | Agent pays 0.6 POT: paid at once | agent | 0.032 POT |
| [102873](https://scanner-testnet-v3.portaldot.dev/#/blocks/102873) | Agent asks for 2 POT, over the 1 POT cap: held, not paid | agent | 15.398 POT |
| [102880](https://scanner-testnet-v3.portaldot.dev/#/blocks/102880) | Owner approves the request: 2 POT paid | owner | 0.019 POT |
| [102887](https://scanner-testnet-v3.portaldot.dev/#/blocks/102887) | Owner freezes the agent | owner | 3.86 POT |
| [102900](https://scanner-testnet-v3.portaldot.dev/#/blocks/102900) | Owner unfreezes the agent | owner | 0 (the freed deposit covered the fee) |

Full transaction hashes, in the same order:

```
102688  0xb575397eea5c93908c43f13e4e9aff874f4777e0b4ab61164b36005ea0bcacd5
102805  0x78ac0568ed36152d46d4513cb02498a48ad8356e523244fa8f5ce4b845251b2a
102861  0xed29e4bfff912b6007f4fd3637bff1dd91f23eb81ea941338d055785356392bc
102867  0x457d60e94e399d0bab59819a327577aaa23caa20c8e496323204858ec0ba43db
102873  0xecad8e81a07a67f856ff8f5eb4f19466f977cc5a760eaa986d40b2945f42ddeb
102880  0x96b6a6d33101809951285d25f25442c4295aaaf5951b27dcd53011bc223f473a
102887  0x49e0a87959d0d58c58688ecab82b304ce44f403424fa2f994b8ecc9b02150752
102900  0x37c0ccee5a7bfc38c3ecc7455a8ca2c37816c9c7a6e2e7915d77db101350090e
```

## A real AI assistant on chain (2026-10-23)

The project records a Claude Desktop session through MCP, holding only the agent key, alongside owner interventions and a separate dashboard request. Events do not identify an AI client; session attribution comes from the project record and [historical 2:21 check-in recording](https://youtu.be/fxO8grGr4PY), not independent model-authorship verification:

| Block | What happened | Signed by | Cost |
|---|---|---|---|
| [159822](https://scanner-testnet-v3.portaldot.dev/#/blocks/159822) | **Claude** pays 0.3 POT for "market data API" through the MCP server: paid at once | agent (Claude) | 0.032 POT |
| [160081](https://scanner-testnet-v3.portaldot.dev/#/blocks/160081) | Agent asks for 2 POT from the dashboard (memo "GPU hour for fine-tuning", 24 chars): held | agent | 11.557 POT |
| [160115](https://scanner-testnet-v3.portaldot.dev/#/blocks/160115) | Owner approves it: 2 POT paid | owner | 0.019 POT |
| [160197](https://scanner-testnet-v3.portaldot.dev/#/blocks/160197) | **Claude** asks for 2 POT for a GPU hour, over the 1 POT cap: **held, not paid** (memo 50 chars) | agent (Claude) | 19.243 POT |
| [160213](https://scanner-testnet-v3.portaldot.dev/#/blocks/160213) | Owner approves Claude's request: 2 POT paid | owner | 0.019 POT |
| [160231](https://scanner-testnet-v3.portaldot.dev/#/blocks/160231) | Owner freezes the agent. Claude then refuses to pay: "your allowance is frozen", nothing sent | owner | 3.86 POT |
| [160258](https://scanner-testnet-v3.portaldot.dev/#/blocks/160258) | Owner unfreezes the agent | owner | 0 POT |

When the account was frozen, Claude's payment never reached the chain: the MCP server's dry run returned `AccountFrozen` and Claude stopped. When asked to pay "market data again" in a new conversation without an address, it asked for the recipient instead of guessing one.

That refusal is reported session behavior and produced **no new transaction**; FrozenSet proves the recorded freeze, not a subsequent refusal event. The recipient was the documented owner address below. Memos describe example API/compute purposes, not independently verified purchase or delivery by a service vendor. Browser simulation receipts and native fixture screenshots are separate evidence and do not reproduce these live transactions.

```
159822  0xc26b7d632cc5d334dfc46c5c8cb8d31aac22cf69036cd7661bd9b08c0bf0899b
160081  0xf1afa9d061b0300fe257959445b8168b935f5ab8ca173980ac8f42b9eb483108
160115  0x1131fd1d74fd94d8278b743f60d6ea7f3a84eeb7d029cb96429e468a4e16838d
160197  0xb60b8adad44bf3068b55a7672150d4956732785e2f66b999c631368b44a824b7
160213  0x8be27fd120405d37c4d8329f676b03d113dee62451fceadcfbd38d5460924435
160231  0x8427471d9b800c41d30ba811b96f96231916c439c2f8a2784435a842a5bd9d2d
160258  0xf3845cc8686585566c4c1dca1c98f8a708131fc5eac89d9eab573b8b133219f8
```

Owner: `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547` · Agent: `0x9C0e1F786b38923519dF2CeC05464f95ccD29009`

Events emitted, per transaction: 102805: Funded, RulesUpdated, TrustUpdated, AccountOpened, Refueled; 102861: Paid; 102867: Paid; 102873: PaymentHeld; 102880: Paid, RequestResolved; 102887: FrozenSet; 102900: FrozenSet.

## Signed writes from a native Portaldot account (2026-10-31 and 2026-11-02)

Two transactions signed from an ordinary Substrate (`5…`) account, `5DyzK2FvF9mYvJGLzz3GaTuv2KqC56zyAQvrBL7RV36Ff2pA`, by hand in the Portaldot node console with the polkadot{.js} extension. The second one is an Allowance owner action: the first time this contract was used from a native account.

| Block | What happened | Cost |
|---|---|---|
| [255537](https://scanner-testnet-v3.portaldot.dev/#/blocks/255537) | `revive.mapAccount()`: the account registers its EVM-side address | 0.0109 POT fee, no deposit held |
| [282485](https://scanner-testnet-v3.portaldot.dev/#/blocks/282485) | `revive.call` to the Allowance contract: `openAccount` with **zero value** (agent `0x9C0e1F786b38923519dF2CeC05464f95ccD29009`, native POT, name "Native", 0.1 POT per payment, 0.5 POT per day, no trusted recipients) | 0.0601 POT fee + **34.5735 POT storage deposit held** |

```
255537  0x7ffec539400918583a1243aa1a9c2532fd9c885dd4af04c35cf27c3d66779700
282485  0x8cda394d9c7c006f79362cd8d26b03d09dc63f8fda1205ea620f9e85f7a5867c
```

What was checked afterwards, read-only from the node:

- `revive.originalAccount(0x7acb562d90e299471d077a1b0de28520327cdff6)` returns the `5DyzK2…` account, and [`substrate/check.mjs`](../substrate/check.mjs) reported `Mapped yes` for it.
- The `mapAccount` fee was 1,090,545,990,394 base units (14 decimals, 0.0109 POT). The balance fell from 10.0000 to 9.9890 POT, which the fee explains, and the reserved balance afterwards was 0, so no mapping deposit was held on this testnet. The Portaldot team states that automatic mapping is enabled; this record does not test that claim.
- Block 282485 events: `system.ExtrinsicSuccess`, two `revive.ContractEmitted` events from the Allowance contract (the account opening and its rules), `balances.TransferAndHold` with reason `StorageDepositReserve` of 3,457,350,000,000,000 base units (34.5735 POT), and a fee of 6,011,736,295,965 base units (0.0601 POT). At the check the finalized head (282494) was past this block.
- Read back from the contract with `reviveApi.call`: `accountCount` is 2 and the `0x7acb…` address owns allowance #1: agent `0x9C0e…D29009`, native POT, name "Native", per-payment 0.1 POT, per-period 0.5 POT, period 86400 seconds, budget 0, not frozen.
- The call was prepared in the console from a dry run (weight limit 4,000,000,000 refTime and 300,000 proofSize, storage deposit limit 37 POT) and the console's encoded call hash matched the locally computed one: `0xc563bfc362c9b06ef3807085079b6954ba9a85e676d532482f589151c05acb46`.

What this does not show: non-zero value units between the 18-decimal EVM side and the 14-decimal native side (the owner action used zero value and zero budget), any other owner action (funding, freezing, approving) from a native account, or whether the 34.5735 POT deposit is refundable. The deposit was measured at about 3.84 POT per stored word; it is held, not spent, and no cleanup path was tested.
