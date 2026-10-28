# Phase 4A — final jury experience audit

Date: **28 October 2026, Europe/Istanbul (UTC+03)**. Baseline: **`0ec3e57a83f1d49fed9fdf3f51efccaef84a52a3`**, fetched from `origin/main` and matched exactly. Branch: `codex/allowance-final-experience-audit-phase4a`.

**Recommendation: CONDITIONAL GO for the narrowly scoped Phase 4B below. Preserve the dark visual identity and working demo. Correct the spendability display and factual claims, guide the existing lifecycle, and make the recorded Claude evidence accessible from the demo. NO-GO for claiming native signed-wallet support, production readiness or independently audited security.**

This is an audit and plan, not an implementation or independent security audit. **The sole changed file is this report.** No Solidity, ABI, MCP, wallet transaction logic, deployment configuration, generated site or production UI is changed. No deployment, merge or public-chain transaction was performed. The audit uses only Allowance source and its existing linked project evidence; no unrelated repository or competitor research was undertaken.

## 1. Evidence and verification limits

Evidence labels in this report:

- **Current source / local execution:** inspected at the baseline above; tests and isolated source-function reproduction actually run in this phase.
- **Historical browser simulation:** existing screenshots and prior browser runs, not fresh captures or live-site verification.
- **Historical recorded testnet evidence:** checked for internal consistency with the repository's event export, not refreshed against the chain.
- **Mocked native data:** fixture identities/runtime responses, not actual wallet control or runtime capability evidence.
- **Unverified:** requires accessible live endpoints, a browser session, human observation or independent corroboration.

### Live access attempted

At **13:41:13 UTC+03 on 28 October**, the actual Pages URL `https://oziman13.github.io/allowance/` returned:

```text
curl: (56) CONNECT tunnel failed, response 403
HTTP/1.1 403 Forbidden
server: envoy
date: Wed, 28 Oct 2026 10:41:13 GMT
```

Command: `curl --max-time 20 --silent --show-error --include https://oziman13.github.io/allowance/`. The linked explorer block `https://scanner-testnet-v3.portaldot.dev/#/blocks/159822`, recorded video `https://youtu.be/fxO8grGr4PY` and configured EVM endpoint `https://test-evm-rpc-v3.portaldot.dev` were also attempted. All failed at proxy CONNECT with **exit 56 / HTTP 403**. The video/explorer checks used HEAD without following redirects; the EVM request was read-only `eth_chainId`. No target page, video, RPC response or current deployed asset was obtained. These are environment access failures, **not proof that the project sites are down**. No alternate RPC, proxy, VPN or policy bypass was used.

The enforced environment policy lacks the relevant host rules. The Browser skill was consulted, but no connected-browser or cloud-browser control tool was exposed. **No fresh browser session, screenshot, Lighthouse run, screen-reader session or live wallet test was captured in Phase 4A.** Existing browser evidence is explicitly dated below. No claim of live visual verification, measured jury completion time or current Core Web Vitals follows from this audit.

### Historical visual evidence actually inspected

| Artifact | Provenance and limits |
|---|---|
| [Check-in landing](ui-evidence/checkin/landing.png) | **Historical browser capture**, committed in `00d81eecac71f22c0fa62d4b74c8a90e84aa9f23`, 24 October, 09:54 UTC+03. Shows the dark policy-field design, not today's native header or live deployment. |
| [Check-in mobile dashboard](ui-evidence/checkin/mobile-dashboard.png) | Same historical commit; **browser simulation**, visibly labeled. The 1700px-tall image still ends around the budget ring, before the payment controls. Not a new mobile measurement. |
| [Native inspector, 320px](native-wallet-validation/phase3b2/native-mocked-verified-320.png) | Existing Phase 3B-2 evidence in the current baseline, visibly **MOCKED RUNTIME**. Useful for inspecting density and read-only presentation, not identity or signed-write proof. |
| [Phase 3B-2 browser results](native-wallet-validation/phase3b2/tests-browser.txt) | Prior **local** runs of all five browser scripts. Source inspection confirms the check-in policy-field JS/CSS remain unchanged; the dashboard HTML changes since that capture add the native panel/wiring. This does not turn an old capture into a fresh observation. |

The current baseline contains the completed Phase 3B-2 changes. Its [report](NATIVE-WALLET-VALIDATION-PHASE3B2.md) records native write readiness as NO-GO. Native screenshots and public address similarity must not be used to override that gate.

