# Allowance on Portaldot V3 testnet: transactions

Contract `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f`, chain ID 420420777, RPC `https://test-evm-rpc-v3.portaldot.dev`.

Check them yourself. The public testnet node prunes old blocks, so `eth_getTransactionReceipt` returns `null` for transactions older than a day or two. Contract events stay available, and a transaction only emits events if it succeeded:

```
curl -s -X POST https://test-evm-rpc-v3.portaldot.dev -H 'content-type: application/json' \
 -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f","fromBlock":"0x19120","toBlock":"latest"}]}'
```

Every `transactionHash` in that output is one of the rows below. The deployment itself is proven by the code at the address: `eth_getCode` returns exactly this repository's build. `python3 script/check_submission.py` runs both checks.

| Block | What happened | From | Transaction hash | Status | Cost (gas used × price) |
|---|---|---|---|---|---|
| 102688 | Deploy Allowance (code deposit for 9.8 KB) | `0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547` | `0xb575397eea5c93908c43f13e4e9aff874f4777e0b4ab61164b36005ea0bcacd5` | success | 778.986 POT |
| 102805 | Owner opens "Research agent": 10 POT budget, 20 POT starting gas, 1 POT per payment, 5 POT per day, trusted recipients only | `0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547` | `0x78ac0568ed36152d46d4513cb02498a48ad8356e523244fa8f5ce4b845251b2a` | success | 42.418 POT |
| 102861 | Agent pays 0.4 POT to a trusted recipient: settles instantly | `0x9c0e1f786b38923519df2cec05464f95ccd29009` | `0xed29e4bfff912b6007f4fd3637bff1dd91f23eb81ea941338d055785356392bc` | success | 0.032 POT |
| 102867 | Agent pays 0.6 POT: settles instantly | `0x9c0e1f786b38923519df2cec05464f95ccd29009` | `0x457d60e94e399d0bab59819a327577aaa23caa20c8e496323204858ec0ba43db` | success | 0.032 POT |
| 102873 | Agent asks for 2 POT (over the 1 POT cap): held as a request, not paid | `0x9c0e1f786b38923519df2cec05464f95ccd29009` | `0xecad8e81a07a67f856ff8f5eb4f19466f977cc5a760eaa986d40b2945f42ddeb` | success | 15.398 POT |
| 102880 | Owner approves the request: 2 POT paid | `0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547` | `0x96b6a6d33101809951285d25f25442c4295aaaf5951b27dcd53011bc223f473a` | success | 0.019 POT |
| 102887 | Owner freezes the agent | `0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547` | `0x49e0a87959d0d58c58688ecab82b304ce44f403424fa2f994b8ecc9b02150752` | success | 3.86 POT |
| 102900 | Owner unfreezes the agent | `0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547` | `0x37c0ccee5a7bfc38c3ecc7455a8ca2c37816c9c7a6e2e7915d77db101350090e` | success | 0 POT (gas used reported as 0: the freed deposit covered the fee) |

Events emitted, per transaction, in order: 102805: Funded, RulesUpdated, TrustUpdated, AccountOpened, Refueled; 102861: Paid; 102867: Paid; 102873: PaymentHeld; 102880: Paid, RequestResolved; 102887: FrozenSet; 102900: FrozenSet.
