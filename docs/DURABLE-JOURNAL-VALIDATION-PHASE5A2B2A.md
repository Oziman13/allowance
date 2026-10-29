# Phase 5A-2B-2A — durable journal and wallet coordination

Date: **29 October 2026 (UTC)**. Repository: `Oziman13/allowance`. Fetched and verified base: **`dd143024fbf22c3002469dfced37bd610bb3c040`**. Branch: **`codex/allowance-durable-journal-phase5a2b2a`**. Reference: [approved recovery design](TRANSACTION-RECOVERY-DESIGN-PHASE5A2B1.md).

**Internal implementation and local fault validation, not an independent security audit.** This phase adds inert persistence primitives. Neither `mcp/lib.js` nor `mcp/index.js` imports them. Existing payments, refuels, cancellations, five MCP tools and successful response schemas remain unchanged. No signing, broadcasting, network service, retry, public-chain transaction or deployment is added.

## Decision

**CONDITIONAL GO for a separately reviewed broadcaster-integration phase; NO-GO for connecting this directly to live payments now.** The local tests establish conservative exclusion, strict records and failure-before-admission behavior under the assumptions below. They do not establish complete transaction recovery, exactly-once purchases, a trustworthy receipt verifier, distributed nonce reservation or Portaldot V3 finality. Crash-lock recovery, provisioning/migration, transport policy and action-specific reconciliation must be reviewed before integration.

All **58 Foundry**, **61 MCP** (42 existing plus 19 journal/coordination), **24 native** and **10 display** tests passed locally. The complete MCP run used disposable localhost Anvil fixtures. The new primitives use no RPC, wallet or signing API; their broadcast counters are explicitly simulated.

## 1. Architecture and trust assumptions

`mcp/journal.js` implements synchronous filesystem operations using Node standard libraries. `mcp/journal-schema.js` validates identity, operation history and transitions. No dependency was added, installed or upgraded. No `flock` binary or external lock service is required.

The minimal API is:

| API | Meaning |
|---|---|
| `initializeStore({stateDir})` | Explicit, exclusive, one-time provisioning. Returns `{stateDir, storeId}` only after persistence barriers. Never initializes an existing directory. |
| `openStore({stateDir, storeId})` | Opens an expected store; missing, corrupt or mismatched state fails. Does not provision or repair. |
| `store.createWallet(binding)` | Explicit, exclusive initialization for one network/wallet; returns `{journalId, binding}`. Existing/incomplete directories are never overwritten. |
| `store.inspect(descriptor)` | Structurally validates/replays history and returns a copied snapshot. Read-only; grants no mutation permission and does not remove ownership files. |
| `store.acquire(descriptor)` | Acquires exclusive ownership and durably records its opening. Returns a capability with `admit`, `addChild`, `transition`, `closeOperation`, `release`. |
| `session.admit({intent, child})` | Validates identity, unresolved operations and recorded nonce history; durably records PREPARED before returning an opaque operation ID. |
| `session.addChild(operationId, spec)` | Adds the payment child only after a confirmed refuel, using a strictly larger nonce. |
| `session.transition(operationId, childId, patch)` | Persists a permitted transition. SUBMITTING rechecks other unresolved parents and preceding child progress. |
| `session.closeOperation(operationId, closure)` | Explicitly acknowledges a fully settled parent as RESOLVED or ABANDONED. Does not observe the chain or automatically start another transaction. |
| `session.release()` | Permanently revokes that capability, durably closes ownership, then removes the ownership file and syncs its directory. |

The optional `io` argument is a trusted local test adapter, not a configuration surface for agents or a network endpoint. Errors expose a bounded code and, for filesystem failures, a sanitized filesystem code. They do not retain SDK error objects or unrestricted causes/messages.

All cooperating writers must use the **same provisioned store and wallet descriptor** under one trusted OS user on one host. Save the returned store/journal IDs in trusted external configuration before using them; a future integration must define this provisioning workflow. Recreating IDs after state loss is not recovery. The store has no configuration integration in this phase.

The OS user, privileged administrator, filesystem implementation, Node runtime and future caller are trusted. This is protection against accidental corruption, unsafe paths and cooperating concurrent processes, not a sandbox against a malicious same-UID process, root, disk rollback or a hostile filesystem. Local admission cannot stop direct contract calls, an old MCP process that ignores this protocol, another device or another state directory using the same signing key.