## 2. First impression and what should be preserved

The product already has a strong first proposition: **“Give your AI agent an allowance, not a wallet.”** The supporting copy explains autonomous small payments and owner decisions. **Try Interactive Demo is already the primary hero CTA**, with “Real contract. In-browser simulation. No wallet needed.” immediately below it (`web/index.src.html:487–493`). Do not diagnose wallet-free discovery as absent or replace this with another wallet-first onboarding flow.

Preserve Sora/Inter/monospace hierarchy, navy surfaces, violet/mint/amber/red state language, generous desktop spacing and the policy-field metaphor. The historical landing shows a recognizable explanation of the agent's boundary, rather than an undifferentiated metrics dashboard. The illustration has an explicit **ILLUSTRATION** label, example scenarios and keyboard-operable buttons; these are useful distinctions to retain. This is a design assessment of repository artifacts, not a claim of uniqueness across the market.

The principal weakness is the route from this proposition to proof. The visitor must reconcile an illustrative landing, seeded local transactions, historical real transactions, EVM wallet actions and an advanced native identity inspector. More decorative effects or a wholesale redesign would add risk before resolving that hierarchy.

## 3. Current user and jury journeys

### Current first-time user journey, from source

| Stage | Current behavior and consequence |
|---|---|
| Arrival | Hero offers the wallet-free demo and EVM connection; the header also offers **Native wallet · Read-only**. The latter is an identity inspector, not another way to execute owner operations. |
| Enter demo | `startSimulation()` lazily loads `sim.js`, deploys the real bytecode locally and seeds an account and four agent calls. Loading text and a disabled CTA already exist; startup duration is unmeasured here. No wallet extension or public testnet POT is needed. |
| Initial state | 20 POT recorded deposit, two autonomous payments totaling 1 POT: **19 POT budget / 4 POT remaining window capacity / 1 POT per-payment cap**. Two requests already wait: 2.5 POT over-cap and 0.3 POT to an unknown recipient. These are local seeded examples. |
| Discover action | Control field, capacity ring, facts, inbox, owner controls and activity precede **Test an agent payment** in document order (`web/index.src.html:591–714`). On mobile this creates a long path before the first new payment. |
| Pay / hold | Sending 0.1 POT to a trusted recipient creates a new local paid result. Changing to 2.5 POT creates another held request, not a payment. The existing 2.5 POT seed request makes amount alone an unsafe way to identify the newly created request. |
| Approve / freeze | The user returns upward to the inbox to approve the correct request, then to owner controls to freeze, and back toward the agent form to observe blocking. No in-app guided route currently connects those sections. |
| Find real proof | Starting simulation hides `#intro`, which contains the October 19 evidence card and the smaller October 23 Claude link (`:518–539`, `:983`). The real MCP proof disappears from the visible demo journey; the remaining Documentation link goes to the repository's whole `docs/` directory. |

### Current jury reading journey

README → dashboard or 2:21 video → JUDGING → PROOF / architecture / security reports is a credible evidence chain, but it is fragmented. The old two-minute walkthrough is a separate dated document. The current judging page still prioritizes check-in material, stale test totals and a promise of native owner actions in the final recording. A reviewer following the primary CTA can complete a convincing **local** demo without ever seeing the strongest real-AI evidence.

### Proposed two-minute jury route — a target, not an observed completion time

| Time target | Existing action and explanation |
|---|---|
| 0:00–0:15 | State the problem and boundary: agent key, contract escrow, owner exception decisions. Choose the wallet-free demo; clearly identify the illustration and simulation. |
| 0:15–0:30 | Inspect 19 POT budget, 1 POT single-payment cap and 4 POT remaining **fixed-window capacity**. Explain that 4 POT is not permission for a single 4 POT autonomous payment. |
| 0:30–0:50 | Send 0.1 POT to the trusted recipient. Show the **local simulation receipt** and budget/capacity changes to 18.9 / 3.9 POT. |
| 0:50–1:10 | Request 2.5 POT. Show “held, not paid,” the new request ID and unchanged balance/capacity. Navigate to that exact request rather than another seeded card. |
| 1:10–1:30 | Owner approves that request: budget 16.4 POT, autonomous capacity still 3.9 POT. Explain that owner-approved spending does not consume autonomous limits. |
| 1:30–1:45 | Freeze; show the disabled new-payment path and explain that new agent pay/refuel/request operations stop. Disclose and fix the current spendability display issue below before using its amount as a demonstration. Existing owner approvals/withdrawals remain possible. |
| 1:45–2:00 | Open the recorded **23 October testnet MCP evidence**, separately labeled, and show its paid / held / owner-approved / frozen sequence. End with testnet-only, internal-review and native-read-only limitations. |

