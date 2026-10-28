# Allowance — Phase 3A native Portaldot wallet feasibility

Date: 2026-10-28. **Read-only feasibility and design; no implementation, signing or broadcast.** This is internal analysis, not an independent audit. The testnet-only security and asset restrictions in [SECURITY.md](../SECURITY.md) continue to apply.

## Recommendation

**CONDITIONAL GO** for a separate native-wallet owner transport using the existing Allowance deployment. **NO-GO for enabling native signed writes now**, or claiming that a native account automatically controls an existing MetaMask-owned allowance. Current runtime metadata, value conversion, mapping costs, wallet payload compatibility and execution evidence must be verified first.

The Solidity design already accepts an owner through contract-visible `msg.sender`; it does not require MetaMask or an Ethereum transaction envelope. No contract/ABI change is indicated for an account whose authenticated native origin resolves to the correct H160. That conclusion is conditional on live `revive.call` support and restrictions; this phase could not verify signed-write compatibility. Existing MetaMask-owned accounts retain their original owner identity.

**First Phase 3B step:** build a separately scoped, read-only native connection/capability panel, with owner-write controls disabled. With permitted RPC access, capture the finalized chain identity, current metadata, selected account's resolved H160 and reverse mapping, units and callable signatures. Do not start with `mapAccount` or an approval transaction. A later, explicitly authorized small-value testnet write is required before claiming signed owner-operation compatibility.

## Baseline and evidence levels

- Fetched `main` matched **`4c5d305693ea3abc910a453ec20fcf07a80d2dcd`**.
- Feature branch: `codex/allowance-native-wallet-feasibility-phase3a`.
- Read: `substrate/check.mjs`, `substrate/README.md`, the Substrate dependency manifest/lockfile, `config/networks.json`, all owner paths in `src/Allowance.sol`, wallet/transaction logic in `web/index.src.html`, architecture, security policy, `docs/PROOF.md`, `docs/SOLIDITY-ON-PORTALDOT-V3.md`, and related README integration claims.
- This branch adds **only this report**. No source, ABI, generated website, dependency, configuration or address changes. No private key was requested, loaded or used. No wallet account permission request or signer call was made.

| Evidence level | What is established |
|---|---|
| Source verified | Solidity ownership/access rules; payable value requirements; existing EIP-1193/EIP-6963 wallet path; read-only Substrate script; declared dependencies and ABI encoding. |
| Historical repository observation | `substrate/README.md` records a 2026-10-25 read-only run on runtime `portaldot-v3` **3002**, genesis `0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd`. It reports `mapAccount`, `call` and the dry-run API present and reads account 0 from the deployer's fallback identity. This was not freshly repeated. |
| Locked SDK source verified | `@polkadot/api`, `api-base`, `api-augment`, `types` and `types-augment` **16.5.6** package archives were read from their lockfile URLs and SHA-512 integrity-checked against `substrate/package-lock.json`. No package installation or manifest change occurred. These are generic SDK definitions, not Portaldot runtime metadata. |
| Fresh local verification | The fallback-address script reproduces the documented SS58 address. ABI encode/decode round-trip of `setFrozen(0,true)` succeeds and agrees between the existing docs/MCP ABIs. No signer/provider was created for that check. |
| Fresh live runtime verification | **Blocked**, as described below. Current runtime version, metadata, mapping state, units and signed-write semantics remain unverified. |

### Exact RPC blocker

Read-only JSON-RPC POSTs were attempted through the configured proxy on 2026-10-28:

| Endpoint | Method | Actual result |
|---|---|---|
| `https://test-node-v3.portaldot.dev` (the HTTP counterpart used by `substrate/check.mjs`) | `system_chain` | `URLError: <urlopen error Tunnel connection failed: 403 Forbidden>` |
| `https://test-evm-rpc-v3.portaldot.dev` (`config/networks.json`) | `eth_chainId` | Same proxy CONNECT failure |

The selected environment's HTTP policy is restricted, has no Portaldot host rule, and grants no relevant direct TCP destination. This is an **environment access blocker**, not evidence that the endpoints or chain are down. No direct/VPN/alternate-site bypass was attempted. The configured WebSocket endpoint is `wss://test-node-v3.portaldot.dev`; its current reachability, browser CORS and subscription support were not verified.

