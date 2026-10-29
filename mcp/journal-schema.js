// Persistence schema only. No wallet, RPC, signing or execution authority.
import { randomUUID } from "node:crypto";

export class JournalError extends Error {
  constructor(code, message = code) { super(message); this.name = "JournalError"; this.code = code; }
}
export const fail = (code) => { throw new JournalError(code); };
export const uuid = () => randomUUID();
export const canonical = (v) => JSON.stringify(v, (_, value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]]));
  }
  return value;
});
export function keys(v, expected) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype
      || Reflect.ownKeys(v).some(k => typeof k !== "string")
      || Reflect.ownKeys(v).sort().join("|") !== [...expected].sort().join("|")
      || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !d.enumerable || d.get || d.set)) fail("INVALID_SCHEMA");
}
export function id(v) { if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) fail("INVALID_ID"); }
export function hash(v) { if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v)) fail("INVALID_HASH"); }
export function address(v, zero = false) {
  if (typeof v !== "string" || !/^0x[0-9a-f]{40}$/.test(v) || (!zero && v === "0x" + "0".repeat(40))) fail("INVALID_ADDRESS");
}
export function integer(v, positive = false, bits = 256) {
  if (typeof v !== "string" || v.length > 78 || !/^(0|[1-9][0-9]*)$/.test(v)
      || BigInt(v) >= (1n << BigInt(bits)) || (positive && v === "0")) fail("INVALID_INTEGER");
}
export function binding(v) {
  keys(v, ["chainId", "genesisHash", "wallet"]); integer(v.chainId, true); hash(v.genesisHash); address(v.wallet);
}
export function intent(v) {
  keys(v, ["kind", "contract", "accountId", "asset", "recipient", "amountRaw", "memoHash", "requestId"]);
  address(v.contract); integer(v.accountId); address(v.asset, true);
  if (v.kind === "pay") {
    address(v.recipient); integer(v.amountRaw, true, 128); hash(v.memoHash);
    if (v.requestId !== null || v.recipient === v.contract) fail("INVALID_INTENT");
  } else if (v.kind === "cancel") {
    integer(v.requestId);
    if (v.recipient !== null || v.memoHash !== null || v.amountRaw !== "0") fail("INVALID_INTENT");
  } else fail("INVALID_INTENT");
}
export function childSpec(v, parent, wallet) {
  keys(v, ["kind", "recipient", "amountRaw", "memoHash", "requestId", "transaction"]);
  keys(v.transaction, ["nonce", "type", "valueRaw", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "calldataHash"]);
  const t = v.transaction;
  integer(t.nonce); integer(t.gasLimit, true); integer(t.maxFeePerGas, true); integer(t.maxPriorityFeePerGas);
  hash(t.calldataHash);
  if (t.type !== 2 || t.valueRaw !== "0" || BigInt(t.maxPriorityFeePerGas) > BigInt(t.maxFeePerGas)) fail("INVALID_TRANSACTION");
  if (v.kind === "refuel") {
    if (parent.kind !== "pay" || parent.asset !== "0x" + "0".repeat(40) || v.recipient !== wallet
        || v.memoHash !== null || v.requestId !== null) fail("INVALID_CHILD");
    integer(v.amountRaw, true, 128);
  } else {
    if (v.kind !== parent.kind || ["recipient", "amountRaw", "memoHash", "requestId"].some(k => v[k] !== parent[k])) fail("INVALID_CHILD");
  }
}
export const TRANSITIONS = Object.freeze({
  PREPARED: ["SUBMITTING", "NOT_SUBMITTED"],
  SUBMITTING: ["SUBMITTED", "UNKNOWN"],
  SUBMITTED: ["CONFIRMED", "REVERTED", "UNKNOWN"],
  UNKNOWN: ["SUBMITTED", "CONFIRMED", "REVERTED", "RECOVERY_REQUIRED"],
  RECOVERY_REQUIRED: ["CONFIRMED", "REVERTED"],
  CONFIRMED: ["RECOVERY_REQUIRED"], REVERTED: ["RECOVERY_REQUIRED"], NOT_SUBMITTED: [],
});
export const settled = (c) => ["CONFIRMED", "REVERTED", "NOT_SUBMITTED"].includes(c.state);
export function child(v, parent, wallet) {
  keys(v, ["childId", "spec", "state", "transactionHash", "outcome", "receipt", "reasonCode"]);
  id(v.childId); childSpec(v.spec, parent, wallet);
  if (!Object.hasOwn(TRANSITIONS, v.state)) fail("INVALID_STATE");
  if (["PREPARED", "NOT_SUBMITTED"].includes(v.state)) {
    if (v.transactionHash !== null) fail("INVALID_HASH");
  } else hash(v.transactionHash);
  if (v.reasonCode !== null && !["RPC_UNAVAILABLE", "TIMEOUT", "PROCESS_RESTART", "EVENT_MISMATCH", "REPLACEMENT_OBSERVED", "MANUAL_REVIEW"].includes(v.reasonCode)) fail("INVALID_REASON");
  if (v.receipt !== null) {
    keys(v.receipt, ["transactionHash", "blockHash", "blockNumber", "status"]);
    hash(v.receipt.transactionHash); hash(v.receipt.blockHash); integer(v.receipt.blockNumber);
    if (v.receipt.transactionHash !== v.transactionHash || ![0, 1].includes(v.receipt.status)) fail("INVALID_RECEIPT");
  }
  if (v.state === "CONFIRMED") {
    const outcomes = { pay: ["PAID", "HELD"], refuel: ["REFUELED"], cancel: ["CANCELLED"] };
    if (v.receipt?.status !== 1 || !outcomes[v.spec.kind].includes(v.outcome)) fail("INVALID_RECEIPT");
  } else if (v.state === "REVERTED") {
    if (v.receipt?.status !== 0 || v.outcome !== null) fail("INVALID_RECEIPT");
  } else if (v.state !== "RECOVERY_REQUIRED" && (v.receipt !== null || v.outcome !== null)) fail("INVALID_RECEIPT");
  if (v.state === "RECOVERY_REQUIRED" && v.outcome !== null
      && (v.receipt?.status !== 1 || !({ pay: ["PAID", "HELD"], refuel: ["REFUELED"], cancel: ["CANCELLED"] })[v.spec.kind].includes(v.outcome))) fail("INVALID_RECEIPT");
}
export function operation(v, wallet) {
  keys(v, ["operationId", "intent", "status", "closure", "children"]); id(v.operationId); intent(v.intent);
  if (!["OPEN", "CLOSED"].includes(v.status) || !Array.isArray(v.children) || v.children.length < 1 || v.children.length > 2) fail("INVALID_OPERATION");
  for (const c of v.children) child(c, v.intent, wallet);
  if (new Set(v.children.map(c => c.childId)).size !== v.children.length) fail("INVALID_CHILD");
  if (v.children.length === 2 && (v.children[0].spec.kind !== "refuel" || v.children[1].spec.kind !== "pay")) fail("INVALID_CHILD");
  if (v.status === "CLOSED" && !v.children.every(settled)) fail("UNRESOLVED_OPERATION");
  if ((v.status === "OPEN" && v.closure !== null) || (v.status === "CLOSED" && !["RESOLVED", "ABANDONED"].includes(v.closure))) fail("INVALID_OPERATION");
  if (v.closure === "RESOLVED" && !v.children.some(c => c.spec.kind === v.intent.kind)) fail("INVALID_OPERATION");
}
export function newChild(spec) {
  return { childId: uuid(), spec: structuredClone(spec), state: "PREPARED", transactionHash: null, outcome: null, receipt: null, reasonCode: null };
}
export function updateChild(current, patch) {
  keys(patch, ["state", "transactionHash", "outcome", "receipt", "reasonCode"]);
  if (!TRANSITIONS[current.state]?.includes(patch.state)) fail("INVALID_TRANSITION");
  if (current.transactionHash !== null && current.transactionHash !== patch.transactionHash) fail("IDENTITY_MISMATCH");
  return { childId: current.childId, spec: current.spec, ...patch };
}
// Replay validates every change, not only the final snapshot.
export function validateChange(old, next, wallet) {
  operation(next, wallet);
  if (!old) {
    if (next.status !== "OPEN" || next.children.length !== 1 || next.children[0].state !== "PREPARED") fail("INVALID_TRANSITION");
    return;
  }
  if (canonical(old.intent) !== canonical(next.intent) || old.operationId !== next.operationId) fail("IDENTITY_MISMATCH");
  if (next.children.length === old.children.length + 1) {
    if (old.status !== "OPEN" || old.children[0].state !== "CONFIRMED" || next.status !== "OPEN"
        || next.children.at(-1).state !== "PREPARED" || canonical(old.children) !== canonical(next.children.slice(0, -1))) fail("INVALID_TRANSITION");
    if (BigInt(next.children.at(-1).spec.transaction.nonce) <= BigInt(old.children.at(-1).spec.transaction.nonce)) fail("NONCE_CONFLICT");
    return;
  }
  if (next.children.length !== old.children.length) fail("INVALID_TRANSITION");
  const changed = old.children.map((c, i) => canonical(c) !== canonical(next.children[i]) ? i : -1).filter(i => i >= 0);
  if (!changed.length) {
    if (old.status !== "OPEN" || next.status !== "CLOSED") fail("INVALID_TRANSITION");
    return;
  }
  if (changed.length !== 1 || next.status !== "OPEN") fail("INVALID_TRANSITION");
  const i = changed[0], a = old.children[i], b = next.children[i];
  if (old.status === "CLOSED" && b.state !== "RECOVERY_REQUIRED") fail("INVALID_TRANSITION");
  if (a.childId !== b.childId || canonical(a.spec) !== canonical(b.spec)
      || !TRANSITIONS[a.state].includes(b.state) || (a.transactionHash !== null && a.transactionHash !== b.transactionHash)) fail("INVALID_TRANSITION");
}
