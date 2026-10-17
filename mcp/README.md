# allowance-mcp

An MCP server that gives an AI assistant (Claude, Cursor, any MCP client) a budget on **Portaldot V3** that it **cannot overspend**.

The assistant holds only the *agent* key of an [Allowance](https://github.com/Oziman13/allowance) account. Every rule lives in the Allowance contract, so a confused, jailbroken or prompt-injected assistant is still bound by it:

- payments inside the rules settle immediately
- payments outside them are held for the owner, with the assistant's memo and the reason
- the owner can freeze the agent at any time, and the allowance can expire
- gas is refuelled from the same POT budget, under the same limits

## Tools

| Tool | What it does |
|---|---|
| `allowance_status` | What the assistant can spend right now without asking, the limits, frozen or expired |
| `allowance_preview` | Free dry run: pays instantly, needs owner approval (and why), or blocked |
| `allowance_pay` | Pay with a memo; returns `paid` with the transaction, or `held for owner approval` with a request id |
| `allowance_request` | Approved, rejected or still pending |
| `allowance_cancel` | Withdraw one of its own pending requests |

Five tools on purpose: the assistant gets exactly what it needs to spend, and nothing that could move funds around the rules.

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
| `ALLOWANCE_ADDRESS` | yes | |
| `ALLOWANCE_NETWORK` | no | `portaldot-testnet` (`local` for anvil) |
| `ALLOWANCE_RPC` | no | the network's public RPC |
| `ALLOWANCE_ACCOUNT_ID` | no | the newest allowance this agent controls |

## Tests

```
forge build            # from the repo root, builds the contract the tests deploy
cd mcp && npm test     # starts a local chain (anvil) and runs the server end to end
```

The tests deploy the real contract, pay, hold, approve, cancel, and drive the server over the MCP protocol until the owner freezes it.
