# Allowance on Portaldot V3 testnet: transactions

Contract `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f`, chain ID 420420777, RPC `https://test-evm-rpc-v3.portaldot.dev`.

**Explorer:** each block number below opens the block in the [Portaldot V3 testnet explorer](https://scanner-testnet-v3.portaldot.dev/) (blocks, events and the owner's Substrate account: [5CcD…jq3v](https://scanner-testnet-v3.portaldot.dev/#/accounts/5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v)). The explorer indexes the Substrate side, so search by block number, not by 0x address.

Check them yourself. The public testnet node prunes old blocks, so `eth_getTransactionReceipt` returns `null` for transactions older than a day or two. Contract events stay available, and a transaction only emits events if it succeeded:

```
curl -s -X POST https://test-evm-rpc-v3.portaldot.dev -H 'content-type: application/json' \
 -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f","fromBlock":"0x19120","toBlock":"latest"}]}'
```

Every `transactionHash` in that output is one of the rows below. The deployment itself is proven by the code at the address: `eth_getCode` returns exactly this repository's build. `python3 script/check_submission.py` runs both checks.

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

Claude (Claude Desktop) connected through the Allowance MCP server, holding only the agent key, ran the full flow against this contract:

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

```
159822  0xc26b7d632cc5d334dfc46c5c8cb8d31aac22cf69036cd7661bd9b08c0bf0899b
160081  0xf1afa9d061b0300fe257959445b8168b935f5ab8ca173980ac8f42b9eb483108
160115  0x1131fd1d74fd94d8278b743f60d6ea7f3a84eeb7d029cb96429e468a4e16838d
160197  0xb60b8adad44bf3068b55a7672150d4956732785e2f66b999c631368b44a824b7
160213  0x8be27fd120405d37c4d8329f676b03d113dee62451fceadcfbd38d5460924435
160231  0x8427471d9b800c41d30ba811b96f96231916c439c2f8a2784435a842a5bd9d2d
160258  0xf3845cc8686585566c4c1dca1c98f8a708131fc5eac89d9eab573b8b133219f8
```

Owner: `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547` · Agent: `0x9C0e1F786b38923519dF2cec05464F95cCd29009`

Events emitted, per transaction: 102805: Funded, RulesUpdated, TrustUpdated, AccountOpened, Refueled; 102861: Paid; 102867: Paid; 102873: PaymentHeld; 102880: Paid, RequestResolved; 102887: FrozenSet; 102900: FrozenSet.
