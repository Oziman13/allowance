# Phase 3B-2 — native wallet validation and readiness gates

Date: 2026-10-28. **Internal validation, not an independent audit. No native signed-write implementation.**

**Recommendation: NO-GO for a native signed-write proof of concept until live access, a real authorized wallet, current runtime compatibility and execution requirements are verified.** Local read-only failure handling passes the checks below. That evidence does not establish live wallet or runtime compatibility.

## Baseline and scope

- Repository: `Oziman13/allowance` only.
- Fetched `origin/main`: **`6ef252f0606041a32c9040dbd2fdc66baa8537e8`**, exactly the requested baseline.
- Feature branch: **`codex/allowance-native-wallet-validation-phase3b2`**, created from that commit without modifying local `main`.
- Baseline tree: `9df7246405bed4ac95c05242109bb1fe51f28b40`, identical to the reviewed Phase 3B-1 feature tree. Reviewed the [Phase 3A](NATIVE-WALLET-FEASIBILITY-PHASE3A.md) and [Phase 3B-1](NATIVE-WALLET-READONLY-PHASE3B1.md) reports, native controller/renderer/runtime, wallet entry wiring, build and network configuration.
- Only two reproduced read-only defects were fixed. No dependency or lockfile changes, unrelated UI changes, native write controls, contract, ABI, CI or deployment changes.

## Published website: access blocked, not verified

The actual requested URL was attempted directly through the enforced environment proxy:

```sh
curl --max-time 20 --silent --show-error --dump-header /tmp/headers \
  --output /tmp/body --write-out '%{http_code}' https://oziman13.github.io/allowance/
```

The capture used a fresh temporary directory for each request. Actual response at **09:08:13 UTC**: proxy **`HTTP/1.1 403 Forbidden`**, `server: envoy`; curl exit **56**, `CONNECT tunnel failed, response 403`. Curl's target HTTP status was **000** because the CONNECT tunnel failed. No target document/body was obtained. This is an environment policy blocker, not evidence of a GitHub Pages application error or outage.

[Raw access evidence](native-wallet-validation/phase3b2/access.json) retains all three URLs, UTC times, exact RPC request bodies, proxy headers, stderr and exit/status codes. The current managed policy is restricted/enforced, with no Pages/Portaldot host rules, no outbound identities, no configured VPN and no direct TCP grants. No policy bypass, third-party RPC, alternate proxy or VPN was used. A connected-browser automation surface was not exposed; no real browser session or wallet permission was available for inspection. This does not establish whether the user's own browser has an extension installed.

| Requested check | Actual live result | Separate local evidence |
|---|---|---|
| Deployed asset versions | **Unverified**: Pages document could not be downloaded | Six baseline generated/vendor assets reproduce byte-for-byte from current source/build; SHA-256 evidence below |
| Native panel visibility / lazy loading | **Unverified live** | Production local bundle loads on panel open; no native SDK or account permission request on page load |
| Missing assets / console errors | **Unverified live** | Clean local native panel has no missing same-origin assets or console errors; existing fresh-session browser suite also passes |
| MetaMask entry point | **Unverified live** | Existing EIP-6963/EIP-1193 regressions pass; exact signer/provider/account objects survive native use |
| Simulation entry point | **Unverified live** | Fresh local simulation journeys and owner actions pass |
| Responsive, keyboard and read-only limitations | **Unverified live** | Four viewport widths, Escape/focus restoration, read-only labels and absent native write controls pass locally |

Forced HTTP/network failures in the local native browser tests intentionally produce browser/SDK diagnostic console messages; these are not characterized as a clean console session. They do not produce uncaught application errors. The clean-console assertion runs on the normal local panel with no injected extension/RPC failure.

## Asset consistency

[Asset consistency evidence](native-wallet-validation/phase3b2/asset-consistency.json) records baseline and feature SHA-256 values for:

```text
docs/index.html
docs/native-wallet.js
docs/sim.js
docs/abi.json
docs/vendor/ethers-6.13.4.umd.min.js
docs/vendor/native-wallet-LICENSES.txt
```

