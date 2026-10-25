# Getting started with Solidity on Portaldot V3

A field guide from building [Allowance](../README.md) on the Portaldot V3 testnet. Everything here was measured on the live testnet on **2026-10-18**. Where something is not verified yet, it says so.

## TL;DR

1. **Use plain Solidity.** `solc` / Foundry bytecode deploys and runs as is. No PolkaVM recompile (`resolc`) is needed. Allowance is [live on the testnet](../README.md#live-on-portaldot-v3-testnet), deployed this way.
2. **Fund a MetaMask address through its Substrate twin.** Every `0x` address has a fixed Substrate account (`0x… ++ 0xEE × 12`). Send POT there from the Node Console, and it shows up in MetaMask.
3. **Storage costs more than computation.** You pay a deposit for every byte a contract stores, its code included: about **0.08 POT per byte of code**, so a 10 KB contract needs roughly **800 POT** to deploy. Writing a new storage slot costs a few POT; clearing one gives the deposit back. Optimize for size, and for storage.

## 1. Network

| | Portaldot V3 Testnet |
|---|---|
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Chain ID | `420420777` (`0x190f1ca9`) |
| Substrate node | `wss://test-node-v3.portaldot.dev` |
| Node console | https://node-console.portaldot.dev/ |
| Currency symbol | POT |
| Block explorer | https://scanner-testnet-v3.portaldot.dev/ (Substrate view: search by block number or `5…` account, not by `0x` address) |

Source: Portaldot Discord, #dev-announcement (2026-10-16).

The EVM endpoint is Parity's `eth-rpc` adapter (`web3_clientVersion` returns `eth-rpc/…`) in front of a Substrate runtime with **pallet-revive**. There are no `evm` or `ethereum` pallets. The `contracts` pallet (ink!) also exists.

**Add the network to MetaMask:** Networks → Add network → Add a network manually. Enter the RPC URL, chain ID 420420777 and symbol POT, and leave the explorer empty.

## 2. Fund a MetaMask account

Test POT arrives in a Substrate account (an address starting with `5…`). MetaMask uses `0x` addresses. pallet-revive links them with a fixed rule:

```
Substrate account of 0xABCD…1234  =  0xABCD…1234 followed by twelve 0xEE bytes
```

**To fund a MetaMask address:**

1. Get the SS58 form of that account. Use the script in this repo (Python standard library only):

   ```
   $ python3 script/fallback_address.py 0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547
   AccountId32 (hex): 0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547eeeeeeeeeeeeeeeeeeeeeeee
   SS58 (prefix 42): 5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v
   ```

2. Open the Node Console and go to **Accounts → send**. Paste the `5…` address and send.

The balance appears in MetaMask as soon as the transfer is finalized. We verified this with a 100 POT transfer: MetaMask showed 99.9 POT.

**Tips:**
- Use a **separate MetaMask account** for deploys, never your main one.
- Never paste a seed phrase or private key into a website or a chat.
- Send a small amount first to check the address.

## 3. Deploy Solidity

Normal Foundry and solc output works:

- `eth_estimateGas` and `eth_call` for a contract creation return success for Allowance's solc 0.8.28 bytecode (`evm_version = "cancun"`).
- Contracts don't need `resolc` or a separate PolkaVM build.

> ✅ Allowance was deployed this way on 2026-10-19: block 102688, transaction `0xb575397eea5c93908c43f13e4e9aff874f4777e0b4ab61164b36005ea0bcacd5`. The code returned by `eth_getCode` is byte-for-byte the Foundry build.

**How to deploy:**
- **Foundry:** `forge script script/Deploy.s.sol --rpc-url https://test-evm-rpc-v3.portaldot.dev --private-key <KEY> --broadcast`
- **In the browser:** the [Allowance dashboard](https://oziman13.github.io/allowance/) deploys itself from MetaMask with one click if no contract is configured for the network.

**Write contracts that stay portable:**
- no inline assembly that relies on EVM gas details
- no `SELFDESTRUCT`
- no reliance on the 2300-gas stipend of `transfer` / `send`. Use `call` and check the result.

## 4. What deploying actually costs

Gas is cheap. **The deposit for storing the code is the expensive part.** pallet-revive charges a storage deposit for every byte the chain stores, and contract code is stored on-chain. The deposit is reserved from the deployer's balance, not burned.

These are dry-run estimates (`eth_estimateGas` × `eth_gasPrice`). The gas price was `0x9beb` (39,915 wei).

| What | Size | Estimated cost |
|---|---|---|
| Plain POT transfer | — | ~0.11 POT |
| Empty contract | ~90 bytes | ~18 POT |
| Allowance, default build (`optimizer_runs = 200`) | 13.0 KB | **~1,047 POT** |
| Allowance, `optimizer_runs = 1` | 12.9 KB | ~1,041 POT |
| Allowance, `via_ir = true` | 10.0 KB | ~806 POT |
| Allowance, `via_ir = true`, `optimizer_runs = 1` | **9.8 KB** | **~791 POT** |

From these numbers:
- A contract costs about **18 POT** as a base.
- On top of that it costs about **0.08 POT per byte of code**.

**Measured on chain** (Allowance, 2026-10-19; cost = gas used × effective gas price from the receipt):

| Transaction | What it stores | Real cost |
|---|---|---|
| Deploy (9.8 KB) | the contract code | **778.99 POT** (estimate was 791) |
| Open an account | ~10 new slots: account struct, name, index arrays, trusted recipient | 42.42 POT |
| Instant payment | updates existing slots only | **0.032 POT** |
| Held payment (a request with a memo) | ~5 new slots | 15.40 POT (11.56 to 19.24 POT on Oct 23, depending on the memo: 24 vs 50 characters) |
| Approve a request | updates existing slots | 0.019 POT |
| Freeze (`false` → `true` in an empty slot) | 1 slot goes from zero to non-zero | 3.86 POT |
| Unfreeze (back to zero) | clears that slot | **0**: the receipt reports 0 gas used, the freed deposit covered the fee |

**The pattern:** a slot that goes from zero to non-zero costs a deposit of a few POT; updating a non-zero slot is almost free; setting a slot back to zero refunds its deposit. So:
- **Prefer updating over creating.** Allowance's instant payments only touch existing slots, which is why they cost 3 hundredths of a POT.
- **Clear what you no longer need.** Deleting a finished record (`delete requests[id]`) returns its deposit. Allowance's next version will do this for resolved requests.
- **Whoever writes pays.** The deposit is charged to the sender, so a contract call that creates storage can cost a user (or an AI agent with a small gas balance) far more than the gas estimate suggests on other chains. Give such accounts enough native POT.

**What this means for you:**
- **Check your balance against the estimate before you deploy.** MetaMask shows the full maximum. If your balance is lower, the transaction is rejected up front with "insufficient funds".
- **Optimize for size.** Use `via_ir = true` and `optimizer_runs = 1` in `foundry.toml`. That alone cut our cost by 25%. Run your full test suite again after changing settings; ours passed unchanged.
- **Ask the team for enough test POT early**, mentioning your contract size. A medium-sized contract plus a demo needs about 1,000 test POT.

```toml
[profile.default]
solc_version = "0.8.28"
evm_version = "cancun"
optimizer = true
optimizer_runs = 1
via_ir = true
```

## 5. Gotchas we hit

- **Gas numbers look huge.** `eth_estimateGas` returns values like `0x5d26ed11ff8019` (2.6 × 10¹⁶). They include the deposit, expressed as gas. Multiply by the gas price to get POT; don't compare the number with Ethereum gas.
- **Some error messages mix units.** One "insufficient funds" error showed the balance in 18-decimal units (`have 99900000000000000000` for 99.9 POT). In the same message, the required amount appeared to be in the chain's native base units. Compare amounts in POT, not raw numbers.
- **`eth_maxPriorityFeePerGas` returns 0.** Don't set a priority fee; base fee only.
- **Strings you store are priced per byte, by whoever sends the transaction.** The same held payment cost the agent 11.56 POT with a 24-character memo and 19.24 POT with a 50-character one. Keep stored text short, or store a hash and keep the text in an event.
- **"1010 Invalid Transaction" from `eth_sendRawTransaction`** is the Substrate transaction pool refusing the transaction, usually because the sender can't cover it. ethers can't parse this error and reports "could not coalesce error"; read `error.error.message` to see the node's words. The RPC reports a priority fee of 0. Transactions sent as EIP-1559 with a 1 gwei tip (max fee = 2 × base fee + tip, gas limit = the estimate) went through; the chain still charged the base fee only.
- **The public testnet RPC prunes history.** After a day or two, `eth_getTransactionReceipt` and `eth_getTransactionByHash` return `null`, and historical `eth_getBlockByNumber` fails with "State already discarded". `eth_getLogs` keeps working, so prove your transactions through the events they emitted, and keep receipts as you go.
- **The explorer indexes the Substrate side.** Searching a `0x` contract address finds nothing; open the block (`/#/blocks/<number>`) or the deployer's `5…` twin account instead. Keep your transaction hashes. Allowance records them in its README as a proof table, with the full list in [PROOF.md](PROOF.md).
- **MetaMask reserves gas limit × max fee up front.** With a deploy this large, its default max fee (about 2 × base fee) can exceed your balance even though the real cost fits. Send a legacy transaction with an explicit `gasPrice` (current price + 5%) and a tight `gasLimit` (estimate + 1%). That's what Allowance's dashboard does.
- **Discord help tickets:** the server's filter blocked our messages that contained the word "pot". If your message disappears, rephrase it (for example, "testnet funds").

## 6. Reach your contract from a Substrate account

A contract on the EVM side is not only for MetaMask users. Measured on 2026-10-25 (runtime `portaldot-v3` 3002):

- **Dry-run any function from a `5…` account** with the runtime API `reviveApi.call(origin, contract, value, gasLimit, storageDepositLimit, data)`: `data` is ordinary ABI calldata (ethers' `encodeFunctionData`), and the result's `data` decodes with the same ABI. In the result, bit 0 of `flags` means the call reverted.
- **`reviveApi.address(account)`** gives the `0x` address the contract sees as `msg.sender`. For the twin of a MetaMask address it is that address; for an ordinary Portaldot account it is derived from the account.
- **Map once before acting:** an ordinary account sends `revive.mapAccount()` once; `revive.originalAccount(h160)` tells you whether it has. Then `revive.call` sends a real call from that account.
- **polkadot.js over HTTPS works** (`HttpProvider` on `https://test-node-v3.portaldot.dev`) where a WebSocket can't get through a proxy.

Allowance's [`substrate/check.mjs`](../substrate/check.mjs) does all of this read-only, in about 60 lines.

## 7. Checklist

- [ ] MetaMask network added (chain ID 420420777)
- [ ] Separate deployer account created
- [ ] SS58 twin computed (`script/fallback_address.py`) and funded from the Node Console
- [ ] Contract optimized for size; tests still pass
- [ ] `eth_estimateGas` × gas price < your balance
- [ ] Accounts that will write storage (users, agents) hold enough native POT for the deposits
- [ ] Deployed; transaction hash saved

---

*Found something different on your contract? Open an issue on this repo. Corrections are welcome.*
