# Phase 4B — final jury experience implementation

Date: **28 October 2026, Europe/Istanbul (UTC+03)**. Base: **`0ec3e57a83f1d49fed9fdf3f51efccaef84a52a3`**, fetched and verified against `origin/main`. Feature branch: **`codex/allowance-final-experience-phase4b`**.

Implements the scoped recommendations from the [Phase 4A audit at commit 7551c4c](https://github.com/Oziman13/allowance/blob/7551c4c6e0a66b403c3711d63847e6540b187981/docs/FINAL-EXPERIENCE-AUDIT-PHASE4A.md). That audit is on its separate branch, not silently copied into this baseline. This is implementation/verification documentation, **not an independent security audit**.

**Recommendation: CONDITIONAL GO for the final jury release.** All local checks below pass and the feature is ready for review. Published Pages/RPC verification and a human two-minute/real-device rehearsal remain open. Native signed writes remain **NO-GO** under the existing Phase 3B-2 gates. No PR, main merge, production deployment or public-chain transaction is part of this phase.

## Changes

### Truthful financial information

`web/spending-view.js` is a display-only BigInt derivation, separate from wallet/transaction code. It distinguishes:

- **Recorded account budget:** nominal contract-ledger balance, not a guarantee of token backing or net recipient receipt.
- **Available autonomous capacity this fixed window:** `min(period headroom, budget)` while eligible. Frozen, expired or zero-per-payment-cap policies yield zero current capacity. Unused policy headroom is explained separately; it is not described as immediately spendable.
- **Maximum single autonomous payment:** `min(available capacity, per-payment cap)`, for an eligible recipient. It is a policy ceiling, not a recipient quote or execution guarantee. The existing contract preview checks the chosen address; actual fees, wallet gas and transfer success still matter.

Expiry uses the authoritative chain timestamp, including `timestamp >= expiresAt`. The display uses the contract's remaining-window view; it does not replace fixed windows with calendar or rolling limits. Owner withdrawals/approvals remain outside autonomous caps. Their budget debit can still reduce budget-backed available capacity without consuming period headroom; both unit and actual local owner-approval tests cover that distinction. Held requests reserve no funds.

Financial reads retain the existing latest-state RPC call shape. The reader checks the latest head before and after account reads and accepts the snapshot only if its hash is unchanged. History reads follow without redefining that financial snapshot. A read generation rejects late results. On loading, the panel says **Reading…** and is busy; account/clock failures, malformed or changed snapshots become **Unavailable**, never fabricated zero balances. Sidebar current capacity is also cleared. No historical-state RPC capability, new payment retry or new authorization path was introduced. Existing new-block read refresh remains unchanged.

### Guide the existing lifecycle

`web/demo-guide.js` adds simulation-only navigation around the seeded Research agent. It does not fill forms, submit payments, approve, freeze, retry, sign or broadcast. The visitor explicitly uses the existing controls.

The guide observes confirmed receipts and matching events from the **selected simulation contract and account**. A new held request must have its exact matching PaymentHeld/request ID before a link can select it; previews, uncertain outcomes and unrelated-contract logs cannot choose a seeded request. Approval progression requires the matching RequestResolved/Paid evidence. These checks affect guidance only; existing transaction/result handlers are unchanged.

The top review control and contextual **Review request #N** link focus the actual pending card. A missing/resolved card does not redirect to another request. Freeze navigation focuses the existing button without activating it; proof navigation opens the historical evidence details and focuses its heading. Focus scrolling respects reduced motion. Guidance describes expired, paused, exhausted and changed-policy cases rather than promising the seeded outcome regardless of current rules. Changing selected accounts resets guidance context; the proof entry stays available throughout simulation.

The automated positive flow runs the real Allowance bytecode locally:

| Step | Budget | Current capacity | Single ceiling / outcome |
|---|---:|---:|---|
| Seeded account | 19 POT | 4 POT | 1 POT to an eligible recipient; two pre-existing requests |
| New trusted 0.1 payment | 18.9 POT | 3.9 POT | Confirmed local autonomous payment |
| New 2.5 request | 18.9 POT | 3.9 POT | **Request #2**, held, not paid; seed request #0 has the same amount |
| Owner approves #2 | 16.4 POT | 3.9 POT | 1 POT ceiling; approval did not consume autonomous capacity |
| Freeze | 16.4 POT | 0 POT | 0 POT single ceiling; new agent operations blocked |

The test additionally approves old seed request #0 **while frozen**, leaving budget 13.9 POT and current autonomous capacity/ceiling zero. This verifies the owner exception remains available; it is not an extra required jury step.

### Evidence and claims

The existing Policy Field theme, fonts and state colors remain. The primary wallet-free CTA is preserved. A compact guide and expandable **Recorded Claude testnet proof · 23 October 2026** entry remain visible after simulation hides the landing section.

The proof entry links directly to the existing October 23 section, source event export and historical 2:21 check-in video. It distinguishes the recorded agent 0.3 POT payment, held 2 POT request (not a payment), owner-authorized 2 POT payment, freeze event, and reported MCP refusal with **no new transaction**. It does not fabricate a live Claude conversation, model-authorship proof or API service delivery. Recorded recipients/memos and the historical export are not rewritten.

Current README/JUDGING/architecture/proof text now states 58 Foundry / 37 MCP / 24 native unit tests, separates CI from local checks, links completed internal static analysis, scopes wallet/token/refuel claims, explains fixed windows and owner exceptions, and labels older screenshots/deck/video as historical. Older reports and media retain their original dates/counts. The proof query is bounded to the recorded block range; missing live receipts/logs are not treated as success/failure proof.

The native identity inspector is a secondary footer route, explicitly read-only. Its extension, RPC, mapping and ownership code/bundle are unchanged. It cannot enter the EVM owner state or acquire a new signing/mapping route. The main documentation link leads to the curated jury guide rather than an unstructured directory.

## Validation

Tooling already present: Node 24.19.0, Forge 1.7.1, solc 0.8.28, Chromium 154.0.8037.57, isolated Playwright 1.56.1 and axe Playwright 4.10.2. **No dependency, lockfile or CI changes; no package installation was needed.** Browser tests use `http://127.0.0.1:8001`, not Pages. Their simulation transactions/keys are local test fixtures, not public-chain activity or real owner secrets.

[Raw commands and results](ui-evidence/phase4b/verification.txt) retain actual successful output. Initial iteration exposed a loading-state/test timing assumption; `policy-field-smoke` now captures its pre-approval financial snapshot atomically instead of comparing a number with **Reading…**. Its capacity assertion is retained. `checkin-smoke` changes only its intended period-label expectation from “day” to “24 hours.” No existing lifecycle checks were removed.

| Check | Actual result |
|---|---|
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x4b -vv` | **58 passed, 0 failed/skipped**, four suites including 1,000-run fuzz and stateful invariants |
| `ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp` | **37 passed, 0 failed/skipped**, local Anvil only |
| `npm test --prefix substrate` | **24 passed, 0 failed/skipped**, native implementation unchanged |
| `node script/spending-view.test.cjs` | **10 passed, 0 failed/skipped**, using node:test; active, frozen, exact expiry boundary, exhausted window, low/zero budget, owner budget debits versus period headroom, all caps, zero per-payment cap, missing time and malformed/unavailable data |
| Existing `ui-smoke`, `wallet-smoke`, `policy-field-smoke`, `checkin-smoke`, `native-wallet-smoke` | **5/5 scripts passed**, using `NODE_PATH=/tmp/allowance-native-browser/node_modules`; `UI_A11Y=1` for policy-field |
| New `jury-experience-smoke` | **1/1 script passed**; exact monetary sequence, request-ID/focus isolation, unrelated-event rejection, frozen owner approval, recipient restrictions, exhaustion, expiry and clock/account/changed-head failures |
| `python3 build.py` | Pass; complete HTML plus existing pinned simulation/native SDK build; repeated output deterministic |
| Python AST / `node --check` on changed scripts | Pass |
| Whitespace and protected-source checks | Pass; exact scope described below |
| `forge fmt --check` | **Exit 1 on pre-existing formatting** in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. No unrelated formatting was applied |

Browser scripts are assertion-based smoke programs; six passing scripts are not a fabricated browser unit-test count. Existing CI still runs **Foundry and MCP only**. Native/display/browser checks above ran locally, not as newly added CI jobs.

### Accessibility, responsive behavior and evidence

Checked widths: **320, 390, 768, 1440px**, no horizontal overflow in the exercised states. Tests cover keyboard skip link, Enter navigation, exact request-card focus, freeze-button focus, proof-heading focus, reduced motion and **200% CSS layout zoom** (`html.style.zoom = '2'`). This is explicit layout-zoom automation, not a claim of physical-device or browser-chrome/assistive-technology certification.

**14 axe scans, zero WCAG 2 A/AA / 2.1 AA violations:** nine policy-field scans (landing, mobile, payment/approval/blocked states), three new whole-page jury scans (landing desktop, simulation mobile, frozen desktop), and two native-panel scans (desktop/mobile). Human screen-reader/real-device review remains a release follow-up.

All new screenshots visibly identify **LOCAL PREVIEW / SIMULATION / MOCKED WALLET / NO LIVE-SITE VERIFICATION**. The positive flow uses actual local EVM results; negative RPC/event fixtures are synthetic and are not live-chain evidence. Temporary screenshot labels/toast cleanup do not replace account amounts or outcomes and are not production UI code.

- [Landing, 1440px](ui-evidence/phase4b/local-landing-1440.png)
- [Separate financial amounts, 390px](ui-evidence/phase4b/local-capacity-390.png)
- [Exact held request #2, 320px](ui-evidence/phase4b/local-held-request-320.png)
- [Frozen capacity and ceiling zero, 1440px](ui-evidence/phase4b/local-frozen-capacity-1440.png)
- [Historical proof entry, 768px](ui-evidence/phase4b/local-recorded-proof-768.png)

### Cold-load / simulation-ready measurements

[Raw local lab measurements](ui-evidence/phase4b/local-performance.json). Fresh contexts, cache disabled, loopback server, no network throttling, reduced-motion preference. CPU 4× is Chromium emulation, not a real mobile device. Times include automation overhead; LCP is the observed buffered value at sampling, not a field Core Web Vitals score. No other test suites ran during the recorded measurements.

| CSS viewport / CPU | Load event | Observed LCP | Click-to-simulation-ready |
|---|---:|---:|---:|
| 1440px / 1×, sample 1 | 366 ms | 352 ms | 891 ms |
| 390px / 1× | 409 ms | 372 ms | 848 ms |
| 1440px / 1×, sample 2 | 354 ms | 312 ms | 915 ms |
| 390px / 4× | 732 ms | 560 ms | 2800 ms |

These four lab samples show the exercised local path, not a statistical performance claim, WAN timing, measured human two-minute completion or published-site speed. Initial load does not request either simulation/native SDK; simulation loads on its explicit CTA, and proof/navigation does not eagerly load the native SDK or make public RPC requests.

## Protected scope and build review

Compared against base `0ec3e57a83f1d49fed9fdf3f51efccaef84a52a3`:

- Solidity, contract tests, ABI files, MCP code, network IDs/addresses, deployment/Foundry configuration, native implementation, dependencies/lockfiles and CI are unchanged.
- Embedded `ABI`, `BYTECODE` and `NETWORKS` literals in generated HTML are exactly unchanged. `docs/abi.json`, `docs/sim.js`, `docs/native-wallet.js` and native SDK license output remain byte-identical. Only the intended generated HTML changes.
- The complete bodies of `send`, `previewPay`, `payAsAgent`, `saveRules`, `fundOrWithdraw`, `trustEdit`, `toggleFreeze`, `openAccount`, `deploy`, `switchToPortaldot`, plus the inbox's approval/rejection handler, were compared with the base and are **byte-identical**. New request IDs/tab stops are DOM navigation additions outside that handler.
- Historical reports, check-in docs, pitch deck/video and existing screenshots are untouched. No current-source claims are backdated into those artifacts. Existing untracked `lib/` and scratch `work/` are excluded.

## Exact changed files

```text
README.md
build.py
docs/ARCHITECTURE.md
docs/FINAL-EXPERIENCE-IMPLEMENTATION-PHASE4B.md
docs/JUDGING.md
docs/PROOF.md
docs/index.html
docs/ui-evidence/phase4b/live-access.json
docs/ui-evidence/phase4b/local-capacity-390.png
docs/ui-evidence/phase4b/local-frozen-capacity-1440.png
docs/ui-evidence/phase4b/local-held-request-320.png
docs/ui-evidence/phase4b/local-landing-1440.png
docs/ui-evidence/phase4b/local-performance.json
docs/ui-evidence/phase4b/local-recorded-proof-768.png
docs/ui-evidence/phase4b/verification.txt
script/checkin-smoke.cjs
script/jury-experience-smoke.cjs
script/policy-field-smoke.cjs
script/spending-view.test.cjs
web/demo-guide.js
web/index.src.html
web/native-wallet.css
web/policy-field.css
web/policy-field.js
web/spending-view.js
```

## Live limitations and remaining issues

[Fresh access evidence](ui-evidence/phase4b/live-access.json) records the actual URLs, read-only payloads, Istanbul timestamps, exit codes and proxy headers. Pages, configured Substrate genesis and EVM chain-ID requests all failed with **proxy CONNECT HTTP 403 / curl exit 56**. No response from the target application/RPC was obtained. The environment policy lacks those host rules; no alternate endpoint, VPN or proxy bypass was attempted. This does not establish that the testnet or site is down.

The feature is a local build/branch, **not deployed**. Current published asset hashes, browser CORS, real wallet compatibility, current runtime/contract presence and real native identity mapping remain unverified. The connected-browser surface was unavailable; all browser checks above are isolated local Chromium project tests, not the user's authorized wallet session.

Financial ceilings remain snapshots and can become stale after verification; a changing/unavailable head now fails closed rather than showing an assumed amount. Existing transaction/fee/result handling deliberately remains unchanged. The exercised jury flow is native POT; token metadata/transfer behavior, net recipient amounts, collateral and production asset safety remain subject to the existing [security policy](../SECURITY.md), not new compatibility guarantees. A real agent's independently held funds and gas seeds remain outside contract control.

Before a separately authorized release: review the branch, verify served asset hashes and links on accessible Pages, rehearse the two-minute route with unfamiliar users/real devices, and recheck expected testnet data through the configured hosts. Do not treat the lab timings or mocked native tests as those missing checks. Native signed writes, mapping, contract changes, deployments and PR/merge actions require separate authorization.
