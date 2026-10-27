# Dashboard redesign, phase 2 (development notes, October 23): the boundaries of autonomy

The Policy Field uses one vocabulary across the landing page, selected-agent
controls and payment decisions: an agent node, a violet on-chain boundary, a
route and a distinct decision point. Its geometry is a visual abstraction.
Neither distance nor boundary size determines authorization.

## Implemented behavior

- The landing selector uses one shared SVG, with keyboard-operable buttons and
  `aria-pressed`. All three scenarios are explicitly illustrative. Allowed routes
  are mint, approval routes pause at an amber diamond, and a frozen-agent example
  terminates at a red blocked endpoint. No illustrative transaction is presented
  as an actual event.
- Agent Control Field displays actual selected-agent identity, contract balance,
  per-payment cap, period limit, remaining autonomous allowance, pending requests,
  freeze state and expiry. Trust candidates come from `TrustUpdated` events and
  are verified with `isTrusted`. The list explicitly may be incomplete when event
  history is incomplete; failures show verification unavailable rather than zero.
- Financial values remain explicit text, separately from the diagram. Contract
  balance is not the period allowance. Pending requests reserve no funds. Trust
  alone does not authorize payment. The existing radial meter remains a numeric
  representation of actual period usage, separate from the abstract field.
- A contract dry run previews the actual `pay` behavior, including frozen/expired
  accounts, invalid amounts and transfer failures. `preview` supplies the policy
  hold reason. These read-only calls do not persist a payment or a request.
- The next-payment preview is separate from the last transaction outcome.
  Submission stays neutral until a receipt is received. Matching `Paid` and
  `PaymentHeld` events determine completed and pending outcomes. Owner resolution
  uses actual `RequestResolved`/`Paid` events and distinct violet styling; it does
  not consume the autonomous period allowance. The activity feed uses the same
  owner-authorization distinction.
- Known failures show the existing friendly error text. Transport failures or
  missing revert data remain unconfirmed/unavailable, never a fabricated policy
  block or approval request. No contract error is silently converted to success.
- Expiration display uses chain time, including simulated time travel. Outcomes
  reset on selected-agent changes so a result cannot be attributed to another agent.
- Narrow screens use a readable node → boundary → decision fallback with the same
  text data. Color is supplemented by labels, endpoint shapes and lifecycle steps.
  Route completion is brief, receipt-driven and disabled under reduced motion.

## Security interpretation

The field and preview visualize recorded policy; they do not reserve funds or certify token backing.
Fixed windows are not rolling limits. Owner-approved payments use budget without consuming autonomous
period capacity, and old holds survive freeze, expiry, rotation and policy changes. Freeze blocks new
agent payments/refuels/requests, not owner approval of an existing hold. Native seeds/refuels become
unrestricted agent-wallet funds; actual wallet gas costs are not individually capped by Allowance.
Token event amounts are nominal, not proof of net receipt. See the [security and asset policy](../SECURITY.md)
for compatible-token assumptions and testnet limitations. This documentation correction changes no UI
behavior or generated website files.

## Source and build

`web/policy-field.css` and `web/policy-field.js` contain the shared primitives.
`build.py` embeds both into the existing single-page `docs/index.html`; there are
no additional production dependencies or asset requests. Externally sourced
symbols, addresses, memos and error reasons render through text nodes or existing
escaping. The diagram's HTML/SVG template is static.

The browser EVM transport queues RPC operations so temporary checkpoints from
full contract dry runs cannot be observed by another RPC operation. The underlying
simulation source/bytecode/results and real-wallet transport are unchanged.

No changes to Solidity, MCP payment logic, ABI, contract addresses, network
configuration or transaction fee/authorization rules. No contract deployment,
Pages publication, merge or change to PR #1 is part of this branch.

## Validation

Use the existing environment and checkout. Activate Foundry/Solidity as in phase 1:

```sh
export PATH=/workspace/.allowance-tools/node_modules/.bin:$PATH
export FOUNDRY_SOLC=/workspace/.allowance-tools/solc-0.8.28
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test -vv
(cd mcp && ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test)
python3 build.py
python3 -m http.server 8001 --bind 127.0.0.1 --directory docs
```

In another shell, using the optional browser tools already installed outside
the repository:

```sh
NODE_PATH=/workspace/.ui-tools/node_modules node script/ui-smoke.cjs
NODE_PATH=/workspace/.ui-tools/node_modules UI_A11Y=1 node script/policy-field-smoke.cjs
```

`UI_A11Y=1` enables optional `@axe-core/playwright` scans. Both runners require
Playwright and Chromium, not application dependencies. `UI_BASE_URL` and
`CHROMIUM_PATH` override their defaults. Set `UI_EVIDENCE_DIR` on the phase 2
runner to capture the screenshots. It only captures landing and wallet-free
simulation, with the MCP panel hidden. CDN ethers is served from the identical
installed package for deterministic browser tests.

Coverage includes the existing phase 1 suite; all landing selectors with a stable
SVG; 320/390/768/1440px layouts; real trust removal/reinstatement; preview versus
request creation; a deliberately delayed real receipt; autonomous and owner
payments; no reservation of pending funds; freeze; chain expiry; insufficient
budget; unavailable RPC; selected-agent isolation; exact semantic colors and
reduced motion. All financial outcome tests use the real contract in the browser
EVM. Test-only provider delays/failures exercise uncertainty without inventing
receipts or application events.

Review screenshots are under `docs/ui-evidence/phase2/`. The payment screenshots
show actual simulated outcomes. The additional `payment-owner-approved.png`
illustrates the owner-authorized path.

## Trade-offs and remaining work

A full transaction simulation costs an additional read RPC compared with the
original policy-only preview; requests are debounced and stale input results are
ignored. Predictions can still change before execution. The trust list favors
verified, honestly incomplete data over a claim that historical RPC data is exhaustive.
The shared field supplements rather than replaces exact financial information.

Real extension-wallet integration, live testnet behavior and production RPC
performance are not claimed as validated. Before the November 6 final, prioritize human
screen-reader and extension-wallet checks, robust event-history pagination with
clear completeness indicators, and navigation between a request and its final
resolution. Keep this stacked branch unmerged until visual/product review.

Validated in the current environment: 27 Foundry tests (including 1,000 fuzz
runs), 6 MCP tests, the dashboard build, the existing browser regression runner
and the phase 2 browser runner all passed. Nine axe WCAG 2 A/AA and WCAG 2.1 AA
scans across landing states, desktop/mobile control fields and payment outcomes
reported zero violations. No tests were skipped. These automated checks do not
replace a human accessibility audit or real extension-wallet integration testing.
