# Allowance from a Portaldot (Substrate) account

Portaldot V3 is one chain with two faces. Substrate accounts (`5…`, the Portaldot wallet) and the EVM side (`0x…`, MetaMask) share the same state: the EVM side is the runtime's `revive` pallet. Allowance runs on the EVM side today. This folder is the path for owners who keep their POT in a native Portaldot account.

## Step 1 (October 25): read the contract from a Substrate account

`check.mjs` connects to the Portaldot V3 testnet node, finds the `0x` address the contract sees for a given `5…` account, checks whether that address is mapped, and dry-runs Allowance's read functions from that account. It never signs or sends anything.

```sh
cd substrate && npm install
node check.mjs                        # the deployer's account
node check.mjs 5Your…PortaldotAddress # any account
```

Output on October 25, 2026 (deployer's account):

```
Chain        PortaldotV3 Test · portaldot-v3 3002
Genesis      0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd
Revive       mapAccount yes · call yes · dry run yes
Account      5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v
Acts as      0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547  (this is the twin of a MetaMask address)
Mapped       not needed (fallback account)
Contract     0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f · 1 allowance in total
Owned here   0
  #0 Research agent: budget 2.7 POT, can spend 2.7 POT now without asking, active
```

What this shows:

- **The contract is reachable from Substrate.** `reviveApi.call` runs Allowance's functions with a `5…` account as the caller.
- **Every Substrate account has a fixed `0x` address on the EVM side** (`reviveApi.address`). For the twin of a MetaMask address (the address followed by twelve `0xEE` bytes) it is that MetaMask address. For an ordinary Portaldot account it is derived from the account, and the account must call `revive.mapAccount()` once before it acts on the EVM side.

## Next

1. **Map** a Portaldot wallet account with `revive.mapAccount()`, signed in the browser through the Portaldot / polkadot.js extension.
2. **Act as owner from that account:** open an allowance, freeze, approve a held payment, sent as `revive.call` extrinsics and recorded in [PROOF.md](../docs/PROOF.md).
3. **In the dashboard:** a "Portaldot wallet" option next to MetaMask for these owner actions.
