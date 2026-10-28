# Phase 3B-1 — read-only native wallet dashboard

Date: 2026-10-28. Base: `e763294e7f14990987ae5f98ceda7c072ca66e9f`, fetched and verified against `origin/main`. Branch: `codex/allowance-native-wallet-readonly-phase3b1`.

**Implemented: native extension account sharing and a separate read-only identity inspector. No native signing, extrinsic construction, broadcast or account mapping.** This is internal engineering validation, not an independent audit. [SECURITY.md](../SECURITY.md) and the [Phase 3A feasibility boundaries](NATIVE-WALLET-FEASIBILITY-PHASE3A.md) still apply. This report accompanies the feature commit; the base SHA above identifies its starting source.

## Architecture and operation

The header's **Native wallet · Read-only** button opens an accessible modal and lazily loads the local `native-wallet.js` bundle. Opening the panel discovers extension names without asking for account permission. Only **Connect native accounts** invokes the selected extension's `enable()` authorization. No native identity or connection permission is persisted by the application.

The accounts adapter uses the supported `window.injectedWeb3[source].enable(appName)` → `accounts.get()` / `accounts.subscribe(callback)` protocol. It never accesses the returned `signer` or wallet `provider`. Extensions without an accounts subscription and unsubscribe function are unsupported, even if they offer signing. A signer is unnecessary for these reads. This is protocol support, not a claim that a particular Portaldot wallet brand has been tested in person.

Every account must decode to exactly 32 bytes. SS58 format 42 is an encoding of those bytes, not proof of chain membership or H160 control. Ethereum-style 20-byte accounts and unsupported key types are rejected. An extension-supplied nonempty genesis restriction must match the expected genesis. The adapter conservatively rejects a shared list containing an unsupported or wrong-chain account; users can restrict shared accounts in the extension. Multiple authorized identities always require selection. A single authorized identity is inspected automatically after explicit authorization.

Subscriptions are installed before the initial account read; a newer subscription beats a late initial response. Any account update, account/extension selection change, disconnect, close/Escape or switch to an existing EVM/simulation entry point invalidates native results and aborts outstanding reads. A generation counter discards late responses and late permission results. Closing through the panel button invalidates synchronously. Disconnect removes the account subscription; revoking the extension's retained site permission must be done in the extension itself.

The native controller and renderer do not receive or mutate `S`, `S.me`, the ethers signer/provider, simulation state, existing owner forms or the EVM transaction/deployment helpers. The modal makes background actions inert. Native errors have no deployment fallback. Existing MetaMask and simulation controls retain their original behavior after the panel closes.

## Verification flow and evidence boundaries

1. Use the selected account's decoded bytes, never a pasted H160 or locally inferred address.
2. Initialize the existing pinned `ApiPromise` SDK over an HTTP snapshot provider. HTTPS is derived from `config/networks.json`'s `substrateWs` host (`wss:` → `https:`); the EVM endpoint and contract also come from that configuration. No addresses, chain IDs or deployment settings changed.
3. Read the finalized native head, then the complete runtime version at that hash. `ApiDecoration.runtimeVersion` can be a partial type without `transactionVersion`; it is not used as the source of that field. Obtain snapshot metadata with `api.at(hash, version)` and reject a metadata/version mismatch across an upgrade.
4. Require genesis `0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd` and runtime name `portaldot-v3`. This expected genesis comes from the repository's historical October 25 observation, not a fresh live observation. Display observed spec and transaction versions, without assuming they remain 3002 or any other value.
5. Inspect snapshot metadata for `Revive` call variants `map_account` and `call`, and check availability of `reviveApi.address`, `reviveApi.call` and `revive.originalAccount`. Dispatch capabilities are **advertised**, not tested. No `api.tx` property is accessed or extrinsic constructed. Required read APIs missing from metadata/SDK produce **unsupported API**; no manually invented runtime signature or H160 derivation is substituted. This phase does not invoke the dry-run call either.
6. Resolve the H160 through `at.call.reviveApi.address(accountId32)`. Query `at.query.revive.originalAccount(h160)` at the same finalized hash. Validate address lengths and the Option response.
7. Independently check the configured EVM endpoint's chain ID, a `finalized` block and nonempty deployed code at the configured Allowance address. These deployment reads also run for unmapped/conflicting accounts, without requesting owner data. Missing `finalized` support fails closed; there is no fallback to `latest`.
8. Only with an exact reverse mapping, ABI-encode read-only `accountsOfOwner(h160)` and `getAccount(id)` calls against the configured contract at the fixed EVM block number. Require **each displayed account's stored owner** to equal the resolved H160. Reject the entire list on mismatch. Recheck the EVM block hash after the owner reads. A successful empty list is distinguished from unavailable data. At most 30 accounts are loaded; a larger total is labeled as truncated.
9. The UI displays mapping, network versions, native block hash, contract/code status, EVM block number and verified stored-owner matches. It labels budgets as **recorded budget**. Native POT uses the existing EVM 18-decimal convention; token budgets display raw units because decimals and transfer economics are not guessed. There is no claim about spendable capacity, collateral backing or wallet gas balance. Account names and extension data render via `textContent`.

