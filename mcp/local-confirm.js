// Local persistence coordinator. RPC access is exclusively through the keyless,
// read-only verifier. Never signs, sends, resumes children or clears crash locks.
import * as fs from "node:fs";
import { performance } from "node:perf_hooks";
import { openStore } from "./journal.js";
import { canonical } from "./journal-schema.js";
import { createLocalReconciler } from "./local-reconcile.js";

export class ConfirmationError extends Error {
  constructor(code, details) { super(code); this.name = "ConfirmationError"; Object.assign(this, { code }, details); }
}
export async function confirmLocalOperation(options, operationId, childId, control = {}) {
  const start = performance.now(), reconciler = createLocalReconciler(options);
  // Validate journal scope before any ownership mutation.
  const before = reconciler.inspect().operations.find(o => o.operationId === operationId), child = before?.children.find(c => c.childId === childId);
  if (!child) throw new ConfirmationError("UNKNOWN_OPERATION_OR_CHILD", { transactionHash: null, broadcastAttempted: false });
  const timeoutMs = control.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60000) throw new ConfirmationError("INVALID_CONTROL", { transactionHash: child.transactionHash });
  const state = structuredClone(options.state), wallet = structuredClone(options.wallet), io = options.io ?? fs;
  let session, store, observation, failure, phase = "acquire", persisted = false;
  try {
    store = openStore({ ...state, io });
    session = store.acquire(wallet);
    const remaining = Math.floor(timeoutMs - (performance.now() - start));
    if (remaining < 10) throw new ConfirmationError("TIMEOUT", { transactionHash: child.transactionHash });
    phase = "observe";
    observation = await reconciler.reconcile(operationId, childId, { ...control, timeoutMs: remaining });
    phase = "persist";
    session.assertOwnership();
    let current = store.inspect(wallet).operations.find(o => o.operationId === operationId).children.find(c => c.childId === childId);
    if (current.transactionHash !== child.transactionHash || canonical(current.spec) !== canonical(child.spec)) throw new ConfirmationError("JOURNAL_CHANGED", {});
    const put = (state, fields = {}) => {
      session.transition(operationId, childId, { state, transactionHash: child.transactionHash, outcome: null, receipt: null, reasonCode: null, ...fields });
      current = store.inspect(wallet).operations.find(o => o.operationId === operationId).children.find(c => c.childId === childId);
      persisted = true;
    };
    const historical = ["CONFIRMED", "REVERTED"].includes(current.state);
    const settled = ["CONFIRMED", "REVERTED"].includes(observation.observation);
    const contradiction = historical && settled && (observation.observation !== current.state || observation.outcome !== current.outcome || canonical(observation.receipt) !== canonical(current.receipt));
    let target = contradiction ? "RECOVERY_REQUIRED" : observation.observation;
    if (performance.now() - start >= timeoutMs && settled) throw new ConfirmationError("TIMEOUT", {});
    if (current.state === "SUBMITTING") put("UNKNOWN", { reasonCode: "PROCESS_RESTART" });
    if (target === "RECOVERY_REQUIRED" && !["PREPARED", "NOT_SUBMITTED", "RECOVERY_REQUIRED"].includes(current.state)) {
      if (current.state === "SUBMITTED") put("UNKNOWN", { reasonCode: "MANUAL_REVIEW" });
      put("RECOVERY_REQUIRED", { outcome: current.outcome, receipt: current.receipt,
        reasonCode: observation.replacement ? "REPLACEMENT_OBSERVED" : "EVENT_MISMATCH", evidence: observation.evidence });
    } else if (["CONFIRMED", "REVERTED"].includes(target) && !historical && !["PREPARED", "NOT_SUBMITTED"].includes(current.state)) {
      put(target, { outcome: observation.outcome, receipt: observation.receipt, evidence: observation.evidence });
    } else if (target === "PENDING" && current.state === "UNKNOWN") {
      put("SUBMITTED");
    } else if (target === "UNKNOWN" && current.state === "SUBMITTED") {
      put("UNKNOWN", { reasonCode: observation.timedOut ? "TIMEOUT" : "RPC_UNAVAILABLE" });
    }
    if (performance.now() - start >= timeoutMs && settled) throw new ConfirmationError("TIMEOUT", {});
    // Do not auto-close/resume the parent: explicit operator disposition and
    // compound-operation policy are deferred. All nonce reservations persist.
    observation = { ...observation, observation: contradiction ? "RECOVERY_REQUIRED" : target,
      reason: contradiction ? "HISTORICAL_CONTRADICTION" : observation.reason, journalState: current.state, persisted };
  } catch (e) {
    failure = new ConfirmationError(e?.code === "WALLET_BUSY" ? "WALLET_BUSY" : "CONFIRMATION_FAILED", {
      state: "UNKNOWN", transactionHash: child.transactionHash, operationId, childId, broadcastAttempted: false,
      reason: /^[A-Z_]{1,50}$/.test(e?.code ?? "") ? e.code : "LOCAL_FAILURE", observation,
      persistenceFailed: e?.code !== "TIMEOUT" && (phase === "persist" || e?.code === "FILESYSTEM_ERROR") });
  } finally {
    if (session) try { session.release(); } catch {
      if (failure) failure.persistenceFailed = true;
      failure ??= new ConfirmationError("PERSISTENCE_FAILED", { state: "UNKNOWN", transactionHash: child.transactionHash,
        operationId, childId, broadcastAttempted: false, persistenceFailed: true, observation });
    }
  }
  if (failure) throw failure;
  return observation;
}