Before fixes, `forge build` and `python3 build.py` reproduced **all six committed baseline files exactly**. After the adapter fixes, only `docs/native-wallet.js` differs. A further build reproduced the feature files exactly. The local server's served HTML/native/simulation bytes were checked against the working build before accepting its browser evidence. The local origin was **`http://127.0.0.1:8001`**, not GitHub Pages. None of these hash comparisons attests the live deployment's assets.

## Portaldot RPC and real wallet results

Only the configured RPC hosts were attempted. HTTPS for Substrate is derived from the configured `wss://test-node-v3.portaldot.dev`, as in the existing native reader and repository guidance.

```sh
curl --max-time 20 --silent --show-error --dump-header /tmp/headers \
  --output /tmp/body --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[0]}' \
  https://test-node-v3.portaldot.dev

curl --max-time 20 --silent --show-error --dump-header /tmp/headers \
  --output /tmp/body --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://test-evm-rpc-v3.portaldot.dev
```

Both returned the same **proxy CONNECT 403 / curl exit 56 / target status 000** as Pages. The capture supplied the equivalent JSON payload through stdin with `--data-binary @-`. There was no RPC response and no reason to issue dependent queries through the denied hosts. The configured WebSocket transport was not separately verified after the host-policy denials.

| Evidence sought | Current result |
|---|---|
| Genesis / chain identity | No fresh RPC evidence; the expected genesis remains a historical repository pin, not a live observation |
| Runtime spec / transaction versions | Unverified; no current version is asserted |
| Metadata and Revive API signatures/availability | Unverified on Portaldot; no real metadata captured or compared to the SDK |
| Finalized native/EVM blocks | Unverified live |
| Code at configured contract | Unverified live; deployed address/configuration unchanged |
| Wallet-selected AccountId32 → H160 | No real authorized extension or selected account; no live identity resolution |
| Reverse mapping and stored owner matches | No live results; unavailable is not reported as unmapped, empty ownership or zero budget |
| Real extension discovery / permission handling | **Unverified**; no connected real wallet session was available. Headless tests inject clearly mocked accounts |
| Native signed-write compatibility | **Unverified and not exercised** |

No wallet secrets were requested/imported, and no real owner keys were generated or used. No real extension permission prompt, signer invocation, native extrinsic construction, mapping, deployment or public-chain transaction occurred. Required automated contract/MCP/simulation tests use only their local test accounts and chains.

## Runtime assumptions reviewed

The application continues to use the existing pinned **`@polkadot/api` 16.5.6**, **`@polkadot/util-crypto` 14.0.3**, ethers **6.13.4** and esbuild **0.28.2**. No installation or package changes were needed in this phase.

The native path reads a finalized hash, explicitly queries the complete runtime version, obtains snapshot metadata and rejects a spec-name/version mismatch. It checks metadata/read API availability before invoking `reviveApi.address(accountId32)` and `revive.originalAccount(h160)`. It inspects advertised dispatch variants without accessing `api.tx`. The native runtime dry-run method is not invoked. Missing custom APIs fail closed; no local H160 derivation or guessed runtime signature is substituted.

The real SDK's initialization through the read-only RPC provider is exercised using its **official generic v15 Substrate metadata fixture**. This correctly reaches the unsupported-Revive-identity-API result. The fixture is neither Portaldot metadata nor a live runtime compatibility proof. Mocked Option/address results test the selected AccountId32/H160 equality rules separately.

EVM owner reads require the configured chain ID, a finalized block, nonempty code, ABI-decoded `accountsOfOwner`/`getAccount` results and exact stored-owner equality for each displayed allowance. Both code-only and owner reads now recheck the EVM block hash. Native and EVM snapshots remain separate, and RPC truth is trusted: neither a stable hash nor matching public state proves key possession, honest RPC data or signed-write compatibility.

## Reproduced defects and minimal fixes

The new tests were run **before changing the production adapter**: **24 total, 21 passed, 3 failed**. The three failures reproduce two defect categories; [raw pre-fix output](native-wallet-validation/phase3b2/tests-native-before-fixes.txt) is retained.