| Result | Meaning / presentation |
|---|---|
| Confirmed mapping | Reverse entry equals the wallet-selected AccountId32 bytes. Stored owner reads can proceed; this does not prove possession of a native signing key. |
| Unmapped | Successful Option::None for an ordinary account. No mapping is performed; no owner list is accepted. |
| Conflicting | Reverse entry contains different bytes. Identity must not be treated as an owner. |
| Unverified fallback shape | H160 followed by twelve `0xEE` bytes, with no reverse entry. No native signing control or mapping exemption is inferred. |
| Unsupported API | Required read API, account protocol or compatible snapshot metadata is missing. |
| Wrong network | Genesis/runtime name or EVM chain ID does not match. |
| RPC unavailable / timeout | Ownership and budget unavailable, never “unmapped”, empty ownership or zero balance. If native mapping completed before an EVM failure, that mapping remains separately labeled while ownership is unavailable. |
| Ownership conflict | At least one returned allowance's stored owner differs from the runtime-resolved H160. No verified list is displayed. |

Reads have a 20-second overall deadline and cancellation. There is no application retry loop. Both transports use a positive JSON-RPC method allowlist: Substrate initialization/metadata/storage/state calls and EVM chain/block/code/`eth_call` reads only. `author_*` submissions, Ethereum transaction submission and signing requests are rejected before fetch. Requests omit browser credentials and reject redirects. SDK internals contain generic transaction code, but no application path exposes or invokes it; the read provider adds a separate network boundary.

These are RPC observations, not cryptographic proofs. The two configured RPC endpoints are trusted to represent the same chain; chain-ID and genesis checks do not establish that cryptographically. Substrate and EVM finalized snapshots may be different heights/times and can become stale. Code presence does not attest bytecode equivalence to the repository. A matching reverse entry and stored owner are public state, not a signature or evidence of supported signed writes; watch-only accounts are not certified as signable. Never treat a fallback SS58 representation of a MetaMask account as an interchangeable owner key.

## Dependencies, provenance and build

- Reuse existing **`@polkadot/api` 16.5.6** and its locked dependency graph; do not introduce another wallet SDK. Dynamic runtime metadata avoids guessing custom runtime parameter types.
- Declare **`@polkadot/util-crypto` 14.0.3** directly for SS58 decoding/encoding. It was already present at exactly this version in `substrate/package-lock.json`; the lock change adds only the root declaration. No new package version or transitive dependency was added. No extension package is installed into the project.
- Reviewed the official npm registry metadata and integrity-checked `@polkadot/extension-inject` **0.64.1** tarball's `types.d.ts` (`InjectedWindowProvider`, `InjectedAccounts`, `InjectedAccount`). Registry repository attribution: `polkadot-js/extension`, `packages/extension-inject`; archive SRI: `sha512-kbkkLkGStH7n6rF4OCwKdwYoIpBIGPBIjNXYYPtTP4q5DOXVJeBz0nisPcjCNF4oBYHkt4AivGJfPf8eem+alA==`.
- Substrate packages are installed from the official npm registry using the existing lockfile/SRI. No wallet code is downloaded at dashboard runtime. `ethers` remains the existing local 6.13.4 vendor asset.
- `build.py` reuses existing **esbuild 0.28.2** from `web/sim`. The native IIFE is about **943 KiB uncompressed / 347 KiB gzip**; it is deliberately lazy and includes the metadata/type-registry machinery rather than a hand-built runtime codec. There is no native SDK request on page load. Generated third-party license notices are in `docs/vendor/native-wallet-LICENSES.txt`. No caches, node_modules or tool binaries are committed.
- Rebuild with `npm ci --ignore-scripts --prefix substrate`, `npm ci --ignore-scripts --prefix web/sim`, the existing Foundry build, then `python3 build.py`. As with the simulation asset, a build without installed native build dependencies keeps the committed native bundle and prints that fact; install both packages to regenerate after source changes. No existing build/CI configuration is changed beyond this frontend build step.

