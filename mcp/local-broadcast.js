// Explicitly imported experimental Anvil adapter; never imported by lib.js/index.js.
import * as fs from "node:fs";
import { performance } from "node:perf_hooks";
import { ethers } from "ethers";
import { openStore, JournalError } from "./journal.js";
import { keys, address, hash, integer, binding, intent as validateIntent } from "./journal-schema.js";
import { localRpc, loopbackUrl, LocalRpcError } from "./local-rpc.js";
import { confirmLocalOperation } from "./local-confirm.js";

const ABI = JSON.parse(fs.readFileSync(new URL("./abi.json", import.meta.url), "utf8"));
const iface = new ethers.Interface(ABI), TIP = 1_000_000_000n;
export class LocalBroadcastError extends Error {
  constructor(code, details = {}) { super(code); this.name = "LocalBroadcastError"; Object.assign(this, { code }, details); }
}
const fail = code => { throw new LocalBroadcastError(code); };
function quantity(v) {
  if (typeof v !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v) || v.length > 66) fail("RPC_QUANTITY");
  return BigInt(v);
}
const safeCode = e => e instanceof LocalBroadcastError || e instanceof LocalRpcError || e instanceof JournalError ? e.code : "LOCAL_FAILURE";
const reason = code => code === "TIMEOUT" ? "TIMEOUT" : code === "CANCELLED" ? "MANUAL_REVIEW" : "RPC_UNAVAILABLE";
const change = (state, transactionHash, reasonCode = null) => ({ state, transactionHash, outcome: null, receipt: null, reasonCode });