Consequently, no current `state_getMetadata`, runtime-version/properties, balance, mapping, fee estimate or runtime dry-run response was obtained. There is no fresh proof that the current chain remains runtime 3002 or exposes the same APIs. The historical EVM payment proofs in `docs/PROOF.md` are not native signed `revive.call` proofs.

## Existing integration and dependency support

### What the repository implements

`substrate/check.mjs:27–65` initializes `ApiPromise` with `HttpProvider` or `WsProvider`, logs runtime/genesis identity, checks whether methods exist, resolves `reviveApi.address(who)`, queries `revive.originalAccount(h160)`, and dry-runs read calldata through:

```text
reviveApi.call(origin, contract, value, gasLimit, storageDepositLimit, data)
```

Its actual calls use **zero value** and `null` estimate limits. It decodes `r.result`, rejects an error or REVERT flag bit 0 and ABI-decodes returned data. It does not construct, estimate fees for, sign or submit an extrinsic. Its supplied origin may be any public address: a dry-run origin is not proof of key control. The zero-value read example proves neither nonzero-value unit conversion nor signed-write acceptance.

The dashboard instead discovers EVM providers through EIP-6963, calls `eth_requestAccounts`, creates `ethers.BrowserProvider`, obtains an Ethereum signer/H160, and reads `accountsOfOwner(S.me)` (`web/index.src.html:906–942`, `:1010`). The shared `send` helper at `:814–824` assumes an ethers transaction with `.wait()`. Owner forms call ethers contract methods, and native-POT input uses 18-decimal EVM amounts (`:1320–1371`). Native extension objects cannot simply be passed into this path or treated as Ethereum signers.

There is no native account discovery/signer bridge in `web/`, no browser Polkadot API bundle there, and no `@polkadot/extension-dapp` dependency in the Substrate lockfile. `substrate/` declares only `@polkadot/api` **16.5.6** and `ethers` **6.13.4**. The current environment did not have `substrate/node_modules`; inspection used integrity-checked source archives in scratch space, without installing them. No specific browser-wallet brand was verified to authorize/sign the required payload.

### What the pinned SDK can express — not a live-chain guarantee

Verified package locations below are paths inside the version-16.5.6 archives, not new repository files:

| Package source | Verified API/type |
|---|---|
| `api-augment/substrate/tx.d.ts`, `revive.call` | **Five dispatch arguments:** `dest: H160`, `value: Compact<u128>`, `gasLimit: WeightV2 {refTime,proofSize}`, `storageDepositLimit: Compact<u128>`, `data: Bytes`. The storage limit is **not Option** in this generic definition. |
| Same file, `revive.mapAccount` | No arguments; documentation says it registers the caller, takes a refundable mapping deposit, and errors for an already mapped origin or an Ethereum-native Address20. Actual Portaldot cost/error rules are unverified. |
| `api-augment/substrate/runtime.d.ts`, `reviveApi.call` | **Six simulation arguments:** `origin: AccountId32`, `dest: H160`, `value: u128`, optional `WeightV2`, optional storage `u128`, input bytes. This is not the dispatchable signature. |
| `api-augment/substrate/query.d.ts` | `originalAccount(H160)` returns `Option<AccountId32>` in the generic catalog. |
| `types-augment/lookup/types-substrate.d.ts` | Revive execution result has `gasConsumed`, `gasRequired` (WeightV2), `storageDeposit` (`Charge`/`Refund` u128), and `result: Result<ExecReturnValue,DispatchError>`; execution value contains `flags.bits` and `data`. |
| `api-augment/substrate/events.d.ts` | Generic `revive.ContractEmitted` contains `contract: H160`, `data: Bytes`, `topics: Vec<H256>`. Actual event availability/layout must be checked from current metadata. |
| `api-base/types/submittable.d.ts`; `types/types/extrinsic.d.ts` | `signAndSend(account,{signer,...},callback)`, `signAsync`, `paymentInfo`, `hasPaymentInfo`; signer interface supports structured `signPayload`; result includes `txHash`, status, events, dispatch/internal errors and transaction index. |