## 2. Supported persistence environment

- **Linux only**, with `getuid`, `O_NOFOLLOW`, exclusive file creation, regular-file and directory fsync, stable inode identity and truthful filesystem semantics. Windows/macOS are rejected. Tested here with **Node 24.19.0**, Linux, uid 1000 and overlayfs (`0x794c7630`). Other Node versions were not executed locally; the repository's Node engine/dependency settings were not changed.
- Filesystem type admission is restricted to ext4 (`0xef53`), XFS (`0x58465342`), btrfs (`0x9123683e`) and conditional overlayfs. NFS, tmpfs and unknown types fail explicitly. This is an environment policy, not evidence that every allowed filesystem/mount/device combination has been qualified. Only the current overlayfs environment was functionally exercised. Overlayfs durability also depends on its backing filesystem and container lifecycle; ephemeral container storage is unsuitable for persistent payment state.
- The state root and wallet directories must be owned by the current user with exactly **0700**, including no special mode bits. State files must be regular, single-link, current-user-owned **0600** files. Ancestors must be real directories owned by root/current user with no group/world write permission. Symlinks, hardlinked state files, noncanonical/relative paths, traversal and broader permissions fail. A state directory under world-writable `/tmp` is intentionally unsupported, even with a private leaf directory.
- The trusted parent directory must already exist. Keep paths and their ancestors stable. Component checks plus `O_NOFOLLOW` reject the tested symlink substitutions; Node path-based operations do not provide an `openat2` sandbox against malicious same-user ancestor replacement between checks.
- File contents are capped at **8 MiB**. There is no compaction, snapshot replacement, garbage collection or migration in this version. Reaching the cap fails closed. Persistent storage exhaustion and recovery from it need an explicit future operational policy.

Passing fsync is a required barrier, not proof against hardware/controller dishonesty or power failure. **SIGKILL tests do not demonstrate power-loss durability.** No hardware-reset, filesystem-remount or container-loss campaign was performed.

## 3. Exact stored identities and schema

Every record has literal numeric `schemaVersion: 1`. Unknown versions are rejected, not coerced or migrated. Canonical JSON uses sorted object keys and one newline per record. Each record has a SHA-256 `digest` over the canonical body excluding `digest`. Strict object validation rejects extra fields, accessors, nonplain objects and unexpected types. JSON decoding also requires the original text to be canonical. Checksums detect accidental modification; they are **not authentication** against an attacker able to rewrite records and checksums.

| Record / value | Fields and constraints |
|---|---|
| `store.json` | `kind: STORE`, `schemaVersion`, opaque UUIDv4 `storeId`, `digest`. |
| Network/wallet binding | `chainId` (positive decimal string), `genesisHash` (lowercase 32-byte hex), `wallet` (nonzero lowercase H160). These are supplied identities, not fresh RPC attestations. |
| Wallet directory | SHA-256 of canonical binding. **Contract and allowance account are excluded** from this coordination key so accounts/contracts sharing the wallet share ownership. |
| `owner.lock` | `kind: LOCK`, version, store ID, journal ID, binding digest, fresh opaque UUIDv4 ownership `token`, checksum. No PID, lease, timestamp or secret. |
| Journal header | `kind: HEADER`, version, store ID, UUIDv4 journal ID, binding, initial owner token, checksum. |
| Ownership frame | `kind: OWNER`, version, decimal-string `sequence`, `previousDigest`, token, `action: OPEN` or `CLOSE`, checksum. |
| Operation frame | `kind: OP`, version, sequence, previous digest, active owner token, full operation, checksum. Replay verifies the change against preceding state. |
| Sole final seal | `kind: SEAL`, version, sequence, last digest, checksum. Must terminate the file and match its history. |
| Parent operation | UUIDv4 `operationId`, immutable `intent`, `status: OPEN/CLOSED`, `closure: null/RESOLVED/ABANDONED`, one or two children. |
| Intent | `kind: pay/cancel`, contract H160, account ID, asset H160 (zero means native), recipient, raw amount, memo hash, request ID. Pay requires nonzero recipient different from the contract, positive uint128 amount, memo hash, null request ID. Cancel requires a request ID, null recipient/memo hash and zero amount. |
| Child specification | Kind `pay/refuel/cancel`, recipient, raw amount, memo hash, request ID, unsigned transaction fields. Pay/cancel must match parent intent. Refuel is native-only, positive, directed to the bound wallet; a two-child parent must be refuel then pay. |
| Unsigned transaction fields | `nonce`, `type: 2`, `valueRaw: "0"`, positive `gasLimit`, positive `maxFeePerGas`, `maxPriorityFeePerGas` not exceeding max fee, `calldataHash`. Sender/network/outer contract/account/asset are inherited and cannot be overridden with extra fields. This schema records supplied fees; it neither calculates nor changes V3 fees. |
| Child state | UUIDv4 child ID, immutable specification, `state`, `transactionHash`, `outcome`, `receipt`, `reasonCode`. Hash is null only for PREPARED/NOT_SUBMITTED; once assigned it cannot change. |
| Receipt observation | Transaction hash matching the child, block hash, decimal-string block number, numeric status exactly 0 or 1. CONFIRMED requires status 1 and PAID/HELD, REFUELED or CANCELLED appropriate to the kind; REVERTED requires status 0 and null outcome. |
| Bounded reasons | null or `RPC_UNAVAILABLE`, `TIMEOUT`, `PROCESS_RESTART`, `EVENT_MISMATCH`, `REPLACEMENT_OBSERVED`, `MANUAL_REVIEW`. No arbitrary error dump. |

