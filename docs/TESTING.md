# Running the tests from a clean clone

Allowance has three test suites. Total expected results: **58 Foundry tests, 37 MCP tests, 24 native-wallet unit tests.**

| Suite | Command | Needs |
|---|---|---|
| Contract (Foundry) | `forge build && forge test` | Foundry |
| MCP server | `npm ci --prefix mcp && npm test --prefix mcp` | Node 20+, Foundry (starts a local chain) |
| Native read-only inspector | `npm ci --prefix substrate && npm test --prefix substrate` | Node 20+ |

## macOS / Linux

```sh
git clone https://github.com/Oziman13/allowance.git
cd allowance
forge install foundry-rs/forge-std --no-git
forge build && forge test
npm ci --prefix mcp && npm test --prefix mcp
npm ci --prefix substrate && npm test --prefix substrate
```

## Windows

Foundry's installer (`foundryup`) does not run in plain PowerShell. Pick one:

**Option A: WSL 2 (recommended).** Install Ubuntu from the Microsoft Store, open it, then follow the macOS / Linux steps above inside WSL. Clone inside the WSL filesystem (`~/allowance`), not under `/mnt/c`, to avoid slow file access and line-ending problems.

**Option B: native Windows.**
1. Install [Node 20+](https://nodejs.org) and [Git for Windows](https://git-scm.com/download/win).
2. Download the Windows Foundry release from <https://github.com/foundry-rs/foundry/releases>, unzip it, and add the folder to your `PATH`. Check with `forge --version`.
3. In Git Bash or PowerShell:

```powershell
git clone https://github.com/Oziman13/allowance.git
cd allowance
forge install foundry-rs/forge-std --no-git
forge build
forge test
npm ci --prefix mcp
npm test --prefix mcp
npm ci --prefix substrate
npm test --prefix substrate
```

If `forge install` fails, clone `forge-std` manually into `lib/forge-std` (`git clone https://github.com/foundry-rs/forge-std lib/forge-std`).

## Notes

- `forge-std` and `out/` are git-ignored, so a fresh clone needs the install step above.
- The MCP and Foundry suites run on a local chain. They do not touch the Portaldot testnet and spend no POT.
- Browser smoke scripts (`script/*smoke.cjs`) need Playwright and Chromium and are local checks, not part of CI.
- Status of these instructions: the macOS / Linux path is what CI runs. The Windows steps follow Foundry's and Node's documented installs and have not yet been run end to end on a Windows machine by the author; if a step fails, please open an issue with the error.