Notably, the generic `reviveApi` catalog inspected does **not** declare `address`, although the repository's historical script obtains it dynamically. This demonstrates why generic augmentations cannot replace actual runtime API inspection.

Before using a dispatchable, inspect `api.tx.revive.call.meta.args`, type IDs through the connected registry, and current runtime metadata. Likewise verify runtime API versions/parameters, storage type, event fields and signed extensions. Method presence alone does not establish that the runtime call filter, origin checks or weight/storage limits permit it. Never infer the signed call's parameter order by deleting/copying parameters from the dry-run example. Do not use `ethTransact` as a native signer shortcut: the generic SDK describes it as an Ethereum transaction wrapper that cannot be directly dispatched normally. The catalog also exposes `dispatchAsFallbackAccount`, but it is **not a verified ownership bridge** and is out of scope until its actual Portaldot implementation/semantics are established.

## Account mapping and owner identity

Solidity sets `a.owner = msg.sender` at `src/Allowance.sol:172`; `_owned` at `:133–136` compares the caller to that exact H160. There is no owner-transfer method. Agent rotation changes `agent`, not `owner`.

For the documented MetaMask owner:

```text
H160:       0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547
AccountId32: 0x1807dbe0e8d790e63c4b2a90b9a108afa14f8547eeeeeeeeeeeeeeeeeeeeeeee
SS58/42:    5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v
```

Running `python3 script/fallback_address.py 0x1807dbE0e8d790e63c4B2a90b9A108AfA14F8547` reproduced that representation locally. **Encoding an AccountId as SS58 does not create a signable native key or prove wallet control.** The default account in `check.mjs` is such a fallback representation, not evidence that an ordinary native wallet can sign for it.

An ordinary native account historically resolves to a derived H160 and registers the reverse association by mapping. That does not rewrite an existing Solidity owner or grant a caller the ability to choose another user's H160. Without verified identity equality and signer/runtime support, it must be treated as a **different owner**. Do not assume that using a similar address, matching display name, the same token balance, or even a related key representation makes Ethereum/native identities interchangeable.

| Question | Assessment |
|---|---|
| Can an arbitrary native account manage an existing MetaMask-owned allowance? | **No automatic path.** Its authenticated contract-visible H160 must equal the stored owner. Reading that owner's account list is public and proves no authority. |
| Can the displayed fallback SS58 be imported or selected to obtain ownership? | Not established; representation is not possession of a valid signer. No private-key import/export workaround is proposed. |
| Does `mapAccount` migrate ownership? | No such Solidity operation exists. Historical behavior describes address registration, not ownership migration. Current runtime derivation before/after mapping must still be verified. |
| Is `mapAccount` required? | Historically yes for ordinary AccountId32, and not for the fallback example. Query/verify current identity and mapping rather than applying this rule blindly. Mapping itself is a signed write and was not attempted. |
| Can the existing contract serve native owners? | Contract-level **yes**, by opening new accounts with the native origin's resolved H160, conditional on runtime signed-call compatibility. No new deployment is indicated. |
| Can an old owner move to a new native owner? | No direct owner transfer. A separately authorized migration would require the original owner to withdraw and a new allowance to be opened/funded under the new identity; pending requests/history would not migrate automatically. |

Mapping preflight must compare the **returned AccountId32 bytes** with the selected account, not merely `.isSome` as the diagnostic script does. `None`, query failure and a mapping to a different account are three different states. Normalize SS58 to account bytes before comparing; a prefix alone does not identify a chain. Handle the historically special fallback case only after its runtime behavior is verified. Stop on conflicts; do not silently remap, unmap or invoke fallback-dispatch helpers. After a permitted map operation, re-read mapping/address and verify expected identity before offering value-moving operations.

## Owner-operation feasibility matrix

All writes below are **conditional, not signed-write verified**. Runtime gating, identity checks, estimates and outcome verification apply to every row. Native funding is distinguished from owner authority.

