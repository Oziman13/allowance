# Getting started with Solidity on Portaldot V3

A field guide from building [Allowance](../README.md) on the Portaldot V3 testnet. Everything here was measured on the live testnet on **2026-10-18**. Where something is not verified yet, it says so.

## TL;DR

1. **Use plain Solidity.** `solc` / Foundry bytecode is accepted. No PolkaVM recompile (`resolc`) is needed: our dry-run deploys of solc output succeed.
2. **Fund a MetaMask address through its Substrate twin.** Every `0x` address has a fixed Substrate account (`0x… ++ 0xEE × 12`). Send POT there from the Node Console, and it shows up in MetaMask.
3. **Deploying costs more than gas: you pay a deposit for the code.** It is about **0.08 POT per byte of contract code**. A 10 KB contract needs roughly **800 POT** at deploy time. Optimize your contract for size.

## 1. Network

| | Portaldot V3 Testnet |
|---|---|
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Chain ID | `420420777` (`0x190f1ca9`) |
| Substrate node | `wss://test-node-v3.portaldot.dev` |
| Node console | https://node-console.portaldot.dev/ |
| Currency symbol | POT |
| Block explorer | none yet |

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

> ⏳ Full on-chain deployment of Allowance is pending test funds (see §4). This section will link the deployment transaction once it is live.

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

Writing new contract storage later (opening accounts, storing requests) also takes a deposit. We will add measured numbers after the Allowance deployment.

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
- **There is no block explorer yet.** Keep your transaction hashes. Allowance records them in its README as a proof table.
- **Discord help tickets:** the server's filter blocked our messages that contained the word "pot". If your message disappears, rephrase it (for example, "testnet funds").

## 6. Checklist

- [ ] MetaMask network added (chain ID 420420777)
- [ ] Separate deployer account created
- [ ] SS58 twin computed (`script/fallback_address.py`) and funded from the Node Console
- [ ] Contract optimized for size; tests still pass
- [ ] `eth_estimateGas` × gas price < your balance
- [ ] Deployed; transaction hash saved

---

*Found something different on your contract? Open an issue on this repo. Corrections are welcome.*
