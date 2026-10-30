# Contributing to Allowance

Allowance is a solo-built hackathon project on Portaldot V3 testnet. Issues and small pull requests are welcome; please read the limits below first.

## Ground rules

- **Never commit secrets.** No seed phrases, private keys, agent keys, MCP configs or `.env` files. Report anything that looks like a leaked secret privately (see [SECURITY.md](SECURITY.md)), not in a public issue.
- **Testnet only.** Do not deploy to a mainnet or point the MCP server at funds you care about. The contract is not independently audited.
- **Keep claims honest.** Docs and README text must match what the code and the recorded on-chain evidence actually show. Mark historical records as historical.
- **Keep the contract small.** Portaldot V3 charges a storage deposit per byte of contract code, so changes to `src/` need a size check (`forge build --sizes`) and a note on the cost.

## Setup

See [docs/TESTING.md](docs/TESTING.md) for macOS, Linux and Windows instructions.

```sh
forge install foundry-rs/forge-std --no-git
forge build && forge test
npm ci --prefix mcp && npm test --prefix mcp
npm ci --prefix substrate && npm test --prefix substrate
```

## Pull requests

1. Open an issue first for anything beyond a typo or small fix.
2. One change per pull request, with tests for contract or MCP behavior changes.
3. Run the three test commands above and say in the description what you ran.
4. Do not edit recorded evidence (`evidence/onchain.json`, `docs/PROOF.md`) by hand. Regenerate it with `script/export-evidence.mjs` and explain why.
5. Contributions are licensed under the repository's MIT license.

## Code of conduct

Be respectful and specific. Critique code and claims, not people.