| Operation | Contract/transport mapping | Required origin / attached value | Feasibility and success evidence |
|---|---|---|---|
| Connect native wallet | Authorize account discovery through an explicitly supported extension, obtain its signer handle | User permission to share accounts; no key export | New browser adapter required; account subscriptions and signer compatibility unverified. Connection alone is not account mapping or a transaction. |
| Read owned allowances | Resolve H160; `accountsOfOwner(h160)` then `getAccount(id)` via existing ABI | Public read; no owner signature | Historically reachable by runtime API; EVM read RPC is another possible transport when available. Recheck stored owner before writes. Unmapped users should not be charged just to inspect public data. |
| Create native-POT allowance | `openAccount(agentH160, ZeroAddress, name, rules, trustedH160s, deposit, gasSeed)` through `revive.call` | Native signer becomes owner H160; contract `msg.value = deposit + gasSeed` in EVM units | Reuse deployed contract. Validate agent differs from owner and is nonzero. Match `AccountOpened` owner/agent/asset plus funding/seed events. Keep agent-key provisioning separate from owner signing; no key was created here. |
| Fund native allowance | `fund(id,amount)` | **Any funder**, not necessarily owner; `msg.value = amount` | Check asset/id and value conversion. Match `Funded(id,from,amount)`. Funding creates no management right. ERC-20 funding would additionally need a token approval/call flow and is deferred. |
| Freeze/unfreeze | `setFrozen(id,bool)` | Stored owner; zero value | Match `FrozenSet` and refreshed state. Old requests can still be owner-approved; freezing does not recover wallet funds. |
| Rotate agent | `rotateAgent(id,newAgentH160)` | Stored owner; zero value | Match `AgentRotated`, refresh stored agent. Contract supports it; current dashboard has no dedicated rotation action. Does not change owner or invalidate old holds. |
| Approve / approve-and-trust | `approve(requestId,trustRecipient)` | Owner of request's account; zero attached value | Uses escrow, can execute despite freeze/expiry and does not consume autonomous period capacity. Match `RequestResolved(Approved)` **and** exact `Paid` recipient/amount against the original request. |
| Reject request | `reject(requestId)` | Owner of request's account; zero value | Match `RequestResolved(Rejected)`; no payout. It must still be pending. |
| Update rules | `setRules(id,rules)` | Stored owner; zero value | ABI uint128/uint64 bounds, period >= one hour, caps valid. Match `RulesUpdated` and current state. Use verified chain-time units for expiry. Fixed windows are not rolling limits. |
| Update trusted recipients | `setTrusted(id,H160s,bool)` | Stored owner; zero value | Match `TrustUpdated` for intended entries; batch is atomic. Native SS58 strings are not valid Solidity addresses. |
| Withdraw budget | `withdraw(id,amount,toH160)` | Stored owner; zero attached value | Match `Withdrawn` account/destination/amount and refreshed budget. Prefer the verified owner H160; for other native recipients verify where the H160 transfer credits funds, including reverse mapping, before offering SS58 destination conversion. |

No implementation change is needed inside the contract for these ABI methods. This does not mean current runtime filters or wallet signing already permit every call. A runtime denial is not solved by redeploying the same Solidity contract.

Locally verified selectors include `openAccount 0xd49d748f`, `fund 0xa65e2cfd`, `setFrozen 0x6b88ddaf`, `rotateAgent 0xf51f0544`, `approve 0x747442d3`, `reject 0xb8adaa11`, `setRules 0xd02ce0fb`, `setTrusted 0xcff59d40`, `withdraw 0x0ad58d2f`. The existing `docs/abi.json` encodes and round-trips `setFrozen(0,true)` identically to the existing MCP ABI. No calldata was submitted.

## Value, fees, weight and storage: mandatory gates

Keep three domains explicit:

1. **Solidity/EVM amounts:** current frontend uses 18-decimal native POT (`parseEther("1") = 1000000000000000000`) for budget/caps/deposit/gas seed. This was verified locally; it does not establish Substrate units.
2. **Native balances, transaction fees and storage limits:** obtain current chain properties/registry decimals, Balance type, reserve/hold rules and authoritative Revive value-conversion semantics. The generic SDK's u128/Compact<u128> types do not encode a decimal scale. A symbol of “POT” is not a conversion rule. Never copy an EVM wei amount into a native extrinsic balance field by assumption, and never rewrite ABI deposit/cap amounts to native units. Reject unrepresentable amounts rather than silently rounding. The actual conversion factor is **unverified**.
3. **Execution resource limits:** WeightV2 has `refTime` and `proofSize`; it is not a token amount and cannot be replaced by the dashboard's `eth_estimateGas` value or legacy gas-price formula. Obtain resource requirements from the actual runtime response and verify both dimensions/maxima.