Pinned browser test tools **Playwright 1.56.1** and **@axe-core/playwright 4.10.2** were installed in `/tmp/allowance-native-browser` from npm with scripts disabled. They are test tooling outside the repository, not new project dependencies. Chromium is `/usr/bin/chromium`. Node: 24.19.0.

## Live checks and unverified conditions

The authorized read-only request was:

```sh
curl --max-time 15 -sS -i -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[0]}' \
  https://test-node-v3.portaldot.dev
```

Actual result: proxy **`HTTP/1.1 403 Forbidden`**, `server: envoy`; curl exit 56, `CONNECT tunnel failed, response 403`. The managed network policy lacks a Portaldot host rule. No bypass, alternate endpoint, signing, broadcast or public-chain transaction was attempted. This does not establish that the testnet is down.

**No fresh live genesis, runtime version, metadata, mapping, contract code, balances or owned allowance list was verified.** Browser CORS, current runtime API support (especially metadata exposing `ReviveApi.address`), EVM `finalized` support and a real extension's authorization behavior remain unverified in this environment. Historical proofs and generic SDK metadata fixtures are not native signed-write evidence.

## Tests and actual results

Commands ran from the repository root. Session tool paths below identify the actual installed binaries; use equivalent installed Foundry/solc tools elsewhere.