1. **Nullable rejection crashes the error handler.** At baseline `substrate/browser/controller.mjs:66–67` and `:107`, accessing `e.code` throws when an extension or inspection promise rejects with `null`/`undefined`. Account authorization escapes as an unhandled TypeError; an inspection failure can leave the panel in its checking state. Two tests reproduced this independently. The [controller](../substrate/browser/controller.mjs#L66) now uses optional access for error classification, producing `authorization-failed` or `rpc-unavailable`, clearing snapshots and preserving retry/disconnect controls. A production-bundle browser test also covers a null wallet rejection. No successful-result behavior changed.
2. **Code-only path skips snapshot consistency check.** Baseline `substrate/browser/runtime.mjs:72` returned deployed-code data before the final block-hash check when `checkOwner` was false (unmapped/conflicting/fallback identities). A mock RPC changing that finalized block's hash still produced a code-present result. The [runtime reader](../substrate/browser/runtime.mjs#L72) now shares the existing hash check between code-only and owner reads. Changed/missing final hashes are rejected; no latest-block fallback, loop or ownership inference was added. This is a reproduced read-consistency gap under an inconsistent/reorganized RPC response, not evidence that Portaldot finalized blocks actually reorganize.

The updated `docs/native-wallet.js` is generated from those fixes. No new on-chain vulnerability was confirmed; there was no live runtime access with which to assess one.

## Regression commands and results

Tool versions: Node **24.19.0**; Forge **1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`); solc **0.8.28+commit.7893614a**; Chromium **154.0.8037.57**; existing isolated Playwright **1.56.1** / axe Playwright **4.10.2** in `/tmp/allowance-native-browser`.

| Command | Actual final result / evidence |
|---|---|
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x3b2 -vv` | **58 passed / 0 failed / 0 skipped**, four suites including 1,000-run fuzz and stateful invariants; [raw output](native-wallet-validation/phase3b2/tests-foundry.txt) |
| `ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp` | **37 passed / 0 failed / 0 skipped**; [raw output](native-wallet-validation/phase3b2/tests-mcp.txt) |
| `npm test --prefix substrate` | **24 passed / 0 failed / 0 skipped** (17 existing plus 7 new); [raw output](native-wallet-validation/phase3b2/tests-native.txt) |
| `NODE_PATH=/tmp/allowance-native-browser/node_modules node script/ui-smoke.cjs` | Pass, exit 0 |
| Same prefix, `node script/wallet-smoke.cjs` | Pass, exit 0 |
| Same prefix, `node script/policy-field-smoke.cjs` | Pass, exit 0 |
| Same prefix, `node script/checkin-smoke.cjs` | Pass, exit 0 |
| `NODE_PATH=/tmp/allowance-native-browser/node_modules UI_EVIDENCE_DIR=docs/native-wallet-validation/phase3b2 node script/native-wallet-smoke.cjs` | Pass, exit 0; actual local bundle for authorization/transport failures, visibly mocked inspector for positive mapping UI |
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes` | Pass, exit 0; existing lint warnings retained |
| `python3 build.py` | Pass, exit 0; baseline and feature output reproducibility checked separately |
| Python AST parse of `build.py`; `node --check` on native modules/browser script | Pass |
| `git diff --check` / staged additions / final commit diff | Pass |
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check` | **Fails, exit 1**, on pre-existing formatting in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. No formatting changes applied to restricted/unrelated files |

All **5 browser scripts passed / 0 failed**; [combined exact commands and raw output](native-wallet-validation/phase3b2/tests-browser.txt). These scripts are assertions-based smoke programs, not a runner exposing a unit-test count; their PASS groups must not be presented as independent live tests.

Coverage includes HTTP **403/503**, unavailable transport, malformed JSON/envelopes/addresses/Option/block/code/ABI data, timeout, missing Revive API, wrong genesis/runtime/EVM chain, unmapped/conflicting/fallback identities, stored-owner mismatch, valid empty lists, changed finalized snapshots, disconnect/account/extension switch during pending reads, late responses/authorization, Error/null permission rejection and native isolation from MetaMask/simulation. Timeout is tested deterministically using a short controller deadline; browser HTTP failures use mocked transport responses. No public RPC request is made by those mocks.

The no-write checks reject transaction/signing methods before fetch, make signer/provider/`api.tx` accessors throw, record submission requests in browser transport interception and assert only read-only native controls exist. Existing MetaMask owner operations and simulation behavior are preserved; the native controller never receives or mutates their state.

Responsive checks pass at **320, 390, 768 and 1440px**, including long addresses and reduced motion. Native-panel axe scans at desktop and 320px yield **2 scans / 0 violations** for WCAG 2 A/AA and 2.1 AA. Escape closes the modal and restores trigger focus. This is automated evidence, not a full assistive-technology review.

Fresh screenshots visibly say **MOCKED RUNTIME**, use public fixture addresses and provide **no live-chain evidence**:

- [1440px desktop](native-wallet-validation/phase3b2/native-mocked-verified-1440.png)
- [768px tablet](native-wallet-validation/phase3b2/native-mocked-verified-768.png)
- [390px mobile](native-wallet-validation/phase3b2/native-mocked-verified-390.png)
- [320px mobile](native-wallet-validation/phase3b2/native-mocked-verified-320.png)

## Exact changed-file manifest

```text
docs/NATIVE-WALLET-VALIDATION-PHASE3B2.md
docs/native-wallet-validation/phase3b2/access.json
docs/native-wallet-validation/phase3b2/asset-consistency.json
docs/native-wallet-validation/phase3b2/native-mocked-verified-1440.png
docs/native-wallet-validation/phase3b2/native-mocked-verified-320.png
docs/native-wallet-validation/phase3b2/native-mocked-verified-390.png
docs/native-wallet-validation/phase3b2/native-mocked-verified-768.png
docs/native-wallet-validation/phase3b2/tests-browser.txt
docs/native-wallet-validation/phase3b2/tests-foundry.txt
docs/native-wallet-validation/phase3b2/tests-mcp.txt
docs/native-wallet-validation/phase3b2/tests-native-before-fixes.txt
docs/native-wallet-validation/phase3b2/tests-native.txt
docs/native-wallet.js
script/native-wallet-smoke.cjs
substrate/browser/controller.mjs
substrate/browser/native.test.mjs
substrate/browser/runtime.mjs
```

Production Solidity, contract tests, ABIs, addresses/network configuration, deployment scripts, CI, MCP implementation, dashboard source/renderer/layout, simulation source/bundle, license output and dependency manifests/lockfiles are unchanged. The feature branch contains only this scoped diff. Existing untracked `lib/` and scratch `work/` remain excluded. No PR, merge, deployment or real wallet transaction is part of this work.

## Remaining gates and next action

**NO-GO now for a signed-write proof of concept**, including mapping. No claim that the existing deployment is live-compatible with a native signer can be made from these results. It remains a possible reuse target, conditional on origin-to-stored-owner equality and actual runtime support; no contract change is justified by this validation.

The next action is to allow the **existing configured hosts** through the supported environment policy workflow and provide an already-authorized real native browser wallet session for **read-only** verification. Re-run the live asset comparison, CORS checks, current finalized genesis/metadata/version/code reads and deliberately selected public-account mapping/owner checks. Do not weaken the checks or use another RPC to obtain a positive result.

Only after that evidence is available should a separately authorized proof-of-concept plan verify wallet payload compatibility, current `revive.call`/`mapAccount` signatures, value/weight/storage-deposit units, fee and minimum-balance requirements, mapping cost/exemptions and runtime upgrades. It must distinguish requested signature, signed payload, known broadcast hash, inclusion, finalization, dispatch success and actual contract execution/revert/events. Match exact contract/account/recipient/amount as applicable and preserve uncertain transaction hashes without automatic payment/approval retries. No real signing or broadcast is authorized by this report.