Use a same-origin, same-calldata, same-value read-only runtime simulation at a recorded block where supported. Generic 16.5.6 output supplies `gasRequired`, `gasConsumed`, `storageDeposit` and result/flags. Confirm current types and whether estimator/call units agree before deriving limits. Distinguish `Charge` from `Refund`: a potential refund is not guaranteed available upfront. Apply bounded, displayed margins, current runtime maxima and an explicit owner-approved storage-deposit cap. In particular, the generic dispatch call requires a nonoptional compact storage cap, whereas the dry run permits `null` to estimate it. Do not copy `null` into a signed dispatch or treat zero as unlimited.

Check `hasPaymentInfo` and `paymentInfo(selectedAccount,options)` for the fully constructed extrinsic when supported. Source inspection confirms this fee path uses a **fake** signature locally to query transaction-payment information, not an injected wallet signature; no such query ran here. A fee estimate is not necessarily total required liquidity: also budget transferred native value, mapping hold where needed, storage charge, chain/account existential requirements, and existing freezes/holds/reserves. Verify spendable balance from current runtime types; do not equate a simple free-balance field with unrestricted spendability. Mapping deposit amount/refund rules, maximum weight, storage caps, native decimals and actual balances are all unverified now.

No historical ETH gas/storage cost from `PROOF.md` should be used as a native-extrinsic fee estimate. A fresh dry run still does not prove that a wallet can sign or the transaction will pass signed extensions and execute later.

## Proposed transaction flow (future Phase 3B only)

The flow below is a design contract, not executable integration code or proof of runtime compatibility.

1. **Select mode and authorize accounts.** Keep MetaMask/EVM and native sessions separate. On an explicit native-connect action, use a supported extension's documented account permission interface and structured signer. Record account bytes/type/source and subscribe to permission/account changes. No owner secret, seed phrase, imported private key or local owner keypair. The commonly used extension helper package is absent here; choose and review a bridge/browser bundle separately in Phase 3B, not by assuming `ApiPromise` discovers extensions.
2. **Validate chain and capabilities.** Obtain genesis, runtime `specName/specVersion/transactionVersion`, signed-extension list, metadata and node properties. Compare against the intended testnet identity; chain name or SS58 prefix alone is inadequate. Record snapshot/block/hash and ABI/contract identity; check deployed code when an approved RPC is available. Verify needed query/runtime API/dispatch/event types and subscription support. Unknown fields or wrong network disable writes.
3. **Resolve identity and mapping.** Query the selected account's contract-visible H160 and exact reverse mapping. Compare actual account owner to that H160. For an unmapped ordinary account, offer a separately described mapping transaction only after its cost and semantics are verified and the user explicitly authorizes it. Confirm mapping outcome and re-read identity before any subsequent owner call. No automatic mapping hidden inside a payment/approval.
4. **Build an immutable operation intent.** Capture network/genesis, runtime version, account bytes/H160, contract address, account/request ID, function/arguments, nominal amounts, native value conversion and withdrawal recipient. Encode calldata with the existing ethers `Interface`; wrap those bytes in a metadata-validated Revive dispatch. For the generic five-argument signature above, origin comes from the signed extrinsic, not an extra calldata argument. Never encode SS58 text in Solidity `address` fields.
5. **Preflight and estimate.** Read current owner/request status/budget/policy, run the exact read-only call and inspect both dispatch result and contract flags/data. Derive bounded weight/storage limits and native fee/liquidity requirements using verified units. Rebuild the intent if any safety-relevant input changes; do not silently increase deposit/value limits. The account's current ability to sign remains a separate prerequisite.
6. **Ask the wallet for this exact extrinsic.** The pinned SDK supports an injected `Signer.signPayload` path and structured fields including address, genesis, method, nonce, era, spec/transaction versions and signed extensions. Require supported structured signing; do not silently fall back to raw-message signing. Keep signer authority limited to the selected account. Recheck account/network/runtime/mapping before submission; cancel stale queued intents on change.
7. **Broadcast once and retain evidence.** Use the selected transport's documented API only after the signing step is authorized. Persist the Substrate extrinsic hash, intent fingerprint, nonce, runtime snapshot and available block/index data. A Substrate extrinsic hash is not automatically an Ethereum transaction hash. Disallow duplicate button submissions while an intent is unresolved.
8. **Observe inclusion and execution separately.** Correlate events to the exact block/extrinsic index/hash. Decode module errors with the matching runtime registry (`findMetaError` for module errors), then separately inspect any contract outcome/revert evidence. Only ABI-decode actual contract return/revert bytes; a SCALE dispatch error is not Solidity revert data. Missing historical revert bytes may require an explicitly best-effort diagnostic read, not an invented precise reason for the past transaction.
9. **Require finalization plus contract evidence.** Match the emitting contract, exact account/request/owner/recipient/amount as appropriate, and expected event/state change. For approvals require both Approved resolution and exact Paid data from the original request. Refresh state at the relevant chain context. If runtime event/outcome evidence is insufficient, report the result as unconfirmed rather than complete. Preserve SECURITY.md's nominal-versus-net token qualification.
10. **Handle uncertainty without resubmission.** Read-only status polling with backoff may resume observation; it must not sign or submit another transaction. Reconcile the original hash before a user initiates any replacement. Preserve uncertainty through disconnection/reload, pruning, reorg, dropped/invalid/usurped states and finality timeouts.