All chain integers are canonical decimal **strings**, bounded to uint256 (amounts to the contract's uint128 range); they are never floating-point conversions. Type, receipt status and schema version are small numeric discriminators. Hashes/addresses are strict lowercase fixed-width hex, IDs lowercase UUIDv4. No operation ID selects a filesystem path.

No private key, mnemonic, signed raw transaction, calldata bytes, freeform memo or arbitrary SDK error has a persistence field. Tests reject added secret/raw-transaction/error properties and hidden `toJSON` methods before writes, and inspect disk contents. Hashes, addresses, amounts and request IDs remain sensitive operational metadata visible to the local user. Validation cannot recognize a secret deliberately mislabeled as an otherwise valid 32-byte hash; the trusted caller must not do this. No encryption or protection from same-user/root access is claimed.

## 4. State transitions and admission semantics

The child transitions implement the approved design, plus its optional proof-based prebroadcast abort:

```text
PREPARED -> SUBMITTING | NOT_SUBMITTED
SUBMITTING -> SUBMITTED | UNKNOWN
SUBMITTED -> CONFIRMED | REVERTED | UNKNOWN
UNKNOWN -> SUBMITTED | CONFIRMED | REVERTED | RECOVERY_REQUIRED
RECOVERY_REQUIRED -> CONFIRMED | REVERTED
CONFIRMED | REVERTED -> RECOVERY_REQUIRED
NOT_SUBMITTED -> no further child transition
```

PREPARED records validated unsigned intent; **it is not broadcast permission**. SUBMITTING records the supplied expected hash before any future broadcaster may be invoked. Unknown outcomes preserve the original hash. A different hash cannot replace it; an observed replacement can be marked RECOVERY_REQUIRED, but replacement candidates and reconciliation are deferred. No missing receipt proves failure or enables retry.

CONFIRMED and REVERTED are **structurally checked observations supplied by a trusted caller**, not conclusions computed by this module. It does not derive a hash from a signature, bind calldata bytes cryptographically to the intent, query chain identity, authenticate RPC data, verify the full transaction envelope/events, enforce a confirmation policy or attest finality. Integration must supply those checks before requesting those transitions. Merely writing a matching-looking receipt/outcome is not verification of payment.

An OPEN parent blocks all new admissions for that network/wallet, even if a child is settled: the caller must explicitly acknowledge parent completion/partial abandonment. RESOLVED requires a target-kind child; ABANDONED can retain a confirmed refuel without pretending a payment occurred. Both require every child to be CONFIRMED, REVERTED or provably NOT_SUBMITTED. NOT_SUBMITTED is reachable only from PREPARED; a submitted/uncertain child cannot be converted to it.

Confirmed refuel must precede adding pay; its nonce must increase. Pay cannot enter SUBMITTING with an unresolved earlier child. If contradictory evidence reopens an older closed operation, a different prepared operation cannot enter SUBMITTING. The schema permits reconciliation transitions while writes remain blocked. Closing an operation creates no resubmission or parent-resume loop.

Admission also rejects a nonce less than or equal to any previously hash-bearing child's nonce, including reverted transactions. A provably NOT_SUBMITTED nonce can be reused. This is conservative **local history checking**, not live nonce selection/reservation or replacement handling. No invoice/client-intent deduplication or memo-based deduplication is added; two fully resolved separate purchases remain separate operations.

## 5. Filesystem protocol and crash behavior

### Provisioning

Store creation exclusively creates a private directory, syncs its parent, creates/fsyncs an `initializing` marker, syncs the directory, creates/fsyncs the checksummed manifest, syncs root and parent, then removes the marker and syncs root. Wallet creation exclusively creates/syncs a private wallet directory and its parent, creates/fsyncs its ownership file and directory, creates/fsyncs header+seal, syncs directory/parent, then durably closes ownership before removing/syncing the ownership filename. A failure returns no successful descriptor and leaves incomplete state blocked. Existing directories are never silently repaired or reprovisioned.

### Journal changes

Under ownership, each mutation validates the entire prior history and inode identity, opens the regular journal without following a symlink, checks that its bytes still match the validated snapshot, **overwrites the old final seal with the new frame plus new final seal**, truncates to the exact length, fsyncs the file, fsyncs the wallet directory and validates the result before acknowledging it. Short writes are completed in a loop; zero-progress writes fail. This is a crash-detectable update, **not an atomic replacement or a promise of uninterrupted availability**.

A torn update that destroys the final seal or its checksum blocks reads/admission. Truncating at an intermediate record boundary also leaves no final seal. An unsuccessful zero-byte or identical-prefix write can leave the previous valid snapshot; the failed capability is still poisoned and its ownership file remains. No invalid suffix is discarded, no valid prefix is silently accepted as a repaired journal and no automatic resend follows. File size/mtime changes during a read reject that read rather than produce an assumed empty state.

A complete, internally valid rollback of the whole file/store, deletion followed by reprovisioning elsewhere, or restoration of a matching old backup cannot be detected without an external trusted checkpoint. Store/journal IDs catch accidental identity changes, not arbitrary rollback of valid history. Backups/restores require an explicit future reconciliation policy.

### Ownership

1. Prevalidate store, wallet descriptor and journal before acquiring ownership.
2. Create `owner.lock` with `O_CREAT|O_EXCL|O_NOFOLLOW`; validate inode/ownership/mode, fsync file and directory. A competing process gets WALLET_BUSY. Never remove a pre-existing file.
3. Reread history and require the preceding owner to be durably CLOSED. Persist/fsync a fresh OWNER OPEN token. Only then return a capability.
4. Before each change, verify root/wallet identity, ownership-file inode/token/binding and journal OPEN token. Persistence, integrity or ownership failure poisons the capability; it cannot subsequently admit or release.
5. For normal release, revoke the capability **before** persisting OWNER CLOSE, fsync file/directory, then unlink and directory-fsync the ownership file. If unlink fails, the file still blocks admission. If the final directory sync after unlink fails, release reports failure and the old capability remains revoked. A later explicit open/acquire must successfully repeat its own persistence barriers; durable CLOSE was already required before unlink. This is not automatic recovery or silent continuation after failed fsync.

A killed process leaves its ownership file behind. No elapsed-time/PID reuse heuristic, lease expiration, automatic stale-file deletion or takeover API exists. If someone deletes the ownership file while the recorded owner is OPEN, acquisition reports OWNERSHIP_UNCERTAIN. **There is deliberately no built-in crash-lock or corrupt-record repair command.** Safe recovery presently means refusing writes and retaining evidence. Designing an explicit offline, reviewed recovery/provisioning procedure is a remaining integration gate; operators must not simply delete locks or reinitialize state to regain availability.

## 6. Fault and process evidence

The **19 named journal tests** contain focused scenario groups, not 19 live-network experiments. Filesystem adapters act on real local files and deterministically change selected writes/fsync/open/unlink calls. Owned child processes use actual SIGKILL and restart. Their fixture imports no ethers, provider, wallet or signer; `simulatedBroadcasts` is a counter incremented only after successful durable PREPARED and SUBMITTING calls.

| Scenario group | Asserted final evidence |
|---|---|
| Initial store/wallet creation | Private modes, file+directory fsync observed, stable descriptors, existing state never overwritten. |
| Lifecycle, raw integers and identity | Large account/request IDs round-trip exactly; opaque IDs survive reopen; illegal transitions, nonce reuse and hash changes rejected. Cancel identity round-trips. |
| Refuel/pay partial progress | No pay child before confirmed refuel; nonce must increase; ABANDONED retains refuel outcome and NOT_SUBMITTED pay. |
| Multiple accounts/contracts | Same-wallet unresolved parent blocks another allowance/contract; a different wallet has separate ownership. |
| Contradictory old outcome | Reopened older operation blocks newer SUBMITTING with **zero simulated broadcasts**, preserving bytes; wrong receipt hash/status/kind cannot confirm. |
| Secret/error input | Extra key/seed/raw-signed-transaction/Error fields, hidden `toJSON`, numeric loss and sender override rejected; no secret/raw bytes persisted. |
| IDs and paths | Invalid IDs/traversal cannot select paths or alter bytes; mismatched journal ID fails before creating ownership. |
| Schema/integrity | Unknown versions, changed checksum, torn final seal, record-boundary truncation and extra fields fail; **zero simulated broadcasts** and no silent bootstrap. |
| Expected state | Wrong store/network binding, missing journal and unsupported root schema fail. |
| Symlink/permissions | Root/journal/lock symlinks, hardlinks, broadened permissions and substituted lock token rejected; sentinel target untouched. |
| Writes | Seven-byte short writes complete; zero-progress, partial-then-ENOSPC, immediate ENOSPC and EACCES fail/poison with **zero simulated broadcasts**; damaged final seal rejects inspection. |
| Required persistence barriers | File and directory EIO at store creation, wallet creation, acquisition and admission: **eight fault variants, zero simulated broadcasts**. A failed session cannot be reused/released. |
| Incomplete wallet creation | ENOSPC/EACCES opening the new journal leaves blocked incomplete state; recreation is refused. |
| Environment policy | Unsupported filesystem, non-Linux platform and broad state-directory permissions rejected. |
| Release failure | Unlink denial retains exclusion; final directory-fsync failure revokes the old capability; fresh acquisition establishes new barriers after durable CLOSE. Old timestamps never authorize takeover. |
| Real competing processes | Holder owns lock; second process refuses. SIGKILL holder, restart refuses, ownership bytes unchanged. Manual lock deletion still encounters OPEN marker and refuses. |
| Real clean restart | PREPARED operation ID survives new process; another allowance's attempted admission yields **zero simulated broadcasts**. |
| Real torn-write death | SIGKILL after first 37 bytes of OP update; inspection rejects corruption; restarted process refuses and counter remains zero. |
| Real durable-before-ack death | SIGKILL after OP file fsync before admission acknowledgment; new reader sees PREPARED, restart refuses uncertain ownership, counter remains zero. |

Development found two fixture issues: a seven-byte interrupted prefix could leave the old seal unchanged (the torn-write assertion now changes 37 bytes), and reading an already-consumed file descriptor missed the intended post-fsync checkpoint (the child now independently reads its `/proc/self/fd` path). The final tests assert the actual intended boundaries. Those early runs are not counted as passing evidence. Review additionally added the SUBMITTING recheck described above. This is not a change to the production broadcaster.

## 7. Validation commands and actual results

Existing tools: **Forge 1.7.1**, **solc 0.8.28+commit.7893614a**, **Node 24.19.0**, existing pinned npm dependencies. No install/upgrade or lockfile edits. Commands ran from repository root:

```sh
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge build --use /workspace/.allowance-tools/solc-0.8.28 --sizes
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test --use /workspace/.allowance-tools/solc-0.8.28 --fuzz-seed 0x5a2b2a -vv
ANVIL=/workspace/.allowance-tools/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil npm test --prefix mcp
node --test --test-isolation=none mcp/test/journal.test.js
npm test --prefix substrate
node script/spending-view.test.cjs
node --check mcp/journal.js
node --check mcp/journal-schema.js
node --check mcp/test/journal.test.js
node --check mcp/test/helpers/journal-process.mjs
/workspace/.allowance-tools/node_modules/@foundry-rs/forge-linux-amd64/bin/forge fmt --check
git diff --cached --check
```

| Check | Actual result |
|---|---|
| Foundry build | Exit **0**; production runtime 9,757 bytes; existing lint warnings retained. |
| Complete Foundry suite | **58 passed, 0 failed/skipped**, four suites; configured 1,000-run fuzz, invariant 128 runs / 16,384 calls / zero handler reverts. |
| Complete MCP suite | **61 passed, 0 failed/skipped/cancelled**, including all 42 existing tests and 19 new journal tests. Localhost fixtures only. |
| Focused journal runner | **19 passed, 0 failed/skipped/cancelled**; real process and disk-backed fault fixtures. |
| Native / display | **24 / 10 passed**, zero failed/skipped/cancelled. |
| Syntax | All four new JavaScript files pass `node --check`; existing Python build script parses successfully. |
| Frontend deterministic build | Existing `python3 build.py` executed in an isolated copy under `work/phase5a2b2a/build-copy/`, using the existing compiled Allowance artifact and symlinks to installed pinned build dependencies. Both simulation and native bundles rebuilt. Exit **0**; every output under copied `docs/` byte-identical to repository assets, **zero generated differences**. Real ABI/frontend assets were not rewritten. |
| Formatting | `forge fmt --check` exit **1** on pre-existing differences in unchanged `src/Allowance.sol`, `test/Allowance.t.sol`, `test/mocks/MockTokens.sol`. No formatting applied. |
| Whitespace and changed-file scope | Staged whitespace check passes; exactly the five files below, all additions. Existing production and generated files compare unchanged to base. |

Logs and disposable build copies stay under uncommitted `work/phase5a2b2a/`. The reproducible fault fixtures are committed as tests. No GitHub CI run is claimed: this branch is intentionally not pushed and no PR is opened in this task. Browser suites and live V3 RPC/finality were not exercised; frontend is unchanged and the new layer has no network API.

## 8. Compatibility, exact scope and next gates

Exactly these files are added:

1. `mcp/journal.js`
2. `mcp/journal-schema.js`
3. `mcp/test/journal.test.js`
4. `mcp/test/helpers/journal-process.mjs`
5. `docs/DURABLE-JOURNAL-VALIDATION-PHASE5A2B2A.md`

No existing tracked file changes. In particular: no Solidity, ABI, five-tool schema/response, `mcp/lib.js`, `mcp/index.js`, package manifest/lockfile, EIP-1559 formula, network/address/deployment configuration, frontend, generated website or CI edits. The npm package's existing `files` allowlist is deliberately unchanged: these inert modules are not yet shipped by that explicit package list. Future integration must review packaging rather than assume publication includes them. Existing untracked `lib/` and `work/` are excluded from the commit.

Before broadcaster integration:

1. **Review crash recovery and provisioning.** Define private persistent path/descriptor configuration, supported deployment storage and a deliberate offline recovery process. Demonstrate no unsafe lock deletion, no missing-state bootstrap, no second active capability and retained unresolved history. Establish backup/rollback and size-cap policy. Benefit: measurable recovery without silently trading safety for availability.
2. **Separate prepare/sign/durable SUBMITTING/send.** Derive the expected hash locally from the in-memory signed transaction, verify exact envelope and intent, fsync SUBMITTING before any network call, then make a bounded attempt. Preserve the current V3 type-2 fee calculation. Test actual sender call counts, process death and 429/redirect/socket-loss transport behavior. Benefit: every potentially sent transaction has a durable identity; simulated counters alone do not establish this.
3. **Implement bounded, keyless read-only reconciliation.** Validate chain/genesis, original/candidate transaction identity, canonical receipt/block observations, and exact action-specific events. Record replacements without overwriting the original hash, and retain partial refuel/pay progress. Test late callbacks cannot send after cancellation/deadline; no automatic retries or parent resume. Benefit: unresolved operations become observable without exposing signing keys or causing another payment.
4. **Test upgrade/runtime compatibility and legacy-writer exclusion.** Run the supported Node/OS/filesystem matrix, fault tests at actual signing/broadcast/result boundaries and separately authorized V3 read-only validation. Explicitly prohibit concurrent legacy/external writers; same host alone is insufficient if stores differ. Benefit: scope the coordination and finality claims to environments actually verified.

Remaining limitations include all external-writer and valid-rollback cases above, no independent finality evidence, no automatic damaged-journal recovery, no replacement resolver, no intent/invoice idempotency, and no retrospective recovery of legacy unknown hashes. None is repaired by increasing test counts or interpreting the absence of a receipt as failure. This foundation is ready for focused review, not an assurance that recoverable live payments have already been implemented.
