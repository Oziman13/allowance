// Operator-local, keyless and read-only, including the filesystem. No signer,
// provider send API, journal writer, lock cleanup or unconfigured endpoint.
import * as fs from "node:fs";
import { performance } from "node:perf_hooks";
import { ethers } from "ethers";
import { openReader, JournalError } from "./journal.js";
import { keys, id, address, hash, integer, binding, canonical } from "./journal-schema.js";
import { localRpc, loopbackUrl, LocalRpcError } from "./local-rpc.js";

const iface = new ethers.Interface(JSON.parse(fs.readFileSync(new URL("./abi.json", import.meta.url))));
const READS = new Set(["eth_chainId", "web3_clientVersion", "eth_getBlockByNumber", "eth_getCode", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_call"]);
export const CONFIRMATION_POLICY = Object.freeze({ name: "ANVIL_CANONICAL_V1", confirmations: 1, independentV3Finality: false, trust: "CONFIGURED_LOCAL_RPC" });
export class ReconciliationError extends Error {
  constructor(code) { super(code); this.name = "ReconciliationError"; this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new ReconciliationError(code); };
const safeCode = e => e instanceof ReconciliationError || e instanceof JournalError || e instanceof LocalRpcError ? e.code : "MALFORMED_EVIDENCE";
const qty = v => { requireThat(typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v) && v.length <= 66, "MALFORMED_EVIDENCE"); return BigInt(v); };
const h160 = v => { requireThat(typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v), "MALFORMED_EVIDENCE"); return v.toLowerCase(); };
const hex = v => { requireThat(typeof v === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(v), "MALFORMED_EVIDENCE"); return v.toLowerCase(); };
const h256 = v => { hash(v); return v; };
// RPC implementations may encode signature scalars as unpadded quantities.
// Numeric normalization is safe only with the reconstructed signed-hash check.
const scalar = v => { requireThat(typeof v === "string" && /^0x[0-9a-f]{1,64}$/.test(v), "TRANSACTION_IDENTITY"); return ethers.toBeHex(BigInt(v), 32); };
function envelope(v, expectedHash) {
  requireThat(v && v.hash === expectedHash && qty(v.type) === 2n && qty(v.chainId) === 31337n, "TRANSACTION_IDENTITY");
  const nonce = qty(v.nonce); requireThat(nonce <= BigInt(Number.MAX_SAFE_INTEGER), "TRANSACTION_IDENTITY");
  const parity = qty(v.yParity ?? v.v); requireThat(parity === 0n || parity === 1n, "TRANSACTION_IDENTITY");
  const tx = ethers.Transaction.from({ type: 2, chainId: 31337n, nonce: Number(nonce), to: h160(v.to), value: qty(v.value), data: hex(v.input),
    gasLimit: qty(v.gas), maxFeePerGas: qty(v.maxFeePerGas), maxPriorityFeePerGas: qty(v.maxPriorityFeePerGas), accessList: v.accessList,
    signature: { r: scalar(v.r), s: scalar(v.s), yParity: Number(parity) } });
  requireThat(tx.hash === expectedHash && tx.from?.toLowerCase() === h160(v.from), "TRANSACTION_IDENTITY");
  const included = v.blockHash !== null;
  if (included) { h256(v.blockHash); qty(v.blockNumber); qty(v.transactionIndex); }
  else requireThat(v.blockNumber === null && v.transactionIndex === null, "RECEIPT_CONFLICT");
  return { tx, included, blockHash: v.blockHash, blockNumber: v.blockNumber, index: v.transactionIndex };
}
function exactCall(tx, intent, child) {
  const s = child.spec, t = s.transaction;
  requireThat(tx.from.toLowerCase() && tx.to.toLowerCase() === intent.contract && tx.value === 0n && tx.accessList?.length === 0
    && String(tx.nonce) === t.nonce && tx.gasLimit === BigInt(t.gasLimit) && tx.maxFeePerGas === BigInt(t.maxFeePerGas)
    && tx.maxPriorityFeePerGas === BigInt(t.maxPriorityFeePerGas) && ethers.keccak256(tx.data) === t.calldataHash, "TRANSACTION_IDENTITY");
  const parsed = iface.parseTransaction({ data: tx.data });
  requireThat(parsed && parsed.name === ({ pay: "pay", refuel: "refuel", cancel: "cancel" })[s.kind], "CALLDATA_IDENTITY");
  if (s.kind === "cancel") requireThat(String(parsed.args[0]) === s.requestId, "CALLDATA_IDENTITY");
  else {
    requireThat(String(parsed.args[0]) === intent.accountId, "CALLDATA_IDENTITY");
    if (s.kind === "refuel") requireThat(String(parsed.args[1]) === s.amountRaw, "CALLDATA_IDENTITY");
    else requireThat(h160(parsed.args[1]) === s.recipient && String(parsed.args[2]) === s.amountRaw
      && ethers.keccak256(ethers.toUtf8Bytes(parsed.args[3])) === s.memoHash, "CALLDATA_IDENTITY");
  }
}

export function createLocalReconciler(options) {
  let endpoint, reader, wallet;
  try {
    keys(options, ["mode", "rpcUrl", "contract", "accountId", "expectedCodeHash", "state", "wallet", ...(Object.hasOwn(options, "io") ? ["io"] : [])]);
    requireThat(options.mode === "anvil-journal", "LOCAL_MODE_REQUIRED"); endpoint = loopbackUrl(options.rpcUrl);
    address(options.contract); integer(options.accountId); hash(options.expectedCodeHash);
    keys(options.state, ["stateDir", "storeId"]); keys(options.wallet, ["journalId", "binding"]); id(options.wallet.journalId); binding(options.wallet.binding);
    requireThat(options.wallet.binding.chainId === "31337", "ANVIL_CHAIN_REQUIRED");
    wallet = structuredClone(options.wallet); reader = openReader({ ...options.state, io: options.io ?? fs });
  } catch (e) { throw new ReconciliationError(safeCode(e)); }
  const contract = options.contract, accountId = options.accountId, expectedCodeHash = options.expectedCodeHash;
  const inspect = () => {
    const view = reader.inspect(wallet);
    return { ...view, operations: view.operations.filter(o => o.intent.contract === contract && o.intent.accountId === accountId) };
  };
  const select = (operationId, childId) => {
    id(operationId); id(childId);
    const o = inspect().operations.find(o => o.operationId === operationId); requireThat(o, "UNKNOWN_OPERATION");
    const c = o.children.find(c => c.childId === childId); requireThat(c, "UNKNOWN_CHILD");
    requireThat(o.intent.asset === ethers.ZeroAddress, "UNSUPPORTED_ASSET"); return { o, c };
  };
  async function reconcile(operationId, childId, control = {}) {
    // This snapshot is the sole source of financial identity, never RPC/caller arguments.
    const { o, c } = select(operationId, childId);
    keys(control, ["timeoutMs", "pollMs", "maxPolls", "replacementHash", "signal"].filter(k => Object.hasOwn(control, k)));
    const timeoutMs = control.timeoutMs ?? 5000, pollMs = control.pollMs ?? 100, maxPolls = control.maxPolls ?? 12;
    const knownCandidate = c.evidence?.replacement?.candidateHash ?? null, candidateHash = control.replacementHash ?? knownCandidate;
    requireThat(!knownCandidate || candidateHash === knownCandidate, "MULTIPLE_REPLACEMENTS_UNSUPPORTED");
    requireThat(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 60000 && Number.isInteger(pollMs) && pollMs >= 10 && pollMs <= 5000
      && Number.isInteger(maxPolls) && maxPolls >= 1 && maxPolls <= 100 && (control.signal === undefined || control.signal instanceof AbortSignal), "INVALID_CONTROL");
    if (candidateHash !== null) { hash(candidateHash); requireThat(candidateHash !== c.transactionHash, "INVALID_REPLACEMENT"); }
    const start = performance.now(), startedAt = new Date().toISOString(), deadline = start + timeoutMs, aborter = new AbortController();
    let reason = null, polls = 0, observedAt = null, lastObservation = null, head = null, result, replacement = null;
    const stop = code => { reason ??= code; aborter.abort(); }, external = control.signal;
    const cancel = () => stop("CANCELLED"); external?.addEventListener("abort", cancel, { once: true }); if (external?.aborted) cancel();
    const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    const active = () => { if (performance.now() >= deadline) stop("TIMEOUT"); requireThat(!aborter.signal.aborted, reason ?? "CANCELLED"); };
    const rpc = (method, params) => { requireThat(READS.has(method), "READ_ONLY_RPC"); return localRpc(endpoint, method, params, { signal: aborter.signal, active }); };
    const call = async (name, args, block) => iface.decodeFunctionResult(name, await rpc("eth_call", [{ to: contract, data: iface.encodeFunctionData(name, args) }, block]));
    const context = async () => {
      requireThat(qty(await rpc("eth_chainId", [])) === 31337n && /^anvil\b/i.test(await rpc("web3_clientVersion", [])), "NETWORK_IDENTITY");
      requireThat((await rpc("eth_getBlockByNumber", ["0x0", false]))?.hash === wallet.binding.genesisHash, "NETWORK_IDENTITY");
      requireThat(ethers.keccak256(hex(await rpc("eth_getCode", [contract, "latest"]))) === expectedCodeHash, "CONTRACT_IDENTITY");
    };
    const stable = () => {
      const now = select(operationId, childId);
      requireThat(canonical(now.o.intent) === canonical(o.intent) && canonical(now.c.spec) === canonical(c.spec) && now.c.transactionHash === c.transactionHash, "JOURNAL_CHANGED");
      return now.c;
    };
    async function receiptEvidence(env, receipt, expectedHash, checkEvents) {
      requireThat(receipt && receipt.transactionHash === expectedHash && env.included && receipt.blockHash === env.blockHash
        && receipt.blockNumber === env.blockNumber && receipt.transactionIndex === env.index && h160(receipt.from) === wallet.binding.wallet
        && h160(receipt.to) === env.tx.to.toLowerCase() && qty(receipt.type) === 2n, "RECEIPT_CONFLICT");
      const status = qty(receipt.status); requireThat(status === 0n || status === 1n, "RECEIPT_CONFLICT");
      requireThat(Array.isArray(receipt.logs) && receipt.logs.length <= 1000, "MALFORMED_EVIDENCE");
      const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
      const blockMatches = b => b?.hash === receipt.blockHash && b.number === receipt.blockNumber && Array.isArray(b.transactions)
        && b.transactions[Number(qty(receipt.transactionIndex))] === expectedHash;
      requireThat(blockMatches(block), "CANONICAL_CONFLICT");
      let outcome = null, event = null;
      const relevant = [], indexes = new Set();
      for (const log of receipt.logs) {
        requireThat(log.transactionHash === expectedHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber
          && log.transactionIndex === receipt.transactionIndex && log.removed === false, "RECEIPT_CONFLICT");
        const index = String(qty(log.logIndex)); requireThat(!indexes.has(index), "RECEIPT_CONFLICT"); indexes.add(index);
        requireThat(Array.isArray(log.topics) && log.topics.length <= 4, "MALFORMED_EVIDENCE"); log.topics.forEach(h256); hex(log.data); h160(log.address);
        if (h160(log.address) === contract) {
          const parsed = iface.parseLog(log);
          if (parsed && ["Paid", "PaymentHeld", "Refueled", "RequestResolved"].includes(parsed.name)) relevant.push({ parsed, log, index });
        }
      }
      if (status === 0n) requireThat(receipt.logs.length === 0, "RECEIPT_CONFLICT");
      else if (checkEvents) {
        requireThat(relevant.length === 1, "EVENT_MISMATCH");
        const { parsed: e, log, index } = relevant[0], s = c.spec;
        requireThat(String(e.args.accountId) === o.intent.accountId, "EVENT_MISMATCH");
        const [account] = await call("getAccount", [o.intent.accountId], receipt.blockNumber);
        requireThat(account.asset === o.intent.asset, "EVENT_MISMATCH"); // No present-agent check after rotation.
        let requestId = null, holdReason = null;
        if (s.kind === "pay") {
          requireThat(["Paid", "PaymentHeld"].includes(e.name) && h160(e.args.to) === s.recipient && String(e.args.amount) === s.amountRaw
            && ethers.keccak256(ethers.toUtf8Bytes(e.args.memo)) === s.memoHash, "EVENT_MISMATCH");
          outcome = e.name === "Paid" ? "PAID" : "HELD";
          if (outcome === "HELD") {
            requestId = String(e.args.requestId); holdReason = Number(e.args.reason);
            requireThat([1, 2, 3].includes(holdReason), "EVENT_MISMATCH");
            const [r] = await call("getRequest", [requestId], receipt.blockNumber);
            requireThat(String(r.accountId) === o.intent.accountId && h160(r.to) === s.recipient && String(r.amount) === s.amountRaw
              && ethers.keccak256(ethers.toUtf8Bytes(r.memo)) === s.memoHash && Number(r.reason) === holdReason
              && BigInt(r.createdAt) === qty(block.timestamp), "REQUEST_IDENTITY");
          }
        } else if (s.kind === "refuel") {
          requireThat(e.name === "Refueled" && h160(e.args.agent) === wallet.binding.wallet && String(e.args.amount) === s.amountRaw, "EVENT_MISMATCH"); outcome = "REFUELED";
        } else {
          requireThat(e.name === "RequestResolved" && String(e.args.requestId) === s.requestId && Number(e.args.status) === 4, "EVENT_MISMATCH");
          requestId = s.requestId;
          const [r] = await call("getRequest", [requestId], receipt.blockNumber);
          requireThat(String(r.accountId) === o.intent.accountId && Number(r.status) === 4, "REQUEST_IDENTITY"); outcome = "CANCELLED";
        }
        event = { name: e.name, logIndex: index, requestId, reason: holdReason, commitment: ethers.keccak256(ethers.concat([...log.topics, log.data])) };
      }
      requireThat(ethers.keccak256(hex(await rpc("eth_getCode", [contract, receipt.blockNumber]))) === expectedCodeHash, "CONTRACT_IDENTITY");
      const latest = await rpc("eth_getBlockByNumber", ["latest", false]); h256(latest?.hash);
      requireThat(qty(latest.number) >= qty(receipt.blockNumber) && (latest.number !== receipt.blockNumber || latest.hash === receipt.blockHash), "CANONICAL_CONFLICT");
      // Re-read both receipt and canonical block after event/request collection.
      const again = await rpc("eth_getTransactionReceipt", [expectedHash]);
      requireThat(canonical(again) === canonical(receipt) && blockMatches(await rpc("eth_getBlockByNumber", [receipt.blockNumber, false])), "CANONICAL_CONFLICT");
      active(); head = { hash: latest.hash, number: String(qty(latest.number)) };
      return { observation: status === 1n ? "CONFIRMED" : "REVERTED", outcome, event,
        receipt: { transactionHash: expectedHash, blockHash: receipt.blockHash, blockNumber: String(qty(receipt.blockNumber)), status: Number(status) } };
    }
    async function candidate() {
      replacement = { originalHash: c.transactionHash, candidateHash, classification: "UNVERIFIED", verified: false, receipt: null };
      const v = await rpc("eth_getTransactionByHash", [candidateHash]); if (!v) return;
      const env = envelope(v, candidateHash), tx = env.tx;
      requireThat(tx.from.toLowerCase() === wallet.binding.wallet && String(tx.nonce) === c.spec.transaction.nonce, "REPLACEMENT_IDENTITY");
      replacement.classification = tx.to.toLowerCase() === tx.from.toLowerCase() && tx.value === 0n && tx.data === "0x" ? "CANCELLATION"
        : tx.to.toLowerCase() === contract && tx.value === 0n && ethers.keccak256(tx.data) === c.spec.transaction.calldataHash
          && tx.gasLimit === BigInt(c.spec.transaction.gasLimit) && tx.accessList?.length === 0 ? "EQUIVALENT_CALL" : "DIFFERENT_CALL";
      const receipt = await rpc("eth_getTransactionReceipt", [candidateHash]);
      if (receipt) {
        const evidence = await receiptEvidence(env, receipt, candidateHash, replacement.classification === "EQUIVALENT_CALL");
        replacement.verified = true; replacement.receipt = evidence.receipt;
      }
    }
    try {
      active();
      if (!c.transactionHash) result = { observation: c.state === "NOT_SUBMITTED" ? "NOT_SUBMITTED" : "UNKNOWN", reason: "NO_SIGNED_HASH" };
      else {
        await context();
        while (polls < maxPolls) {
          active(); stable(); polls++;
          let raw = await rpc("eth_getTransactionByHash", [c.transactionHash]);
          const receipt = await rpc("eth_getTransactionReceipt", [c.transactionHash]);
          // Inclusion can occur between the two reads. Refresh the same hash,
          // never a nonce-selected transaction or a new business submission.
          if (receipt && (!raw || raw.blockHash === null)) raw = await rpc("eth_getTransactionByHash", [c.transactionHash]);
          const env = raw ? envelope(raw, c.transactionHash) : null;
          if (env) { requireThat(env.tx.from.toLowerCase() === wallet.binding.wallet, "TRANSACTION_IDENTITY"); exactCall(env.tx, o.intent, c); }
          if (candidateHash) {
            await candidate(); result = { observation: "RECOVERY_REQUIRED", reason: "REPLACEMENT_OBSERVED" }; break;
          }
          if (receipt && env) { result = await receiptEvidence(env, receipt, c.transactionHash, true); break; }
          if (qty(await rpc("eth_getTransactionCount", [wallet.binding.wallet, "latest"])) > BigInt(c.spec.transaction.nonce) && !["CONFIRMED", "REVERTED"].includes(c.state)) {
            result = { observation: "RECOVERY_REQUIRED", reason: "NONCE_ADVANCED_WITHOUT_COMPLETE_EVIDENCE" }; break;
          }
          result = { observation: env && !env.included && !receipt ? "PENDING" : "UNKNOWN", reason: "MISSING_EVIDENCE" };
          observedAt = new Date().toISOString(); lastObservation = { ...result, observedAt };
          if (polls >= maxPolls) { result.reason = "POLL_LIMIT"; break; }
          await new Promise((resolve, reject) => {
            const cancelWait = () => { clearTimeout(t); aborter.signal.removeEventListener("abort", cancelWait); reject(new ReconciliationError(reason ?? "CANCELLED")); };
            const t = setTimeout(() => { aborter.signal.removeEventListener("abort", cancelWait); resolve(); }, Math.min(pollMs, Math.max(1, deadline - performance.now())));
            aborter.signal.addEventListener("abort", cancelWait, { once: true }); if (aborter.signal.aborted) cancelWait();
          });
        }
      }
      active(); stable(); active();
      if (["CONFIRMED", "REVERTED", "RECOVERY_REQUIRED"].includes(result.observation)) observedAt = new Date().toISOString();
    } catch (e) {
      const code = reason ?? safeCode(e);
      result = { observation: ["TIMEOUT", "CANCELLED", "RPC_ERROR", "RPC_TRANSPORT", "ABORTED", "HTTP_429", "HTTP_STATUS"].includes(code) ? "UNKNOWN" : "RECOVERY_REQUIRED", reason: code };
    } finally {
      clearTimeout(timer); external?.removeEventListener("abort", cancel); aborter.abort();
    }
    const finishedAt = new Date().toISOString();
    let recorded = c;
    try { recorded = stable(); } catch { result = { observation: "RECOVERY_REQUIRED", reason: "JOURNAL_CHANGED" }; }
    if (["CONFIRMED", "REVERTED"].includes(recorded.state) && ["CONFIRMED", "REVERTED"].includes(result.observation)
        && (recorded.state !== result.observation || recorded.outcome !== result.outcome || canonical(recorded.receipt) !== canonical(result.receipt))) {
      result = { observation: "RECOVERY_REQUIRED", reason: "HISTORICAL_CONTRADICTION", conflictingObservation: result };
    }
    const evidence = { policy: CONFIRMATION_POLICY.name, observedAt: finishedAt, head, event: result.event ?? null, replacement };
    return { operationId, childId, transactionHash: c.transactionHash, recordedState: recorded.state, recordedOutcome: recorded.outcome,
      recordedReceipt: recorded.receipt, observation: result.observation, outcome: result.outcome ?? null, receipt: result.receipt ?? null,
      reason: result.reason ?? null, replacement, evidence, policy: CONFIRMATION_POLICY,
      conflictingObservation: result.conflictingObservation ?? null,
      freshness: { startedAt, observedAt, finishedAt, lastObservation }, polls, timedOut: reason === "TIMEOUT" };
  }
  return Object.freeze({ inspect, reconcile });
}