### SDK signer and provider caveats verified from source

In `api/submittable/createClass.js`, `signAndSend` chooses subscription tracking only when `api.hasSubscriptions` is true; otherwise it uses `author.submitExtrinsic`, yielding a hash rather than observed inclusion/execution. Therefore the repository's working HTTP read path is **not evidence of a working watch/finalization path**. Either verify browser WebSocket support or implement bounded block/finalized-head/event polling for HTTP. A nonce advance alone is not proof that this exact extrinsic executed.

The same source accepts externally signed-transaction results only when `withSignedTransaction` is enabled. If enabling that feature, explicitly use `allowCallDataAlteration: false`: this version's implementation defaults that option to true, and the inspected validation checks method bytes when disabled, not every wallet-displayed field. Prefer the simpler structured signature path unless another mode is required and separately reviewed; verify signer/intent/network/nonce semantics rather than trusting a generic “SDK validates everything” statement. No signer was invoked in this phase.

### User-visible status model

| State | What may be claimed |
|---|---|
| Prepared / estimated | Unsigned intent and advisory estimate only; no transaction execution. |
| Awaiting wallet | User authorization pending; do not claim a signature exists. |
| Signed | Only if observed; signature is not broadcast or execution. `signAndSend` may combine steps, so do not invent an unobserved stage. |
| Broadcast / hash obtained | Submitted to a node; outcome unknown. |
| Included | Found in a block; may still be retracted, dispatch-failed or contract-reverted. |
| Finalized | Inclusion finality observed; **not by itself contract success**. |
| Contract execution verified | Dispatch/outcome checks, matching operation-specific contract events and relevant state agree. Show completed only with the chosen finalization policy satisfied. |
| Rejected / reverted / uncertain | Distinguish wallet rejection before signing, runtime rejection, contract revert and unknown outcome. A connection error after signing/submission does not prove that nothing was sent. |

Current generic SDK event support includes `revive.ContractEmitted(contract,data,topics)`, but current Portaldot semantics and whether contract reverts become dispatch failure or another outcome are unverified. Do not assume `system.ExtrinsicSuccess`, an included/finalized status, or a resolved Promise alone is a completed owner operation.

Repeated `fund`, `openAccount` or value transfer under a new nonce can duplicate effects. Repeated approval/rejection of the same request normally hits `NotPending` after resolution, but can still incur fees; that is not permission to retry blindly. Even logically idempotent freeze/rule writes have fees and concurrency implications.

