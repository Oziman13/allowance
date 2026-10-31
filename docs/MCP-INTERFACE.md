# Allowance MCP interface (server 0.1.0)

What an AI client can rely on when it plugs the Allowance MCP server in. This page describes the server **as it is today**, taken from [`mcp/index.js`](../mcp/index.js) and [`mcp/lib.js`](../mcp/lib.js). Where a promise is not implemented yet it is listed under [Not provided yet](#not-provided-yet), not described as a feature.

The server holds only the agent key. Every limit is enforced by the Allowance contract; this layer makes the contract easy for an AI to use and is not a security boundary.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ALLOWANCE_AGENT_KEY` | yes | The agent key from the dashboard. Never an owner or personal wallet key. |
| `ALLOWANCE_ADDRESS` | for non-default networks | Allowance contract address. The Portaldot V3 testnet deployment is built in. |
| `ALLOWANCE_NETWORK` | no | `portaldot-testnet` (default) or `local`. |
| `ALLOWANCE_RPC` | no | Overrides the network's RPC URL. |
| `ALLOWANCE_ACCOUNT_ID` | no | Which allowance to use. Default: the newest one this agent controls. |

## Tools

All five tools return one text block. Success is a JSON object serialised as text; failure sets `isError` and returns `Not done: <plain-words next step>`.

| Tool | Input | Chain effect | Returns (`result` / `status` values) |
|---|---|---|---|
| `allowance_status` | none | read-only | `state`: `active`, `frozen by owner`, `expired`; `can_spend_now_without_asking`, `max_single_payment_without_asking`, `per_payment_limit`, `period_limit`, `period_resets_in`, `budget_left`, `recipients`, `expires`, `agent`, `agent_gas_balance`, `account_id`, `network`, `note` |
| `allowance_preview` | `to` (0x address), `amount` | read-only dry run | `result`: `pays instantly`, `needs owner approval` (with `reason`), `blocked` (with `reason`), `invalid` (with `reason`) |
| `allowance_pay` | `to`, `amount`, `memo` (3 to 140 characters) | signs and sends one transaction, plus a gas refuel if the agent is low | `result`: `paid` (with `amount`, `to`, `memo`, `tx`) or `held for owner approval` (with `request_id`, `reason`, `next_step`); optional `gas_refuel` |
| `allowance_request` | `request_id` | read-only | `status`: `none`, `pending`, `approved`, `rejected`, `cancelled`; `amount`, `to`, `memo`, `held_because` |
| `allowance_cancel` | `request_id` | signs and sends one transaction | `status`: `cancelled`, with `tx` |

Amounts are decimal numbers or strings in the allowance's own currency (for example `0.25`). Output amounts are formatted text such as `0.25 POT`.

## Guarantees the interface keeps

- **A hold is not a payment.** `held for owner approval` means a request exists and nothing was sent. Only `paid` means funds moved, and `paid` is returned only after the receipt contains a `Paid` event that matches the exact account, recipient, amount and memo.
- **An unconfirmed outcome is never reported as success.** If a transaction was submitted but its receipt could not be confirmed, the error text contains the transaction hash and tells the client to check that receipt before sending another payment. A replaced or missing transaction is never treated as proof of payment.
- **No automatic retry.** The server does not resend a payment. Clients are told not to retry holds, frozen or expired errors.
- **Rules cannot be argued with.** Freeze, expiry, per-payment and period limits, and recipient rules are checked by the contract. The preview and `pay` dry run only save gas and explain the outcome.
- **Requests are scoped.** `allowance_request` and `allowance_cancel` refuse a request that belongs to another allowance.

Block inclusion is not finality. The server reports what the receipt shows; it does not claim finalised-head confirmation on Portaldot V3.

## Error messages

Contract errors are translated to one next step: `AccountFrozen`, `AccountExpired`, `InsufficientBudget`, `NotAgent`, `NotPending`, `InvalidAddress`, `InvalidAmount`, `TextTooLong`, `TransferFailed`, `UnknownAccount`, `UnknownRequest`, `OutsideRules`. An agent without enough POT for gas and storage deposit gets an explicit "nothing was sent" message. Unparseable RPC errors are shown in the node's own words with a warning that the outcome may be uncertain.

## What stays stable

For the hackathon final (November 6, 2026) the tool names, input names and the `result` / `status` / `state` values in the table above are treated as stable: changes will be additive. A rename or removed value would be a breaking change and would come with a new server version. This is a commitment about this repository's intent, not a versioned protocol.

## Not provided yet

Listed so nobody builds on them:

- **No schema version in responses.** The only version is the server's `0.1.0`; responses carry no `schema_version`.
- **No machine-readable amounts.** Amounts are formatted strings, not integers with a unit and decimals.
- **No dedicated dry-run flag on `allowance_pay`.** The dry run is `allowance_preview`; `pay` also runs a static call before sending.
- **No idempotency key.** The same call twice is two payments. The client must check the previous outcome first.
- **No ledger or accounting export.** Evidence lives in on-chain events (see [PROOF.md](PROOF.md)); there is no CSV or JSON export for a finance team.
- **The durable journal is not wired in.** The offline recovery modules in `mcp/` (journal, reconciliation, operator packet, disposition) are design and test code. The production server does not use them, and automatic crash recovery remains NO-GO.
- **Native Portaldot accounts.** The server uses an EVM key and the EVM RPC. Owner actions from a native (`5…`) account are not implemented; see [substrate/README.md](../substrate/README.md).

## Related

[`mcp/SKILL.md`](../mcp/SKILL.md) is the instruction text given to the assistant. [`mcp/README.md`](../mcp/README.md) covers installation. [PROOF.md](PROOF.md) lists the live transactions an assistant made through this server.