export function createLocalBroadcastAdapter(options) {
  let endpoint, signer, store, descriptor;
  try {
    keys(options, ["mode", "rpcUrl", "key", "contract", "accountId", "expectedCodeHash", "state", "wallet", ...(Object.hasOwn(options, "io") ? ["io"] : [])]);
    if (options.mode !== "anvil-journal") fail("LOCAL_MODE_REQUIRED");
    endpoint = loopbackUrl(options.rpcUrl); address(options.contract); integer(options.accountId); hash(options.expectedCodeHash);
    keys(options.state, ["stateDir", "storeId"]); keys(options.wallet, ["journalId", "binding"]); binding(options.wallet.binding);
    if (options.wallet.binding.chainId !== "31337") fail("ANVIL_CHAIN_REQUIRED");
    signer = new ethers.Wallet(options.key); // Offline: no provider, ENS or sendTransaction.
    if (signer.address.toLowerCase() !== options.wallet.binding.wallet) fail("WALLET_IDENTITY");
    descriptor = structuredClone(options.wallet); store = openStore({ ...options.state, io: options.io ?? fs });
  } catch (e) { throw new LocalBroadcastError(safeCode(e)); }
  // Retain only the immutable context needed below, not the caller's mutable config.
  const contract = options.contract, accountId = options.accountId, codeHash = options.expectedCodeHash;
  const confirmationContext = { mode: options.mode, rpcUrl: options.rpcUrl, contract, accountId, expectedCodeHash: codeHash,
    state: structuredClone(options.state), wallet: structuredClone(descriptor), ...(options.io ? { io: options.io } : {}) };
  async function pay(input, control = {}) {
    let intent, memo, timeoutMs, external;
    try {
      keys(input, ["recipient", "amountRaw", "memo"]); address(input.recipient); integer(input.amountRaw, true, 128);
      if (typeof input.memo !== "string" || ethers.toUtf8Bytes(input.memo).length > 140) fail("INVALID_MEMO");
      memo = input.memo;
      intent = { kind: "pay", contract, accountId, asset: ethers.ZeroAddress, recipient: input.recipient, amountRaw: input.amountRaw,
        memoHash: ethers.keccak256(ethers.toUtf8Bytes(memo)), requestId: null };
      validateIntent(intent); // Before acquiring ownership or creating an operation.
      keys(control, [...(Object.hasOwn(control, "timeoutMs") ? ["timeoutMs"] : []), ...(Object.hasOwn(control, "signal") ? ["signal"] : [])]);
      timeoutMs = control.timeoutMs ?? 5000; external = control.signal;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60000 || external !== undefined && !(external instanceof AbortSignal)) fail("INVALID_CONTROL");
    } catch (e) { throw new LocalBroadcastError(safeCode(e), { state: "BLOCKED", broadcastAttempted: false }); }
    const controller = new AbortController(), deadline = performance.now() + timeoutMs;
    let terminal = false, terminalCode = null, session, operation, childId, transactionHash = null;
    let submitting = false, attempted = false, journalState = null, failure, result, persistenceFailed = false;
    const stop = code => { if (!terminalCode) terminalCode = code; controller.abort(); };
    const cancelled = () => stop("CANCELLED");
    external?.addEventListener("abort", cancelled, { once: true }); if (external?.aborted) cancelled();
    const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    const active = () => {
      if (!terminalCode && performance.now() >= deadline) stop("TIMEOUT");
      if (terminal || controller.signal.aborted) fail(terminalCode ?? "CANCELLED");
    };
    const bounded = promise => new Promise((resolve, reject) => {
      let ended = false;
      const finish = (fn, value) => { if (ended) return; ended = true; controller.signal.removeEventListener("abort", abort); fn(value); };
      const abort = () => finish(reject, new LocalBroadcastError(terminalCode ?? "CANCELLED"));
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) abort();
      Promise.resolve(promise).then(v => { if (!ended) { try { active(); finish(resolve, v); } catch (e) { finish(reject, e); } } }, e => finish(reject, e));
    });
    const rpc = (method, params, authorize) => localRpc(endpoint, method, params, { signal: controller.signal, active, authorize });
    const transition = (state, why = null) => {
      const o = session.transition(operation.operationId, childId, change(state, transactionHash, why)); journalState = o.children.at(-1).state;
    };
    try {
      active(); session = store.acquire(descriptor); active();
      if (store.inspect(descriptor).operations.some(o => o.status === "OPEN")) fail("UNRESOLVED_OPERATION");
      const chain = quantity(await rpc("eth_chainId", []));
      const client = await rpc("web3_clientVersion", []), genesis = await rpc("eth_getBlockByNumber", ["0x0", false]);
      if (chain !== 31337n || typeof client !== "string" || !/^anvil\b/i.test(client) || genesis?.hash !== descriptor.binding.genesisHash) fail("NETWORK_IDENTITY");
      const code = await rpc("eth_getCode", [contract, "latest"]);
      if (!ethers.isHexString(code) || code === "0x" || ethers.keccak256(code) !== codeHash) fail("CONTRACT_IDENTITY");
      const call = data => rpc("eth_call", [{ from: signer.address, to: contract, data }, "latest"]);
      const [account] = iface.decodeFunctionResult("getAccount", await call(iface.encodeFunctionData("getAccount", [accountId])));
      if (account.agent.toLowerCase() !== descriptor.binding.wallet) fail("AGENT_IDENTITY");
      if (account.asset !== ethers.ZeroAddress) fail("UNSUPPORTED_ASSET");
      const data = iface.encodeFunctionData("pay", [accountId, intent.recipient, intent.amountRaw, memo]);
      if (!iface.decodeFunctionResult("pay", await call(data))[0]) fail("HELD_UNSUPPORTED");
      const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
      const base = latest?.baseFeePerGas == null ? quantity(await rpc("eth_gasPrice", [])) : quantity(latest.baseFeePerGas);
      const gas = quantity(await rpc("eth_estimateGas", [{ from: signer.address, to: contract, data }]));
      const nonce = quantity(await rpc("eth_getTransactionCount", [signer.address, "pending"]));
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) fail("NONCE_RANGE");
      const maxFee = 2n * base + TIP;
      if (quantity(await rpc("eth_getBalance", [signer.address, "latest"])) < gas * maxFee) fail("AGENT_GAS");
      active(); session.assertOwnership();
      operation = session.admit({ intent, child: { kind: "pay", recipient: intent.recipient, amountRaw: intent.amountRaw, memoHash: intent.memoHash, requestId: null,
        transaction: { nonce: String(nonce), type: 2, valueRaw: "0", gasLimit: String(gas), maxFeePerGas: String(maxFee), maxPriorityFeePerGas: String(TIP), calldataHash: ethers.keccak256(data) } } });
      childId = operation.children[0].childId; journalState = "PREPARED"; active();
      const unsigned = { type: 2, chainId: 31337n, to: contract, nonce: Number(nonce), value: 0n, data, gasLimit: gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: TIP };
      let raw = await bounded(signer.signTransaction(unsigned)); active();
      const signed = ethers.Transaction.from(raw); transactionHash = ethers.keccak256(raw);
      if (signed.hash !== transactionHash || signed.from?.toLowerCase() !== descriptor.binding.wallet || signed.to?.toLowerCase() !== contract
          || signed.chainId !== 31337n || signed.nonce !== Number(nonce) || signed.type !== 2 || signed.value !== 0n || signed.data !== data
          || signed.gasLimit !== gas || signed.maxFeePerGas !== maxFee || signed.maxPriorityFeePerGas !== TIP || signed.accessList?.length !== 0) fail("SIGNED_IDENTITY");
      transition("SUBMITTING"); submitting = true; active();
      const acknowledged = await rpc("eth_sendRawTransaction", [raw], () => { active(); session.assertOwnership(); active(); attempted = true; });
      raw = null; active();
      if (acknowledged !== transactionHash) fail("ACK_MISMATCH");
      transition("SUBMITTED");
      result = { operationId: operation.operationId, childId, transactionHash, state: "SUBMITTED", confirmation: "NOT_CHECKED" };
    } catch (e) {
      const code = terminalCode ?? safeCode(e);
      failure = { code, state: submitting || attempted ? "UNKNOWN" : operation ? "NOT_SUBMITTED" : "BLOCKED" };
      if (session && operation) {
        try {
          if (submitting) {
            transition("UNKNOWN", reason(code));
            if (code === "ACK_MISMATCH") { transition("RECOVERY_REQUIRED", "MANUAL_REVIEW"); failure.state = "RECOVERY_REQUIRED"; }
          } else {
            session.transition(operation.operationId, childId, change("NOT_SUBMITTED", null, reason(code))); journalState = "NOT_SUBMITTED";
            session.closeOperation(operation.operationId, "ABANDONED");
          }
        } catch { persistenceFailed = true; journalState = "UNVERIFIED"; }
      }
    } finally {
      terminal = true; clearTimeout(timer); external?.removeEventListener("abort", cancelled); controller.abort();
      if (session) try { session.release(); } catch {
        persistenceFailed = true;
        failure ??= { code: "PERSISTENCE_FAILED", state: submitting || attempted ? "UNKNOWN" : operation ? "NOT_SUBMITTED" : "BLOCKED" };
      }
    }
    if (failure) throw new LocalBroadcastError(failure.code, { state: failure.state, operationId: operation?.operationId ?? null, childId: childId ?? null,
      transactionHash, broadcastAttempted: attempted, journalState, persistenceFailed });
    return Object.freeze(result);
  }
  return Object.freeze({ pay, confirm: (operationId, childId, control) => confirmLocalOperation(confirmationContext, operationId, childId, control),
    refuel: async () => fail("UNSUPPORTED_ACTION"), cancel: async () => fail("UNSUPPORTED_ACTION"), inspect: () => store.inspect(descriptor) });
}