| Command | Actual result |
|---|---|
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x3b1 -vv` | **58 passed**, 0 failed/skipped across four suites; includes 1,000-run fuzz and the stateful invariant suite. |
| `ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp` | **37 passed**, 0 failed/skipped; local Anvil only. |
| `npm test --prefix substrate` | **17 passed**, 0 failed/skipped, using `node:test` in a single explicit test file/process. |
| `python3 build.py` | Pass: frontend/simulation/native bundles and SDK license notices generated. Existing ABI and simulation bundle unchanged. |
| `NODE_PATH=/tmp/allowance-native-browser/node_modules node script/ui-smoke.cjs` | Pass: wallet absent/rejected, simulation owner approvals/rejection/trust/payment/freeze/reset/rules/fund/withdraw, safe token metadata, responsive layout. |
| Same prefix, `node script/wallet-smoke.cjs` | Pass: EIP-6963 multi-wallet selection, remembered-wallet reconnect, chain switch/add, mobile guidance, simulation low-budget display. |
| Same prefix, `node script/policy-field-smoke.cjs` | Pass: policy selection, verified contract fields, payment lifecycle, freeze/expiry/budget failures, agent isolation and unknown transport state. |
| Same prefix, `node script/checkin-smoke.cjs` | Pass: fresh desktop/mobile simulation journeys, keyboard focus, offline assets, no missing assets/console errors. |
| `NODE_PATH=/tmp/allowance-native-browser/node_modules UI_EVIDENCE_DIR=docs/ui-evidence/native-wallet-phase3b1 node script/native-wallet-smoke.cjs` | Pass: actual production-bundle failure paths plus mocked positive panel workflows; no native signing/provider access, public-chain submission requests or uncaught browser errors. |
| `/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes` | Pass; existing lint warnings remain. Production contract runtime size 9,757 bytes. |
| Same forge binary, `forge fmt --check` | **Fails on pre-existing formatting** in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. These files equal the base commit; no unrelated formatting applied. |
| `git diff --check` (including staged additions) | Pass. |

Native unit coverage includes unavailable/rejected wallets, unsupported accounts protocol/types, multiple accounts and switches, late authorization/initial-read/subscription/RPC results, deadline cancellation, SS58 bytes, wrong genesis/runtime, absent/conflicting/fallback mapping, required API absence, reverse-query failure, partial runtime version and upgrade mismatch, exact stored-owner checks, wrong EVM chain/code/reorganized snapshots, valid empty owner list, and RPC submission/signing rejection before fetch. Signer/provider and transaction accessors deliberately throw if touched. An additional test initializes the **real pinned SDK** through the production read provider with its official generic v15 Substrate metadata fixture, then correctly rejects missing Revive identity APIs. That fixture is not Portaldot metadata.

Browser validation uses the production lazy bundle for absent/rejected/unsupported extension and HTTP-503 runtime failures. Positive/failure-state presentation tests bundle the real controller, SS58 normalizer and renderer with a mocked inspector through Playwright route interception. That fixture is never shipped to `docs/`. Runtime/owner verification itself is tested separately with deterministic codec/RPC responses. Injected native and EIP-1193 wallets are mocks; no real wallet or live signed owner action was claimed. The new tests preserve the exact existing MetaMask-style signer/provider/account objects and simulation identity, clear state on extension/EVM changes, and discard post-close results.

Responsive checks cover widths **1440, 768, 390 and 320**, long identity strings, no horizontal overflow and reduced-motion preference. Axe WCAG 2 A/AA and 2.1 AA checks report **zero violations** in the native panel at desktop and 320px; keyboard Escape closes and restores focus to the trigger. This is automated accessibility evidence, not a full assistive-technology audit.

Screenshots are explicitly titled **MOCKED RUNTIME** and state that they provide no live-chain evidence:

- [Desktop, 1440px](ui-evidence/native-wallet-phase3b1/native-mocked-verified-1440.png)
- [Tablet, 768px](ui-evidence/native-wallet-phase3b1/native-mocked-verified-768.png)
- [Mobile, 390px](ui-evidence/native-wallet-phase3b1/native-mocked-verified-390.png)
- [Narrow mobile, 320px](ui-evidence/native-wallet-phase3b1/native-mocked-verified-320.png)

## Exact changed files

```text
build.py
docs/NATIVE-WALLET-READONLY-PHASE3B1.md
docs/index.html
docs/native-wallet.js
docs/ui-evidence/native-wallet-phase3b1/native-mocked-verified-1440.png
docs/ui-evidence/native-wallet-phase3b1/native-mocked-verified-320.png
docs/ui-evidence/native-wallet-phase3b1/native-mocked-verified-390.png
docs/ui-evidence/native-wallet-phase3b1/native-mocked-verified-768.png
docs/vendor/native-wallet-LICENSES.txt
script/native-wallet-smoke.cjs
substrate/browser/controller.mjs
substrate/browser/entry.mjs
substrate/browser/native.test.mjs
substrate/browser/panel.mjs
substrate/browser/runtime.mjs
substrate/package-lock.json
substrate/package.json
web/index.src.html
web/native-wallet.css
```

Production Solidity, ABI files, MCP implementation, contract tests, existing browser test files, simulation implementation/bundle, CI, network IDs/addresses and deployment configuration remain unchanged. Only the feature branch is published; `main` is not modified or merged. Pre-existing untracked local `lib/` and scratch `work/` are excluded.

## Phase 3B-2 recommendation and gates

**CONDITIONAL GO for a separately scoped next phase; NO-GO for enabling native writes now.** The existing deployment remains a candidate for reuse for accounts whose real native origin resolves to the stored owner; this implementation proves neither live identity compatibility nor signed execution. No Solidity change is indicated by this read-only work.

First unblock permitted RPC access and run this panel with a real extension and deliberately selected public test account. Capture current finalized genesis/versions/metadata, mapping and owner reads, and verify browser CORS / `finalized` support. Do not silently relax those checks to obtain a positive state.

Before any separately authorized testnet write implementation, verify current dispatch signatures, AccountId32/H160 ownership boundaries, native value-unit conversion versus EVM POT, weight/storage/deposit/fee estimation, minimum balances and mapping costs. Confirm actual wallet payload support and runtime upgrade handling. Specify transaction states (signature requested, signed, broadcast/hash known, included, finalized, contract executed), exact relevant event matching, dispatch/revert decoding and recovery with preserved hashes. Never automatically retry an uncertain payment or approval. A dry run, inclusion or matching public address is insufficient evidence of success or signing authority. Keep all native write controls absent until those gates and a separately authorized controlled test are satisfied.
