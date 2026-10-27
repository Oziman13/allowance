# Allowance — Phase 2B-3 static security analysis

Date: 2026-10-27. **Internal security analysis, not an independent audit or a certification of safety.** Analysis only: no scanner suggestion was auto-remediated and no production behavior was changed.

## Scope and baseline

`git fetch origin main` succeeded and matched the expected base: **`d03525818a9e85e5bc5201a3b3109a6154bfe48a`**. The feature branch is `codex/allowance-static-analysis-phase2b3`.

The production target is the complete `src/Allowance.sol`, including the `Allowance` contract and its `IERC20` interface. Source SHA-256: `3a84a84647c051aa2015316d86ffbf70777ae824932fe7e9c5ad875a7df27474`. Reviewed alongside `foundry.toml`, [SECURITY.md](../SECURITY.md), the [Phase 2A review](SECURITY-REVIEW-PHASE2A.md) and [Phase 2B-2 validation](SECURITY-VALIDATION-PHASE2B2.md). The source and existing tests remained byte-identical to the base.

Compilation uses the existing Solidity **0.8.28+commit.7893614a.Linux.g++** executable and Foundry **1.7.1** (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`). Repository settings remain Cancun, optimizer enabled with one run, via IR. Slither compiled through Foundry with those settings. Aderyn read the Foundry source/remappings/EVM target, used the local 0.8.28 compiler and ingested one source unit; its console does not enumerate every internal compiler setting, so its AST analysis is not an independent verification of code-generation flags.

No ABI, frontend, MCP implementation, CI, compiler/deployment configuration, addresses or production dependencies were edited. There were no public RPC calls, broadcasts, public-chain deployments or main-branch merges. Test deployments used local EVM/Anvil fixtures only.

## Executive result

| Tool | Verified execution | Raw classifications |
|---|---|---|
| Slither **0.11.6** | `success: true`, no JSON error; log reports **2 contracts, 102 detector classes, 9 results**; compilation scope contains only `src/Allowance.sol` | **2 High, 1 Medium, 4 Low, 2 Informational** result records |
| Aderyn **0.6.8** | Log ingests **1 compiled file with solc 0.8.28**, then runs **88 detectors**; JSON identifies `src/Allowance.sol`, **343 SLOC** | **0 High, 6 Low issue categories**, containing **10 source instances** |

Slither's exit code was **255**, its normal nonzero findings policy here, not a successful-analysis claim inferred from an exit code. The JSON success flag, source mappings, compiler scope and completed detector summary establish execution. Aderyn returned **0**, but success was separately checked against ingestion, detector execution, report contents and the exact source path; earlier failed setup attempts were not counted.

**No new confirmed exploitable vulnerability was established by manual triage.** Raw High warnings remain present and documented below. This does not erase the known Medium unsupported-token insolvency risk, Low lifetime-counter limitation, or other policy limitations. Scanner silence is not proof of absence of vulnerabilities.

## Installation, provenance and isolation

Initial PATH checks found Python **3.12.14**, pip and uv; no Slither, Aderyn, pipx, Rust or Cargo executable. Tools were provisioned under **`/workspace/.allowance-static-tools/`**, outside the repository. No sudo, global package installation, project dependency/lockfile edit, remote shell installer, auto-updater or `curl | bash` was used.

### Slither

The official [Crytic Slither installation documentation](https://github.com/crytic/slither#using-pip) specifies `slither-analyzer`; the [PyPI 0.11.6 metadata](https://pypi.org/pypi/slither-analyzer/0.11.6/json) points back to that repository. Metadata and documentation were inspected before installing the exact version into a Python virtual environment, from the official PyPI index, using binary wheels only.

The installed top-level wheel's SHA-256 was cross-checked against PyPI metadata and the pip installation report:

```text
slither_analyzer-0.11.6-py3-none-any.whl
01f809198d3f171e2d768569c0054c96af5736614e183c64f42c9b51636c33c1
```

All installed wheel URLs in the pip report were under `https://files.pythonhosted.org/`. The [tooling provenance](security-analysis/phase2b3/tooling-provenance.json) captures exact versions, URLs and hashes of all installed packages; [slither-environment.txt](security-analysis/phase2b3/slither-environment.txt) records the resolved package versions for replay. These are tool-environment evidence, not new project requirements.

Slither's `solc-select` import initially attempted a default home cache. Setting `VIRTUAL_ENV` to the actual isolated virtual environment directed that cache inside the tool environment. No alternate compiler was downloaded; Foundry was given the existing compiler path.

### Aderyn

Official source: [Cyfrin Aderyn release `aderyn-v0.6.8`](https://github.com/Cyfrin/aderyn/releases/tag/aderyn-v0.6.8), whose pinned README identifies the Cyfrin project and distribution. Downloaded only its `aderyn-x86_64-unknown-linux-gnu.tar.xz` and the adjacent publisher `.sha256` file over HTTPS. **The checksum was verified before safe archive extraction or execution**:

```text
Archive SHA-256: ffd6ca658962e211a3ac821c646f69c8e14bf1b1001cbfe091bcd4535a691e46
Executable SHA-256: a268d616826901e17717b1bc6368d8b2c063045a46fb99a0c0f657f102d977ca
```

No release installer was executed. The archive was extracted only into the isolated version directory. Hashes verify consistency with publisher metadata, not an independent reproducible-build or signing attestation.

The [initial failed attempt](security-analysis/phase2b3/aderyn-initial-attempt.txt) could not derive ASTs because the default compiler-cache location was read-only. A diagnostic default-cache attempt also failed while trying to fetch the Solidity release list; neither produced a successful analysis. An empty default cache created by that diagnostic was removed. The successful run uses `XDG_DATA_HOME` inside the isolated tool directory, with the existing compiler symlinked into its expected `svm/0.8.28/solc-0.8.28` location. This avoids both home-directory installation and implicit compiler downloads. `SVM_HOME`/`XDG_CACHE_HOME` alone did not resolve this version's data-directory lookup.

## Exact execution and reproducibility

Run from the repository root at the base above, with an existing Forge/forge-std installation and the local 0.8.28 compiler. The observed architecture was x86_64 GNU/Linux, glibc 2.41.

```sh
TOOLS=/workspace/.allowance-static-tools
FORGE=/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge
SOLC=/workspace/.allowance-tools/solc-0.8.28
SLITHER="$TOOLS/slither-0.11.6/bin/slither"
ADERYN="$TOOLS/aderyn-0.6.8/aderyn-x86_64-unknown-linux-gnu/aderyn"
ARTIFACTS=docs/security-analysis/phase2b3
```

Isolated Slither installation used:

```sh
python3 -m venv "$TOOLS/slither-0.11.6"
"$TOOLS/slither-0.11.6/bin/python" -m pip install \
  --index-url https://pypi.org/simple --only-binary=:all: --no-cache-dir \
  --disable-pip-version-check --report "$TOOLS/slither-install.json" \
  slither-analyzer==0.11.6
```

For Aderyn, the exact archive and checksum URLs are in `tooling-provenance.json`. Download with an HTTPS client, verify the published hash above, then extract without executing any installer. The actual download/verification used Python `urllib.request`, `hashlib.sha256` and `tarfile.extractall(..., filter="data")`. For a fresh environment, create the same isolated compiler/executable links:

```sh
mkdir -p "$TOOLS/bin" "$TOOLS/data/svm/0.8.28" "$ARTIFACTS"
ln -sf "$FORGE" "$TOOLS/bin/forge"
ln -sf "$SOLC" "$TOOLS/bin/solc"
ln -sf "$SOLC" "$TOOLS/data/svm/0.8.28/solc-0.8.28"

VIRTUAL_ENV="$TOOLS/slither-0.11.6" "$SLITHER" --version
"$ADERYN" --version
"$SOLC" --version
```

Final artifact-producing scanner commands, executed without network access requirements:

```sh
VIRTUAL_ENV="$TOOLS/slither-0.11.6" PATH="$TOOLS/bin:$PATH" \
FOUNDRY_SOLC="$SOLC" "$SLITHER" . --compile-force-framework foundry \
  --json "$ARTIFACTS/slither.json" --json-types detectors \
  > "$ARTIFACTS/slither.txt" 2>&1
# Observed exit 255, completed analysis with findings. Inspect success/error in JSON.

XDG_DATA_HOME="$TOOLS/data" PATH="$TOOLS/bin:$PATH" \
"$ADERYN" . --src src --output "$ARTIFACTS/aderyn.json" \
  > "$ARTIFACTS/aderyn.txt" 2>&1
# Observed exit 0; verify file scope and detectors in JSON/log, not exit alone.
```

Use fresh artifact paths or move old output files before repeating: tools may refuse to overwrite an existing report. During setup, Slither also ran with `--json-types detectors,compilations` and a cached `--foundry-ignore-compile` replay. Final committed `slither.json` is the unmodified detector JSON from a fresh Foundry compilation, not a filtered/edited findings set. Full compiler AST output and the redundant detector-description catalog were kept out of committed artifacts; the small [compilation-scope.json](security-analysis/phase2b3/compilation-scope.json) explicitly identifies its derived nature. No detector, impact class, finding location or triage suppression was configured.

### Analyzers executed and coverage boundaries

[slither-detectors.json](security-analysis/phase2b3/slither-detectors.json) lists all **102 default registered detector names**. This inventory was obtained from the installed package's detector selection routine with `all` and no exclusions; it agrees with the scan log. Slither's own public `list-detectors` catalog omits the `backdoor` example, showing 101 entries, but that is a display omission rather than evidence that this run suppressed a finding. Detectors with version/feature applicability checks may return no results for 0.8.28; no detector execution exception was reported.

Aderyn's exact **88 names** are preserved in `aderyn.json` under `detectors_used`. All severities were enabled; no path include/exclude or `--highs-only` was used. Both tools were scoped to production: Slither's Foundry adapter automatically skipped `test` and `script`, and Aderyn source scope was `src`, with one compiled source file. Tests are validation evidence, not scanner production targets.

Optional report printers and external/LLM-assisted querying were not used. These scans do not cover live token implementations, Portaldot precompiles, chain-specific gas/storage deposits, real collateral, RPC/finality behavior, formal verification or exhaustive symbolic execution. No claim is made that every possible semantic bug is represented in a detector.

## Manual triage — Slither

Scanner impact/confidence below are preserved verbatim; manual dispositions are separate. Each source reference is in `src/Allowance.sol` at the tested commit.

| ID | Detector / raw impact, confidence | Exact source | Manual classification and reasoning |
|---|---|---|---|
| S1 | `arbitrary-send-eth` — High, Medium | `_send`, call at **423**, callers at **193, 220, 266, 304, 329** | **False positive for unauthorized-send exploit; intentional payout design.** `_send` is private. Owner withdrawal/approval require `_owned`; autonomous pay/refuel require the current live agent and budget/caps; opening seeds use the creator's attached funds. Payment recipients are deliberately selectable subject to the applicable rule path. A recipient alone has no withdrawal privilege. See detailed prerequisites below. |
| S2 | `reentrancy-balance` — High, Medium | `_pull` **432–439**, balance read **433**, external call **434–435**, zero check **438** | **False positive for fund-moving callback reentrancy under compatible-token assumptions.** Both entry points (`openAccount`, `fund`) hold the shared `nonReentrant` lock. The before/after balance delta is deliberate. Unusual token balance changes remain a **known confirmed asset limitation**, not dismissed by the guard. |
| S3 | `incorrect-equality` — Medium, High | `_pull`, **438**, `received == 0` | **False positive.** The equality rejects a zero-credit deposit; it does not require total escrow to equal a fixed value and cannot be broken by an unsolicited donation. Positive actual received amounts, including reduced inbound fee amounts, are accepted. |
| S4 | `timestamp` — Low, Medium | `_agentOf`, **142** | **Confirmed design limitation.** Expiry intentionally uses block time, with `>=` at the boundary. Timestamp ordering is an execution assumption; no randomness or non-time authorization is derived from it. |
| S5 | `timestamp` — Low, Medium | `_request`, **383** | **False positive / taint over-approximation.** `requestId >= _requests.length` is an index bounds check, not a timestamp comparison. Request growth and time-related request data can induce detector taint; removing this check would remove safety. No timestamp-based bypass was established. |
| S6 | `timestamp` — Low, Medium | `_roll`, **401** | **Confirmed design limitation.** Window reset intentionally uses block time. Spending close to a fixed-window boundary is possible by design, not a rolling-limit violation. |
| S7 | `timestamp` — Low, Medium | `_left`, **408** | **Confirmed design limitation.** View capacity uses the same time boundary as settlement and is only a snapshot. A preview is not a reservation. |
| S8 | `low-level-calls` — Informational, High | `_send`, **423, 425** | **Informational observation.** Native calls and ERC-20 calls are deliberate. Native success is checked; token call success and nonempty boolean data are checked; failure reverts. Empty token returns are supported. Arbitrary token honesty/net delivery is not guaranteed. |
| S9 | `low-level-calls` — Informational, High | `_pull`, **434–435** | **Informational observation.** `transferFrom` success/return data are checked and observed escrow increase is credited. It is not delegatecall. The token's actual accounting remains a trust boundary. |

### S1 prerequisites and impact assessment

An unauthorized theft would require reaching the private helper without the caller's account permissions or receiving more than a valid guarded operation permits. Tracing every call site found no such public path. A compromised agent can spend within its account's configured rules, or receive capped native refuels; it cannot approve an arbitrary request or withdraw another owner's account. An owner can withdraw or explicitly approve outside autonomous caps; that is trusted authority rather than a vulnerability. A malicious recipient may reject/reenter during the external call, but fund-moving reentry is locked and failure rolls back.

Existing `test_allOwnerEntryPointsRejectStranger`, original owner/agent authorization tests, the multi-account reference ledger and the native callback tests passed again. No new arbitrary-send reproduction was warranted merely to repeat those assertions. The warning remains in raw output; no suppression was added. Freely spendable seeds/refuels and old owner approvals remain the documented I01/I02 boundaries.

### S2 prerequisites and impact assessment

A callback attempting a second fund-moving call must pass `nonReentrant`, which executes before those operations' effects. All six fund-moving entry points share that lock. Unguarded policy/request-state helpers still enforce owner/current-agent authority and do not create a second payout. `balanceOf` itself is read-only at the EVM call boundary, though an asset can lie about its reported value.

The guard cannot stop a token from rebasing its own balances, charging sender surcharges or returning misleading success. Those are still M01/I03 and the positive-rebase attribution proof from Phase 2B-2; they are not new High callback theft findings. Existing incoming/outgoing callback tests, `test_callbacksBlockAllSixFundMovingEntryPointsAcrossAccounts`, fee/no-return tests and rebase counterexamples passed. This triage is conditional on the published supported-asset assumptions, not a blanket endorsement of arbitrary tokens.

## Manual triage — Aderyn

Aderyn reports **six Low categories** with the ten instances shown here. It does not supply Slither-style confidence scores in this JSON; none are invented.

| ID | Detector / raw impact | Source location(s) | Manual classification, prerequisites and impact |
|---|---|---|---|
| A1 | `costly-loop` — Low | Trust loops **183, 232** | **Confirmed design limitation, informational operational impact.** Each trust-list element requires a storage write/event. Account creator or authorized owner chooses the input length and pays the transaction cost. A large batch can run out of gas and revert that transaction, but no loop over all protocol users is forced on unrelated settlements. No attacker path to freeze another owner's funds was established. |
| A2 | `push-zero-opcode` — Low | Pragma **2** | **Unconfirmed portability concern for another runtime; informational for the configured target.** Compiler/EVM target is pinned to 0.8.28/Cancun, not an accidental default. A deployment on a runtime lacking the required opcodes could fail. This phase did not redeploy or freshly attest Portaldot opcode support; existing testnet operation is historical context, not new proof. Do not change deployment flags automatically. |
| A3 | `require-revert-in-loop` — Low | Trust loops **183, 232**, calling `_setTrust` | **Informational observation / intentional atomicity.** `_setTrust` rejects a zero address. A caller-supplied invalid list element reverts the batch, including prior changes. Open-account input is creator-controlled; later updates are owner-only. Automatically “forgiving” invalid items would change expected policy semantics. No unauthorized actor can supply a trust list for someone else's update. |
| A4 | `unchecked-return` — Low | `_owned(id)` in `setTrusted` **231**; `_owned(r.accountId)` in `reject` **271** | **False positive.** The unused return is a storage pointer; the intended effect is the helper's owner check and revert. Ignoring the pointer does not skip execution. Existing unauthorized tests cover both entry points; neither uses a token-transfer boolean here. |
| A5 | `uninitialized-local-variable` — Low | `uint256 i` in loops **183, 232** | **Informational observation, not undefined-memory behavior.** Solidity initializes the unsigned local to zero. Explicit `= 0` would be style, not a security fix. Loop gas/cost limitations are A1; no exploitable uninitialized value was established. |
| A6 | `unspecific-solidity-pragma` — Low | Pragma **2**, `^0.8.24` | **Informational build-portability observation.** The source range permits multiple compiler versions, but this repository explicitly builds with 0.8.28. Compiling outside the pinned toolchain deserves separate review. The actual scan did not select a floating compiler, and no compiler-version exploit was reproduced. |

No isolated reproduction tests were added: existing authorization, callback, token-return, fixed-window, invariant and adversarial-asset tests already exercised the meaningful security claims. The scanner suggestions about batch tolerance, compiler pragmas and loop style were not applied.

## Confirmed risks, limits and remediation order

**Newly confirmed security vulnerabilities: none.** No raw finding was converted to a clean-scan claim by lowering severity or editing scanner output. Manual classification is a reasoned assessment, not mathematical proof that warnings can never apply.

1. **Keep asset exclusions and small testnet budgets.** Phase 2A M01 (Medium: rebases/sender surcharges can undermine same-token pooled backing) remains real. Phase 2B-2's positive-rebase yield attribution and nominal-versus-net delivery limitations remain. Neither scanner establishes arbitrary ERC-20 compatibility or live collateral safety.
2. **Plan substantive future changes separately.** L01's extreme lifetime `uint128 totalSpent` exhaustion remains a Low availability limitation with surviving owner withdrawal. The scanners did not newly report that bound; it was covered by the existing local proof. Custody/adapters, wider/nonblocking statistics and any request epoch/cleanup design need their own review, not automatic scanner patches.
3. **Retain documented owner/wallet boundaries.** Owner approval can execute old requests after freeze/expiry/rotation without consuming autonomous limits. Seed/refueled funds already in the wallet are unrestricted. These intentional powers must not be “fixed” by treating them as unauthorized sends.
4. **Address operational observations deliberately if needed.** Measure trust-list batch costs on the target chain before proposing batching limits; preserve atomicity. Confirm opcode/runtime compatibility for each future deployment and keep compiler/tool versions pinned. Cosmetic loop/pragma edits are lower priority than asset/accounting risks.
5. **Continue independent review and broader validation.** Scanners are heuristic and version-dependent. Earlier stateful tests are finite sampled traces, not formal proofs. Live token/precompile implementations, future upgrades, chain-specific storage deposits, finality, RPC trust and owner-key management are not validated by this scan. An external professional audit is still required before mainnet or material-value use.

## Final validation and preserved scope

Commands used the same existing direct Forge and compiler paths above:

```sh
"$FORGE" test --use "$SOLC" --fuzz-seed 0x2b3 -vv
"$FORGE" build --use "$SOLC" --sizes
"$FORGE" fmt --check
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil \
  npm test --prefix mcp
# Checks on the final staged diff and unchanged protected paths:
git diff --cached --check
git diff --quiet origin/main -- src test mcp web config .github foundry.toml
```

| Check | Actual result |
|---|---|
| Baseline complete Foundry suite | **58 passed**, zero failed/skipped |
| Final complete Foundry suite | **58 passed**, zero failed/skipped; original native fuzz test **1,000 runs**, stateful property **128 runs × depth 128 / 16,384 calls**, zero handler reverts |
| MCP suite | **37 passed**, zero failed/skipped; local Anvil only |
| Build with `--sizes` | Passed, with existing Foundry lint warnings; no production binary committed |
| Repository-wide `forge fmt --check` | **Failed (exit 1)** on pre-existing formatting in `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. All three match the base byte-for-byte. No automatic formatting was applied to protected production/tests. |
| New documentation/artifact checks | Report links/fences and JSON parse/scope checks passed; staged whitespace check passed |
| Protected-path comparison | No diff in production Solidity, tests, ABI, frontend, MCP implementation, CI, configuration, addresses or dependencies |

Foundry's separate timestamp/cast lint warnings remain heuristics already discussed in Phase 2A/2B-2; they were not silently fixed or counted as scanner vulnerabilities. This phase adds only this report and the small raw/metadata artifacts below. Existing tests and assertions were not weakened, and no test was added just to mirror a cosmetic scanner suggestion.

## Committed evidence files

All artifacts are under `docs/security-analysis/phase2b3/`:

- `slither.json`: unmodified raw nine-result JSON, including IDs, classifications, descriptions and source mappings.
- `slither.txt`: unmodified raw completed scan/Foundry invocation log.
- `slither-detectors.json`: explicitly derived default detector-selection inventory (102 names), not a raw findings replacement.
- `slither-environment.txt`: isolated environment's resolved package versions.
- `aderyn.json`: unmodified raw findings, file scope, SLOC and 88 detector names.
- `aderyn.txt`: unmodified completed scan log showing actual source ingestion and detector execution.
- `aderyn-initial-attempt.txt`: failed default-cache AST setup attempt, retained as a failed attempt rather than a clean scan.
- `compilation-scope.json`: derived compiler/source/configuration evidence and production-source hash; full generated AST/bytecode is intentionally not committed.
- `tooling-provenance.json`: official URLs, pinned versions, installed-wheel hashes and release-archive/executable hashes.

No caches, scanner executables, virtual environments, full build outputs or credentials are committed. The changed-file list is this report plus these nine evidence artifacts.
