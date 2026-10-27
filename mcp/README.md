# allowance-mcp

An MCP server that gives an AI assistant (Claude, Cursor, any MCP client) access to a budget on **Portaldot V3 testnet**, with autonomous escrow debits bounded by on-chain rules for native POT and compatible tokens.

The assistant holds only the *agent* key of an [Allowance](https://github.com/Oziman13/allowance) account. Escrow rules live in the Allowance contract, so the assistant cannot bypass them by skipping the MCP client. The owner is trusted, and funds already in the agent wallet are outside that boundary:

- payments inside the rules settle immediately
- valid payments outside autonomous caps or recipient rules are held for the owner, with the assistant's memo and the reason
- the owner can freeze the agent at any time, and the allowance can expire
- native refuel withdrawals share payment caps; gas seeds and later wallet use have a separate security boundary

## Tools

| Tool | What it does |
|---|---|
| `allowance_status` | What the assistant can spend right now without asking, the limits, frozen or expired |
| `allowance_preview` | Free dry run: pays instantly, needs owner approval (and why), or blocked |
| `allowance_pay` | Pay with a memo; returns `paid` with the transaction, or `held for owner approval` with a request id |
| `allowance_request` | Approved, rejected or still pending |
| `allowance_cancel` | Withdraw one of its own pending requests |

Five tools on purpose: the assistant gets the account's agent operations, not owner powers. The agent key can still sign transactions outside these tools. This testnet software is not independently audited or recommended for production funds; read the [security and asset policy](https://github.com/Oziman13/allowance/blob/main/SECURITY.md).

## Security boundaries

- `can_spend_now_without_asking` is total remaining autonomous period capacity bounded by budget; `max_single_payment_without_asking` also applies the per-payment cap. Recipient rules and current state still matter. Limits use fixed windows, not rolling intervals.
- Owner-approved requests debit budget without consuming autonomous period capacity. Requests survive freeze, expiry, rotation and policy changes; owners must explicitly reject suspicious old holds. The current agent can cancel, including while frozen/expired.
- Preview is advisory, not a reservation. `paid` requires a successful receipt and a matching contract event, but its amount is nominal token accounting, not proof of net receipt for arbitrary tokens. Unsupported rebasing or sender-surcharge assets can make shared token backing insolvent; no token allowlist is enforced on chain.
- Preserve any transaction hash on uncertain submission/confirmation, check the original outcome, and do not automatically resend. Never replace an uncertain payment with another payment merely because confirmation was unavailable.

## Setup

1. Open the Allowance dashboard, create an allowance and copy the agent key it generates. **Never use your own wallet key.**
2. Install and build from the repo:
   ```
   git clone https://github.com/Oziman13/allowance && cd allowance/mcp && npm install
   ```
3. Add it to your MCP client. For Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "allowance": {
         "command": "node",
         "args": ["/absolute/path/to/allowance/mcp/index.js"],
         "env": {
           "ALLOWANCE_NETWORK": "portaldot-testnet",
           "ALLOWANCE_ADDRESS": "0x…",
           "ALLOWANCE_AGENT_KEY": "0x…"
         }
       }
     }
   }
   ```
   For Claude Code: `claude mcp add allowance --env ALLOWANCE_ADDRESS=0x… --env ALLOWANCE_AGENT_KEY=0x… -- node /absolute/path/to/allowance/mcp/index.js`
4. Optional: install `SKILL.md` as an agent skill. It teaches the assistant to preview before paying, explain held payments to the user and never split payments to dodge a limit.

| Variable | Required | Default |
|---|---|---|
| `ALLOWANCE_AGENT_KEY` | yes | |
| `ALLOWANCE_ADDRESS` | on other networks | Portaldot V3 testnet: the public deployment `0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f` |
| `ALLOWANCE_NETWORK` | no | `portaldot-testnet` (`local` for anvil) |
| `ALLOWANCE_RPC` | no | the network's public RPC |
| `ALLOWANCE_ACCOUNT_ID` | no | the newest allowance this agent controls |

**Gas on Portaldot V3.** Instant payments cost the agent about 0.03 POT. Asking for approval (a held payment) stores a request on chain, and V3 charges the sender a storage deposit for it: about 15 POT in the recorded testnet runs. These are historical measurements, not current fee estimates. Keep only enough starting gas for the intended testnet operations. A zero-gas agent cannot submit its own refuel; refueling is conditional on budget and rules. The initial seed is outside period caps, and refuels bypass recipient trust to reach the agent. Both become freely spendable wallet funds. Gas/storage costs paid by that wallet are not individually metered against the allowance cap. ERC-20 accounts need separately supplied native gas. Details: [Solidity on Portaldot V3](../docs/SOLIDITY-ON-PORTALDOT-V3.md).

## Tests

```
forge build            # from the repo root, builds the contract the tests deploy
cd mcp && npm test     # starts a local chain (anvil) and runs the server end to end
```

The tests deploy the real contract, pay, hold, approve, cancel, and drive the server over the MCP protocol until the owner freezes it.