Native inspection, wallet installation, token compatibility setup and MCP key export are optional technical follow-ups, not prerequisites for this route. No automatic approval, payment or testnet connection should be added to guide the user.

## 4. Specific findings and severity

Severity here describes jury comprehension/trust, not a new contract exploit. **High** should be resolved before final recording; **Medium** obstructs the two-minute route; **Low / risk** needs targeted validation rather than speculative redesign.

| ID / severity | Evidence and specific consequence | Minimal recommendation |
|---|---|---|
| F1 — **High, confirmed display defect** | `spendNow()` at `web/index.src.html:1088` returns only `min(left, balance)`. Both `#dLeft` (`:1123`) and **Can spend now without asking** (`web/policy-field.js:53`) use it. Contract `_left()` (`src/Allowance.sol:407`) reports period headroom without freeze/expiry checks. A blocked agent can therefore retain a positive spendability headline alongside a blocked status and disabled payment. | Separate currently executable autonomous spending from remaining policy headroom. Show zero current spendability for frozen/expired accounts using chain time; distinguish total window capacity from the maximum one payment. Preserve budget and historical usage figures. |
| F2 — **High, inaccurate boundary claims** | UI says **“nothing can move”** after freeze (`:531`), **“gas included”** (`:513`) and **“Five POT a day means five POT a day”** (`:555`). These overstate contract guarantees and obscure owner exceptions, seeds/wallet funds and fixed windows. | Use the exact corrected copy in section 7. No contract or transaction change is needed. |
| F3 — **Medium, proof drops out of the main route** | October 23 Claude proof is a small link after the longer October 19 card; both are hidden when the demo hides `#intro`. No equivalent real-proof link exists in the demo workspace. | Keep a short, clearly historical MCP-proof link reachable during simulation; link Documentation to a curated judging entry instead of a directory. |
| F4 — **Medium, long action loop and request ambiguity** | Agent form sits below inbox, controls and activity. The user creates a 2.5 POT request at the bottom, returns to an inbox already containing a seeded 2.5 POT request, approves, then navigates to freeze and back. Historical mobile capture corroborates the density, but current scroll distances are unmeasured. | Add a small simulation-only step/jump strip or contextual **Review request #N** link using the already confirmed request ID. Move focus appropriately; never auto-approve. Avoid rearranging every dashboard section. |
| F5 — **Medium, inconsistent credibility facts** | README/JUDGING say 46 contract tests while fresh execution reports 58; README says scanners remain pending despite completed Phase 2B-3 artifacts. Dated deck/check-in counts and native roadmap promises are mixed into the current final route. | Establish one dated current-status block; link historical records as historical. Do not globally rewrite old audit baselines. |
| F6 — **Medium risk, native inspector competes with the jury task** | Header entry is visible before the hero; at ≤560px `web/native-wallet.css:37` makes it full width. The panel is intentionally dense, displays long identifiers and can return unavailable/unverified data. This can look like a failed required onboarding step despite clear read-only labeling. No fresh user confusion was measured. | Keep the capability, but present it as a secondary **Native identity inspector · read-only** technical path, with clear EVM-owner versus native-read separation. Preserve all mapping, cancellation and isolation guards. |
| F7 — **Low / unmeasured performance risk** | Initial HTML embeds fonts/ABI/bytecode and loads ethers; opening native inspection adds a substantial SDK bundle. Simulation startup performs real local EVM work. Existing loading states and lazy loading help. | Profile the actual release before optimizing. Keep native SDK and simulation off the initial request path; do not add a new animation/video framework. |
| F8 — **Low / accessibility verification gap** | Small monospace activity/hash text, long native addresses and the mobile action loop need current whole-journey checks. Prior native-only axe success does not cover the entire app or assistive-technology behavior. | Recheck keyboard/focus, zoom, contrast and target sizes at the four supported widths. Do not label this a proven WCAG failure without a current scan/manual check. |

