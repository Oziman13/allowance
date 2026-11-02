# Allowance from a Portaldot (Substrate) account

Portaldot V3 is one chain with two faces. Substrate accounts (`5…`, the Portaldot wallet) and the EVM side (`0x…`, MetaMask) share the same state: the EVM side is the runtime's `revive` pallet. Allowance runs on the EVM side today. This folder is the path for owners who keep their POT in a native Portaldot account.

> **Status (November 2, 2026): read-only in the project code; eight manual native writes and one agent payment recorded.** Step 1 is done. By hand in the Portaldot node console, a `5…` account signed `revive.mapAccount()` (block 255537), then on the Allowance contract `openAccount` with zero value (block 282485), `fund` with 0.1 POT (block 291101), `withdraw` (block 291173), and `setFrozen` true (block 291215) and false (block 291242), a second `fund` (block 291982) and a second `withdraw` (block 292174). All succeeded ([record](docs/PROOF.md#signed-writes-from-a-native-portaldot-account-2026-10-31-to-2026-11-02)). The 14-decimal console value and the contract's 18-decimal view matched, and storage deposits for the fund and freeze slots were refunded until the agent's first payment, after which the balance word stayed occupied. An AI agent then paid 0.05 POT from the native-owned allowance through the MCP server (EVM transaction `0xe257c49b…4d191`, block 292133, `Paid` event). Signing from this project's own code (`revive.mapAccount()` and `revive.call`) remains **not implemented and NO-GO**; `approve`, `reject`, `rotateAgent`, `setRules` and `setTrusted` were not tried from a native account. Owner writes through the dashboard go through an EVM wallet. The "Next" steps below are the plan, not shipped features.

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

## Next (planned, not done)

1. **Map** a Portaldot wallet account with `revive.mapAccount()`, signed in the browser through the Portaldot / polkadot.js extension. *Done by hand on October 31 (block 255537); the Portaldot team says automatic mapping is also enabled.*
2. **Act as owner from that account:** open an allowance, fund, withdraw, freeze, approve a held payment, sent as `revive.call` extrinsics and recorded in [PROOF.md](../docs/PROOF.md). *Done by hand: open (block 282485, 34.5735 POT deposit held), fund (291101), withdraw (291173) and freeze/unfreeze (291215, 291242). Approving a held payment and the other owner actions are not done.*
3. **In the dashboard:** a "Portaldot wallet" option next to MetaMask for these owner actions.
