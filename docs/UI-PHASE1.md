# Dashboard redesign, phase 1 (development notes, October 23)

The dashboard uses an Autonomous Finance Command Center identity: dark navy
surfaces, violet policies, cyan simulation/gas, mint settled payments, amber
owner decisions and red blocked states. The landing illustration explains
policy routing without showing invented account balances. Recorded testnet
transactions remain explicitly dated historical evidence below it.

## Behavior

- Contract balance, autonomous allowance and pending request count are separate.
- The radial meter derives from the actual per-period limit and remaining allowance.
- Activity distinguishes autonomous payments, owner-approved payments, requests,
  request resolutions, gas, freezing and unfreezing, using actual events.
- Simulation banners, event descriptions and hash labels identify local activity.
- Frozen and expired agent testers show a blocked verdict and disable submission.
- Token metadata is text in the account list, amounts and activity. Account names
  and request memos remain escaped. Parameterless contract errors render safely.
- Responsive layouts support 320px through desktop; keyboard focus, a skip link,
  dialog labeling, live status messages and reduced motion are included.

No changes to the Solidity contract, MCP transaction logic, ABI, addresses,
network configuration, wallet signing or on-chain rules. No deployment is needed.

## Build and validation

Use the existing checkout and environment. With Foundry and Solidity 0.8.28
activated, run:

```sh
forge test -vv
(cd mcp && npm test)
python3 build.py
python3 -m http.server 8001 --bind 127.0.0.1 --directory docs
```

The browser smoke script requires Playwright and a Chromium installation.
Keep those optional validation tools outside the repository if desired:

```sh
npm install --prefix /workspace/.ui-tools playwright
NODE_PATH=/workspace/.ui-tools/node_modules \
UI_EVIDENCE_DIR=/workspace/ui-evidence \
node script/ui-smoke.cjs
```

`CHROMIUM_PATH` defaults to `/usr/bin/chromium`; `UI_BASE_URL` defaults to
`http://127.0.0.1:8001`. The runner uses the locally installed, same-version
ethers distribution in place of the CDN for deterministic validation. It runs
real contract bytecode in the existing browser EVM, never sends a testnet
transaction, and writes screenshots outside the repository. Token injection
and wallet failure fixtures are test-only; the application uses real data.

## Status and next steps

Phase 1 and phase 2 were merged and published on October 23. Real-wallet checks
are done by hand on the live site, since browser tests use an injected test wallet.

For the November 6 final, prioritize an accessibility audit with assistive
technology, real extension-wallet cross-browser checks, event-history pagination
and request-to-resolution navigation. A later pass can add transaction explorer
and contract-balance explanations while retaining the clear simulation boundary.

## Current validation evidence

- 27 Foundry tests passed, including 1,000 fuzz runs; no failures or skips.
- 6 MCP end-to-end tests passed; no failures or skips.
- `python3 build.py` succeeded; ABI and simulation bundle remain unchanged.
- Browser regression checks passed for real EVM payment/approval/rejection,
  trust, freeze enforcement, unfreeze, daily reset, rules, funding, withdrawal,
  hostile token symbols, keyboard focus and responsive layouts with expanded forms.
- Injected-wallet checks cover absent/rejected connections and a successful
  connection with no deployed contract. They do not substitute for MetaMask or
  a live testnet integration check.
- Axe WCAG 2 A/AA and WCAG 2.1 AA scan: zero violations on landing and seeded
  dashboard in Chromium. This is automated coverage, not a full accessibility audit.