### F1 isolated reproduction, actually executed

The exact one-line `spendNow` declaration was extracted from the current HTML source and evaluated with Node's `vm.runInNewContext`. Mocked account inputs: **19 POT balance, 4 POT period headroom, 1 POT per-payment cap**. Output:

```text
Active account:                   displayed spendNow = 4 POT
Frozen account:                   displayed spendNow = 4 POT
Expired account (expiresAt = 1):   displayed spendNow = 4 POT
```

This is an **isolated source-function reproduction with mocked accounts**, not a browser screenshot or live-chain result. Source tracing connects that output to both labels, and `_left()` confirms that its input need not be zero when frozen/expired. Active 4 POT is valid **aggregate headroom**, not a single-payment allowance; frozen/expired **currently spendable** should be zero. The contract's agent checks still enforce freeze/expiry and the per-payment cap. This is a misleading display, **not a bypass of on-chain enforcement**. Existing tests check blocked state/disabled actions but do not assert zero for these headline amounts.

## 5. October 23 Claude MCP evidence and accessibility

The strongest existing evidence is a real testnet payment lifecycle attributed to Claude through MCP in [PROOF.md](PROOF.md#a-real-ai-assistant-on-chain-2026-10-23). The checked-in [event export](../evidence/onchain.json) records chain **420420777**, contract **`0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f`**, account **0**, and a capture time of **26 October, 21:07:47 UTC+03**, at read block **206637**. It contains **21 event records from 14 distinct event-bearing transactions**; the separately recorded deployment makes 15 transactions overall. Do not call 21 events 21 payments or 15 Claude transactions.

| Recorded step | Export checked against PROOF.md |
|---|---|
| Paid, block 159822 | `0xc26b7d632cc5d334dfc46c5c8cb8d31aac22cf69036cd7661bd9b08c0bf0899b`: `Paid`, account 0, **0.3 POT**, memo “Market data API access.” |
| Held, block 160197 | `0xb60b8adad44bf3068b55a7672150d4956732785e2f66b999c631368b44a824b7`: `PaymentHeld`, request **2**, account 0, **2 POT**, reason `1` (OverPerPayment). **Not a payment.** |
| Owner-approved, block 160213 | `0x8be27fd120405d37c4d8329f676b03d113dee62451fceadcfbd38d5460924435`: `RequestResolved` for request 2 and `Paid` for **2 POT**, with matching recipient/memo. This action is attributed to the owner, not Claude. |
| Frozen, block 160231 | `0x8427471d9b800c41d30ba811b96f96231916c439c2f8a2784435a842a5bd9d2d`: `FrozenSet(accountId=0, true)`. The reported subsequent MCP refusal produced no transaction and cannot have its own paid-event proof. |

The recorded payment recipient is the documented owner address `0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547`. This demonstrates a testnet transfer/control scenario; the memo does **not** prove purchase or delivery by an external API/compute vendor. Events do not encode “Claude” as the author. Claude attribution and the reported dry-run refusal come from the project's session account and linked narrated demo; no separate raw Claude transcript was located among repository files. This phase could verify the export/document consistency, not independently watch the blocked video or refresh RPC evidence.

Accessibility of the evidence:

- **Good:** full hashes, block links, contract/chain IDs, amounts, owner-versus-agent roles, event export, reproduction scripts and an accessible-text proof page exist. The deck is present locally and its text can be extracted.
- **Friction:** the first proof table is October 19; the differentiating October 23 story requires another heading/scroll. Explorer links identify Substrate blocks, not a familiar Ethereum transaction page. Explain which event/account/recipient/amount to inspect.
- **Unavailable here:** Pages, explorer, video and RPC. Preserve readable in-repository fallback evidence, dates and links; do not fabricate a “verified live” badge or replacement transcript.
- **Historical scope:** old receipts may be pruned according to repository observations. A missing receipt is not success or failure proof. An unrelated event in a transaction is insufficient payment evidence. Never infer model authorship, fulfillment or current service health from a stored JSON file.

## 6. Alignment with the four judging criteria

Weights are taken from [JUDGING.md](JUDGING.md); no score or rule change is invented.

| Criterion | Existing technical value | Jury-experience gap and proposed emphasis |
|---|---|---|
| **Technical Feasibility — 30%** | Deployed testnet contract record, complete core lifecycle, MCP, owner dashboard, reproducible source/tests, internal security analysis. | Put correct test totals, recorded contract/transactions and explicit current limitations on one evidence route. Distinguish local reproduction from fresh deployment verification. |
| **Innovation — 30%** | Contract-enforced autonomous escrow boundaries with owner-held exceptions, plus AI tool integration and Portaldot storage/gas trade-offs. | Demonstrate one automatic payment and one held request before discussing architecture. Surface the recorded Claude/MCP path. Do not claim novel-to-market status, WASM/multi-chain execution or native signed writes without evidence. |
| **Ecosystem Contribution — 20%** | MIT code, five MCP tools, Portaldot Solidity guide, funding/deposit observations and reusable spending contract. | Link directly to the guide, architecture and MCP setup after the demo. Native inspection is additional read-only work, not a completed native-owner integration. npm publication remains unverified; examples of APIs/games are not proof of partner integrations. |
| **Business Potential — 20%** | Clear agent-team use case; free core, proposed paid team services, no token, proposed future v2 fee. | State who benefits and what is roadmap. The current deployment charges no protocol fee, and no paying-customer/revenue evidence was established. Do not let the roadmap eclipse the delivered product. |

## 7. Outdated or overbroad claims: exact proposed corrections

**These are recommendations only; the source documents and UI remain unchanged in Phase 4A.** Locations refer to the audited baseline. Historical reports retain their original measured baselines, with current-status links where useful.

| Location | Current claim | Exact correction / treatment for Phase 4B |
|---|---|---|
| `README.md:4,101,105`; `docs/JUDGING.md:22` | **46** contract tests; 27 original + 19 audit tests | “**58 Foundry tests: 27 core, 19 Phase 2A, 10 token-compatibility and 2 stateful tests; includes 1,000-run fuzz and stateful invariants. 37 MCP tests and 24 native read-only unit tests.**” Add that the current CI runs Foundry/MCP; native/browser checks were run locally and are not CI jobs. Update badge/comment consistently. |
| `README.md:5,185`; `docs/JUDGING.md:22` | **37 MCP tests** | **Correct; leave 37 unchanged.** No rendered numeric test-total badge was found in the current dashboard HTML; do not invent a stale UI count. |
| `README.md:194,218`; `docs/CHECKIN.md:56` | Slither/Aderyn unavailable or outstanding | Current status: “**Internal Slither 0.11.6 and Aderyn 0.6.8 analysis completed; findings and limitations are documented in SECURITY-STATIC-ANALYSIS-PHASE2B3.md. Not independently audited.**” Preserve the older check-in statement as dated history with a superseding link. Source SHA-256 matches the static-analysis scope. Never turn scanner completion into a clean/audited/security guarantee. |
| `README.md:115,124`; `docs/ARCHITECTURE.md:33` | Any wallet / every browser wallet; every dashboard action owner-signed | “**Owner writes use the existing compatible EVM wallet path. Native extensions provide read-only account/identity inspection; native signing and mapping are not enabled. Simulation uses a local EVM.**” Scope compatibility claims to supported interfaces, not all wallet products/devices. |
| `README.md:198,216`; `docs/JUDGING.md:69–70`; deck page 10 | Native work described only as CLI step; final video promises native owner actions | “**Native browser inspection is implemented read-only. Live/runtime/real-wallet verification remains blocked or unverified; native signed owner operations require a separately authorized proof and remain NO-GO.**” Replace the final-video promise with delivered EVM/simulation flow plus clearly labeled optional native inspection. Keep old roadmap dates as historical plans. |
| `web/index.src.html:531` | Freeze: “**nothing can move**” | “**New agent payments, refuels and requests are blocked. The owner can still withdraw or approve an existing request.**” Freeze does not recover funds already in the agent wallet. |
| `web/index.src.html:513,555` | “**gas included**”; “**Five POT a day means five POT a day**” | “**Native gas refuel withdrawals share the autonomous payment caps. Initial gas seeds, owner-approved payments and spending of wallet funds have separate boundaries.**” Fees/deposits are paid from the wallet; no guaranteed zero-gas refuel. |
| `web/index.src.html:610`; `web/policy-field.js:53`; `web/index.src.html:1088,1123` | “Can spend now” combines aggregate headroom and execution eligibility | Use “**Remaining autonomous capacity this window**” for headroom, and “**Maximum one autonomous payment now**” for `min(budget, window capacity, per-payment cap)` only when unfrozen/unexpired, to an eligible recipient. If either is presented as currently spendable, it must be zero when blocked. Explain recipient restrictions and that a preview is a snapshot. |
| `docs/CHECKIN-2026-10-24.md:18–24`; period labels / skip-day wording | “Today,” “daily allowance,” “daily limit has reset” | Current explanatory copy: “**This fixed 24-hour window, not a rolling day or calendar day. After expiry, the next successful pay/refuel starts a new window.**” The old walkthrough should remain dated; current jury instructions use “this window.” No contract timing change. |
| `web/index.src.html:487,514,549`; `web/policy-field.js:62` | Anything outside rules always waits | “**Valid requests outside autonomous caps/recipient rules may be held. Invalid, frozen, expired or otherwise unexecutable calls can fail; an otherwise instant payment needs sufficient budget.**” Short landing copy can link this qualification rather than becoming a contract manual. |
| `web/index.src.html:711`; `docs/ARCHITECTURE.md:34` | The rules apply to everything the assistant does / compromised assistant fully bounded | “**Contract rules bound authorized escrow operations. Agent-wallet funds, initial seeds, owner exceptions and unrelated actions are outside that boundary.**” Keep the existing supported-asset policy; do not reintroduce “any ERC-20 is safe.” |
| `README.md:182,184,126`; UI simulation comment `:1416` | Every rule exercised on chain / try every feature | “**Core payment, held-request, owner approval and freeze lifecycle demonstrated on testnet and in the wallet-free browser simulation. Additional contract behaviors are covered by local tests.**” The GUI does not expose every contract/token/native operation. |
| `docs/ARCHITECTURE.md:92–95`; `web/index.src.html:556` | 0.03 POT payments, other deposit costs described as current general facts | “**Recorded testnet measurements from October 19/23, 2026; fees and storage deposits depend on runtime, state and memo size.**” Keep measured values as evidence, not price guarantees. |
| `README.md:15`; `docs/JUDGING.md:70` | “2-minute demo” versus **2:21** recording | “**Watch the recorded 2:21 check-in demo**.” The proposed two-minute interactive journey is a separate target, not the video's verified runtime in this phase. |
| `docs/JUDGING.md:25,80`; `docs/CHECKIN.md:48` | 35 commits / 8 days (October 16–23) | Keep explicitly labeled **historical October 23 snapshot**; point current readers to history at the audit baseline. Local baseline history contains 50 reachable commits including merges, across 13 Istanbul commit-date days; that is not certification of 50 qualifying contest commits. Avoid another unqualified live counter. |
| Deck page 6; dated check-in instructions | 33 total tests = 27 contract + 6 MCP; October 24 baseline 27/6 | Historical values are not rewritten as past results. Label the deck/check-in as archived, link current 58/37/24 results, and update a future final deck from its editable source if available. Only the PDF was found here; no new deck is proposed as a Phase 4B coding requirement. |
| `README.md:129`; `docs/JUDGING.md` reproducible-build claim | `forge build && python3 build.py` presented without native/simulation build prerequisites | “**Install pinned `web/sim` and `substrate` dependencies with `npm ci` before regenerating their bundles; without them build.py may keep committed assets.**” Do not claim a retained bundle was rebuilt. |

The existing security policy correctly distinguishes fixed windows, owner approvals, seeds/refuels, unsupported-token risks and the lack of an on-chain allowlist. Preserve those boundaries and link them rather than replacing them with stronger marketing guarantees.

## 8. Mobile, accessibility and performance assessment

**Mobile:** current CSS stacks the hero/app, has narrow-screen policy-field fallbacks and wraps long native identifiers. Historical mobile evidence shows clear state colors and readable primary controls, but a long vertical route. The extra full-width native header action adds choice and height before the primary jury task. Exact current scroll distances, zoom behavior and real-device usability remain unverified.

**Accessibility strengths from source/prior evidence:** skip link, semantic buttons, scenario `aria-pressed`, descriptive state text, live regions, dialog labels, Escape/focus restoration and reduced-motion rules. The Phase 3B-2 report records **two native-panel axe scans, zero violations**, desktop and 320px, plus responsive checks at 320/390/768/1440. These were **prior local tests**, not a fresh full-site accessibility certification. Check screen-reader order/focus after jump navigation, 200% zoom, contrast, small activity labels and target spacing in Phase 4B. Keep visible text with colors; do not replace status explanations with icons alone.

**Static resource inventory, measured from current local files:**

| Asset | Raw bytes | Recompressed gzip estimate |
|---|---:|---:|
| `docs/index.html` | 391,825 | 212,439 |
| Local ethers 6.13.4 | 505,826 | 156,222 |
| `docs/sim.js` (on demand) | 445,213 | 131,961 |
| `docs/native-wallet.js` (on demand) | 964,873 | 355,216 |

HTML + ethers total **897,651 raw bytes**, about **368,661 bytes using this local gzip estimate**. Actual Pages compression/cache behavior was not measured; these are not network-transfer or load-time results. Locally embedded fonts avoid external font requests but contribute to the HTML payload. Existing local assets and lazy SDK loading are useful reliability decisions. Avoid loading native code just to display a read-only label or starting simulation during page load. Profile cold simulation startup and LCP/INP/CLS before proposing code splitting or font changes.

## 9. Top five improvements and minimal Phase 4B scope

In impact order:

1. **Make policy information truthful.** Fix F1's display eligibility and distinguish one-payment size from fixed-window headroom; correct freeze/gas/owner-exception language. This protects technical credibility during the actual freeze demonstration.
2. **Connect the existing demo steps.** A compact simulation-only route from payment result → exact held request → owner approval → freeze, with keyboard focus and clear local-simulation labels. Reuse confirmed request IDs and existing controls; no new transaction path.
3. **Keep real MCP evidence reachable.** Add a compact dated proof entry during simulation, linking the October 23 section and event export, with paid/held/owner-approved roles explicit. Use the existing record, not a fake live Claude chat or fabricated transaction feed.
4. **Unify current jury facts and links.** Update README/JUDGING/current-status copy and provide one clear two-minute entry; link completed security reports, correct 58/37/24 counts and distinguish current functionality from dated check-in/video/deck. Point the header documentation link to that curated entry.
5. **Make native inspection a clearly secondary technical option.** Preserve read-only labeling/guards while reducing its competition with the wallet-free journey, particularly on mobile. Validate responsive/focus/performance impact rather than redesigning the panel or adding signed writes.

**Proposed implementation boundary:** localized copy/navigation changes in `web/index.src.html`, the existing policy field's display calculation in `web/policy-field.js` / narrowly scoped helper, minimal existing CSS if navigation hierarchy requires it, corresponding frontend regression assertions, and targeted README/JUDGING/architecture/PROOF clarifications. Add a current final-journey section or small document, not a new application framework. Regenerate the necessary Pages HTML with the existing build, verifying ABI, simulation bytecode/bundle and deployment settings remain unchanged. Do not regenerate the native SDK unless its source actually changes. This is proposed future scope, not work performed here.

Keep older check-in reports, captures and the current PDF as dated history; a new final deck/video can be a separate editorial task after the corrected flow passes. Do not add token support, owner-transfer UI, native signing, mapping, gas sponsorship, analytics, new dependencies, CI work or a new dashboard information architecture to this scope.

## 10. Tests run and Phase 4B acceptance criteria

### Actually run in Phase 4A

| Check | Command / actual result |
|---|---|
| Baseline | `git fetch origin main`; exact requested commit matched; baseline tree equals Phase 3B-2 feature tree |
| Contract count and behavior | `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x4a -vv`: **58 passed, 0 failed/skipped**, four suites, including 1,000-run fuzz and stateful invariants |
| MCP count and behavior | `ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp`: **37 passed, 0 failed/skipped**, local Anvil only |
| Native read-only count | `npm test --prefix substrate`: **24 passed, 0 failed/skipped** |
| F1 display reproduction | Extract current `spendNow(left, a)` declaration → Node `vm.runInNewContext`; active/frozen/expired mocked inputs all returned **4 POT** as documented above |
| Event/document cross-check | Python JSON inspection of `evidence/onchain.json`: 21 events / 14 event-bearing hashes, matching the selected October 23 rows and account/recipient/amount/request ID; capture timestamp and contract/network checked |
| Linked evidence | Actual Pages GET, explorer/video HEAD and configured EVM `eth_chainId` attempt: all proxy CONNECT 403, curl exit 56; no live verification |
| Deck and historical images | `pdftotext -layout docs/Allowance-pitch-deck.pdf`; extracted page 6 counts and page 10 roadmap; visually inspected the three dated images identified above |
| Report consistency | Markdown local-link/whitespace checks and report-only tracked diff; no generated or implementation files changed |

No browser suite, live wallet test, new accessibility scan, frontend rebuild or performance audit was run in Phase 4A. The existing five browser-suite passes and native axe results are prior evidence, not fresh test claims. Current Foundry/MCP success does not imply that F1 or the jury journey is covered.

### Required acceptance before considering Phase 4B complete

- **Truthful display:** meaningful regressions for active/frozen/expired accounts, exhausted period, insufficient budget, per-payment cap below total headroom and snapshot/RPC failure. With budget 19, headroom 4 and cap 1: label aggregate 4 separately from max single payment 1; frozen/expired current spendability is zero. Use chain time for expiry. Blocked UI status, numeric labels and action availability must agree; unavailable data is never a zero balance.
- **Lifecycle:** fresh deterministic demo still starts at 19 budget / 4 headroom / two held requests. Trusted 0.1 payment → 18.9 / 3.9. A new 2.5 request changes neither amount; approve the **new exact request ID** → 16.4 / 3.9. Freeze blocks new agent operations; owner approval of an existing held request remains separately possible under contract rules. No new automatic approval/payment/retry behavior.
- **Two-minute comprehension:** rehearse with unfamiliar reviewers at desktop and 390px. Target correct explanation plus automatic payment, held request, matched owner approval, freeze and historical proof within **120 seconds**, without wallet installation or public RPC. This is a proposed gate, not a result already measured. Never hide safety exceptions just to meet it.
- **Mode clarity:** illustrations stay marked examples; all local results/hashes remain simulation-labeled; real proof stays dated October 23; any new mocked screenshot visibly says MOCKED. Native remains read-only and cannot mutate EVM/simulation identity or trigger deployment/transactions. Key-containing MCP configuration stays out of screenshots.
- **Regression suites:** rerun 58 Foundry, 37 MCP and 24 native unit tests; run all five existing browser scripts (`ui-smoke`, `wallet-smoke`, `policy-field-smoke`, `checkin-smoke`, `native-wallet-smoke`) plus targeted new frontend assertions. Preserve existing EVM owner controls and wallet-free behavior. Record real counts/results and baseline-dated facts; do not imply every suite runs in CI today.
- **Responsive/accessibility:** capture current 320/390/768/1440px landing and critical lifecycle states; no horizontal overflow, clipped controls or focus traps. Keyboard-only flow, Escape/focus restoration, 200% zoom, reduced motion and WCAG A/AA scans across landing/demo/native states. Do not equate axe zero with full accessibility compliance.
- **Performance/evidence:** profile cold-load and simulation-ready times with device/network conditions recorded; retain local-only initial assets and lazy simulation/native bundles. Compare actual served asset hashes to the built release when Pages becomes accessible. Verify existing proof links and bounded read-only RPC/event queries; if blocked, state the blocker and retain dated repository fallback evidence.
- **Scope:** review `git diff`, whitespace and generated asset changes. No Solidity, ABI, MCP, transaction submission, address/network/deployment or dependency changes. Phase 4B requires its own implementation authorization.

## 11. Risks, non-goals and decision

Main risks are overclaiming from a polished local demo, a positive “spend now” figure during a freeze, hiding the strongest recorded proof on entry to simulation, and implying native-owner readiness from a public mapping. Old test totals and scanner-pending copy then compound the trust problem. Correct these before adding visual complexity.

Remaining limitations: live Pages/RPC/video/explorer accessibility, fresh mobile/screen-reader/performance behavior, real native extension compatibility, MCP-session authorship beyond project records, service fulfillment and market traction were not independently verified. Static analysis and local tests do not certify security. Unsupported token economics, owner trust, fixed-window bursts, wallet funds and expensive retained requests remain documented product boundaries, not issues to conceal in jury copy.

**CONDITIONAL GO for the minimal Phase 4B plan**, centered on truthful state, guided existing actions and clearly classified evidence. **NO-GO for a final readiness claim based solely on this source/historical audit**, or for native signed-wallet, mainnet, independent-audit or universal-token claims. Unblock the authorized live hosts and browser surface for release verification; no bypass is proposed. The dark policy-field direction should stay intact unless fresh measured evidence justifies a specific change.
