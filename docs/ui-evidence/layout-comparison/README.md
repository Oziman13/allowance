# Desktop layout comparison — preview experiment

**Recommendation: hybrid.** Keep the current layout as the default. A wider,
more compact dashboard is useful on large displays; retain the more relaxed
current composition at 1440px until visual review. For a future approved version,
consider the wider dashboard at 1600px and above while preserving the current
landing headline measure. That hybrid is a recommendation, not another variant
or an automatically enabled setting in this experiment.

Base: `main` commit `d22819a9d1fe408813fee8358ff569678f8b8ebd`, which includes
both merged redesign phases. Feature branch: `codex/allowance-wide-layout-preview`.
There is no deployment or public Pages preview for this branch.

## Try locally

Reuse the existing checkout and dependencies:

```sh
python3 build.py
python3 -m http.server 8001 --bind 127.0.0.1 --directory docs
```

The normal local page is unchanged. Append `?layout=wide-preview` to opt in.
Only viewports at least 1280px wide receive the experimental CSS. Narrower
screens use the original layout even when the query parameter is present.
There is no saved preference or production navigation item. Back/forward URL
changes update only the layout attribute; they do not modify application state.

## What changes, and what does not

- Maximum wrapper: **1280 → 1440px**, including two 40px inner gutters. Usable
  content width is **1200 → 1360px** at both desktop targets.
- Landing: wider text/field allocation, bounded 600px Policy Field, a 64px hero
  gap and 20px less top padding. Headline, copy, CTA, styles and original SVG
  paths are unchanged. The body copy retains its existing readable line length.
- Dashboard: sidebar **250 → 240px**, a 32px sidebar/content gap, and the original
  control diagram beside its actual financial readings. Budget and facts share
  a row; approval inbox and controls share a row; activity and agent tester retain
  full-width rows. Source/keyboard order follows that visual reading order.
- No essential data is hidden, no form is removed, and no payment or wallet
  function changes. Original diagram geometry and meaning are preserved. Reading
  widths for the field footnote and activity text are bounded.
- All new rules require both the query opt-in and a desktop media query. The
  original Policy Field CSS/JS, application/wallet/payment script, contract,
  MCP, ABI, network configuration and simulation bundle remain unchanged.

## Actual Chromium captures

Each pair uses the exact specified viewport, Chromium, loaded local fonts,
reduced-motion preference and scroll position. Dashboard pairs use the **same
running wallet-free simulation**, not separate seeds: same addresses, contract,
balances, pending requests, event hashes and browser storage. Switching the URL
layout attribute changes only CSS. The runner hashes storage values for equality
checks; no private keys are written to the measurement report. Simulation remains
explicitly labeled, and the MCP configuration stays hidden.

| Viewport | Landing current | Landing wide | Dashboard current | Dashboard wide |
|---|---|---|---|---|
| 1440 × 900 | [Image](landing-current-1440.png) | [Image](landing-wide-1440.png) | [Image](dashboard-current-1440.png) | [Image](dashboard-wide-1440.png) |
| 1728 × 1117 | [Image](landing-current-1728.png) | [Image](landing-wide-1728.png) | [Image](dashboard-current-1728.png) | [Image](dashboard-wide-1728.png) |

These are viewport screenshots, not scaled mockups or composites. They do not
hide offscreen content; all remaining content can be scrolled normally.

## Measured differences

Full measured rectangles are in [measurements.json](measurements.json).

| Measure | Current | Wide |
|---|---:|---:|
| Effective left/right content gutter at 1440px | 120px | 40px |
| Effective left/right content gutter at 1728px | 264px | 184px |
| Landing copy column | 603px | 693px |
| Landing Policy Field width | 549px | 600px maximum |
| Agent Control Field height | 813px | 504px |
| Entire seeded dashboard page height | 3912px | 3054px |
| Approval inbox top, document Y | 1580px | 1108px |

Dashboard page height falls by **858px, about 21.9%**. The abstract control field
is roughly 38% shorter. At 1728 × 1117, the wide view shows the field's financial
readings plus the allowance meter and facts on the first screen. At 1440 × 900,
the wide view exposes the financial readings sooner, but the meter is still below
the fold. Approval cards still require scrolling in both variants; the 1728px
wide capture only reaches the approval heading at its bottom edge.

## Visual assessment and trade-offs

**Landing:** the wider wrapper reduces unused side space, especially at 1728px,
and the bounded diagram is easier to inspect. The original composition has more
quiet space and a better-balanced headline measure at 1440px. The wider headline
column can leave “act.” alone on its second line; extra width is not automatically
better editorial composition. Supporting text is not stretched into long lines.

**Dashboard:** the wider view is more useful as a control surface: readers can
see exact financial values beside the policy rather than scrolling past a large
illustration. The two-column lower layout reduces vertical travel without
removing information. At 1440px it feels denser, with only 40px outer content
gutters and smaller rendered diagram labels. At 1728px the margins are more
comfortable and the taller viewport reveals the budget row. The diagram's
precise financial information remains available in unchanged-size text and
accessible details; it is not encoded in node positions.

Expanded controls can lengthen their shared grid row and leave blank space below
the shorter adjacent inbox. Activity remains after both columns in DOM order;
this experiment does not invent independent scrolling columns or alter keyboard
navigation. These costs support a hybrid recommendation rather than adopting
“wide everywhere.”

## Validation and reproduction

Completed on the current environment:

- 27 Foundry tests passed, including 1,000 fuzz runs; 0 failed/skipped.
- 6 MCP tests passed; 0 failed/skipped.
- `python3 build.py` passed.
- Existing Phase 1 and Phase 2 browser suites passed on the default route.
- Existing check-in rehearsal passed, including independent fresh mobile startup,
  no console errors/missing assets and no external asset requests.
- The comparison runner verified default landing pixels against the actual main
  build at both desktop sizes; default dashboard geometry matched the main build.
- At 320/390/768px, current and query-preview landing/dashboard screenshots were
  pixel-identical. No horizontal overflow; expanded desktop forms remained usable.
- Each dashboard comparison pair preserved exact state and original SVG markup.
  Actual preview-mode payment, freeze and unfreeze also passed.

Both existing Phase 1 and Phase 2 browser suites also passed with
`?layout=wide-preview`, including actual approval, funding, withdrawal, freeze
and expiry flows. Each route received nine axe WCAG A/AA scans with zero
violations (18 scans total across default and preview). Real extension-wallet integration and live testnet
execution are not claimed; no transaction was sent to a live chain.

```sh
export FOUNDRY_SOLC=/workspace/.allowance-tools/solc-0.8.28
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test -vv
(cd mcp && ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test)
NODE_PATH=/workspace/.ui-tools/node_modules node script/ui-smoke.cjs
NODE_PATH=/workspace/.ui-tools/node_modules UI_A11Y=1 node script/policy-field-smoke.cjs
NODE_PATH=/workspace/.ui-tools/node_modules node script/checkin-smoke.cjs
NODE_PATH=/workspace/.ui-tools/node_modules \
UI_EVIDENCE_DIR=/workspace/allowance/docs/ui-evidence/layout-comparison \
node script/layout-comparison.cjs
```

For main-reference checks, serve an unmodified copy of the base commit's static
`docs/index.html`, `docs/sim.js` and `docs/vendor/` from a separate local directory,
then set `UI_BASELINE_URL` to that server. This requires no extra Git checkout or
worktree. Without that optional server the runner explicitly reports the
main-reference checks as unrun, rather than claiming they passed.

Keep this feature branch unmerged pending review. No main changes, contract
redeployment, GitHub Pages publication or production preview URL is part of this
comparison.