## Keeping MetaMask and simulation unchanged

Use a new native owner-transport boundary alongside the existing EVM backend. Keep ABI encoding/read models reusable, but do not replace the existing provider/signature path with an SS58-shaped ethers signer. `S.me` currently means H160 and is used in reads, default trusted recipients and withdrawals; native mode needs distinct `accountId32` and `ownerH160` fields. Reusing the same string would be unsafe.

The existing EVM `send` helper expects `.wait()` and shows “done” after it resolves. A native adapter needs an explicitly normalized outcome/evidence model; do not fabricate an ethers-like receipt from a Substrate hash just to satisfy that helper. Limit any later shared seam to selecting the transport and presenting its verified result, leaving MetaMask signing, network-switch handling and simulation behavior intact.

Native RPC/mapping failures must not trigger the existing “no contract code” deployment fallback or change the configured address. Clear native signer handles, subscriptions and cached estimates on disconnect/account/runtime changes; namespace persisted mode/identity by genesis, contract and account, without persisting secrets. Unknown data must remain unavailable, not zero balance, “unmapped” or success. Testnet labeling and the current security limits remain explicit.

## Phase 3B gates and minimal plan

1. **Read-only capability/identity panel first:** obtain permitted runtime RPC access, current metadata/properties, reverse mapping and deployed-code identity; pin a supported runtime snapshot and show both identities. Keep every native write disabled. Do not modify `check.mjs`'s historical claims in this phase.
2. **Review the browser extension bridge and bundle:** current browser assets contain ethers, not a native signer SDK bundle. Select exact supported wallet/account types and minimal packaging changes in a separate implementation scope; test permission rejection, removal, account changes and unsupported signer interfaces. No new dependency was added here.
3. **Metadata/unit/estimation adapter:** verify live signed-call order/types, `mapAccount` requirements/cost, actual value conversion, WeightV2/storage/fee estimates and usable balance. Define explicit unknown/error states and upgrade invalidation. Generic SDK types alone do not close these gates.
4. **Later authorized native write validation:** on a controlled small-budget testnet account, first validate mapping if necessary and a low-risk zero-value owner call on a native-owned allowance. This requires an owner-created account and separately authorized writes; it was not attempted here. Then verify small nonzero creation/funding/withdrawal units and exact events. Do not label a successful dry run as completion of this step.
5. **Expand owner operations and regress existing modes:** cover approvals, rejection, rotation, rules/trust changes, freeze/expiry/stale-request semantics, wrong-owner/native-vs-MetaMask cases, finalization/retractions, RPC outages and no automatic retries. Preserve MetaMask and browser simulation regression coverage before enabling the native option generally.

**Critical blockers:** fresh RPC access; current runtime metadata/filter/identity semantics; native/EVM value conversion and cost bounds; a verified browser account/signer bridge; signed-write execution and event/finality validation. Existing deployment is **conditionally reusable** with no indicated Solidity/ABI change. Arbitrary MetaMask-owner migration, production-fund readiness and all-wallet support are **not** established.

## Verification performed and limits

- Exact Git baseline checked and dedicated report branch created.
- Two permitted read-only endpoint attempts failed at proxy CONNECT with 403; no current runtime result is claimed.
- Read the existing Substrate read script, contract, wallet code, prior proofs and security guidance.
- Retrieved only the five already locked 16.5.6 Polkadot SDK source archives from their recorded npm URLs, verified each SHA-512 integrity value, and inspected signatures, result types, signer and subscription behavior. Scratch archives/sources are not committed; no installation or dependency edit occurred.
- Reproduced the documented fallback SS58 with the existing Python script. Ran a pure ethers ABI encode/decode comparison using existing dependencies; no provider, key or signer was created.
- Existing offline repository check: `python3 script/check_submission.py --offline` — **19 passed, 0 failed, 4 manual TODOs**. Report link/fence and whitespace checks passed.
- No native browser wallet was connected; no signature, mapping write, owner write, broadcast or deployment took place. Foundry/MCP suites were not rerun for this report-only change and would not establish native-wallet compatibility. Only this report is committed; `main` and application files remain unchanged.
