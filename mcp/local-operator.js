// Keyless local review packet. No RPC, signer, transaction submission, wallet
// ownership acquisition, journal write, lock cleanup or recovery authority.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { openReader } from "./journal.js";
import { keys, id, binding, canonical } from "./journal-schema.js";

const digest = v => createHash("sha256").update(canonical(v)).digest("hex");
const unique = flags => [...new Set(flags)].sort();

function observedLock(state, wallet, io) {
  // Observe the file name without following it. This is an informational
  // snapshot ONLY: a missing lock never establishes that prior writer
  // continuations or other devices are fenced off.
  const dir = path.join(state.stateDir, digest(wallet.binding));
  const file = path.join(dir, "owner.lock");
  try {
    const st = io.lstatSync(file, { bigint: true });
    if (!st.isFile() || st.nlink !== 1n) return "UNSAFE";
    return "PRESENT";
  } catch (e) {
    if (e?.code === "ENOENT") return "ABSENT";
    // Do not turn permission errors or unstable paths into a clean report.
    throw e;
  }
}
function childRecord(c) {
  const candidate = c.evidence?.replacement ?? null;
  return {
    childId: c.childId, kind: c.spec.kind, nonce: c.spec.transaction.nonce,
    state: c.state, transactionHash: c.transactionHash, outcome: c.outcome,
    reasonCode: c.reasonCode, recordedReceipt: c.receipt ? structuredClone(c.receipt) : null,
    candidate: candidate ? { hash: candidate.candidateHash,
      classification: candidate.classification, verifiedHistorically: candidate.verified,
      recordedReceipt: candidate.receipt ? structuredClone(candidate.receipt) : null } : null,
    observationPolicy: c.evidence?.policy ?? null, observedAt: c.evidence?.observedAt ?? null
  };
}
export function createLocalOperatorPacket(options) {
  keys(options, ["mode", "state", "wallet", ...(Object.hasOwn(options, "io") ? ["io"] : [])]);
  if (options.mode !== "anvil-journal") throw new Error("LOCAL_MODE_REQUIRED");
  keys(options.state, ["stateDir", "storeId"]);
  keys(options.wallet, ["journalId", "binding"]);
  id(options.state.storeId); id(options.wallet.journalId); binding(options.wallet.binding);
  if (options.wallet.binding.chainId !== "31337") throw new Error("ANVIL_CHAIN_REQUIRED");
  // Clone identity once; caller mutations must not redirect subsequent reads.
  const state = structuredClone(options.state), wallet = structuredClone(options.wallet), io = options.io ?? fs;
  const reader = openReader({ ...state, io });
  const inspect = () => {
    const view = reader.inspect(wallet); // strict full replay, without any write
    const lockObservation = observedLock(state, wallet, io), flags = [];
    if (view.ownerOpen) flags.push("JOURNAL_OWNER_OPEN");
    if (lockObservation !== "ABSENT") flags.push(lockObservation === "PRESENT" ? "OWNER_LOCK_PRESENT" : "UNSAFE_LOCK");
    const operations = view.operations.map(o => {
      if (o.status !== "CLOSED") flags.push("UNRESOLVED_PARENT");
      for (const c of o.children) {
        if (["SUBMITTING", "SUBMITTED", "UNKNOWN", "RECOVERY_REQUIRED"].includes(c.state)) flags.push("UNCERTAIN_CHILD");
        if (c.state === "RECOVERY_REQUIRED") flags.push("RECOVERY_REQUIRED");
        if (c.state === "CONFIRMED") flags.push("HISTORICAL_CONFIRMATION_NOT_FINALITY");
        if (c.evidence?.replacement?.verified === false) flags.push("UNVERIFIED_REPLACEMENT");
      }
      return {
        operationId: o.operationId, status: o.status, closure: o.closure,
        intent: { kind: o.intent.kind, contract: o.intent.contract,
          accountId: o.intent.accountId, asset: o.intent.asset,
          recipient: o.intent.recipient, amountRaw: o.intent.amountRaw,
          memoHash: o.intent.memoHash, requestId: o.intent.requestId },
        children: o.children.map(childRecord)
      };
    });
    const payload = {
      packetVersion: 1, policy: "ANVIL_RECORDED_ONLY_V1", authority: "READ_ONLY_NO_RECOVERY",
      binding: structuredClone(view.binding), journalId: view.journalId,
      ownerOpenRecorded: view.ownerOpen, lockObserved: lockObservation,
      riskFlags: unique(flags), operations,
      guarantee: "HISTORICAL_JOURNAL_SNAPSHOT_NOT_CHAIN_FINALITY",
      nextAction: "HUMAN_REVIEW_ONLY"
    };
    return structuredClone({ ...payload, fingerprint: "sha256:" + digest(payload) });
  };
  return Object.freeze({ inspect });
}
