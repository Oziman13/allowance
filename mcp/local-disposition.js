// Phase 2D-3: pure, offline, read-only parent/child disposition over a local operator packet.
// No I/O, no RPC, no keys. Output is advisory text only: it never contains an executable action.
import { createHash } from "node:crypto";
import { canonical } from "./journal-schema.js";

const RANK = Object.freeze({ REVIEW_ONLY: 0, WAIT_FOR_EVIDENCE: 1, ESCALATE_OPERATOR: 2 });
const GUARANTEE = "HISTORICAL_JOURNAL_SNAPSHOT_NOT_CHAIN_FINALITY";
const STATES = ["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN", "RECOVERY_REQUIRED", "CONFIRMED", "REVERTED", "NOT_SUBMITTED"];
const CLASSES = ["EQUIVALENT_CALL", "DIFFERENT_CALL", "CANCELLATION", "UNVERIFIED"];
const PACKET_KEYS = ["packetVersion", "policy", "authority", "binding", "journalId", "ownerOpenRecorded", "lockObserved", "riskFlags", "operations", "guarantee", "nextAction", "fingerprint"];
const CHILD_KEYS = ["childId", "kind", "nonce", "state", "transactionHash", "outcome", "reasonCode", "recordedReceipt", "candidate", "observationPolicy", "observedAt"];

export class DispositionError extends Error {
  constructor(code) { super(code); this.name = "DispositionError"; this.code = code; }
}
const fail = (code) => { throw new DispositionError(code); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v, ks, code) => {
  if (!plain(v)) fail(code);
  const have = Object.keys(v).sort();
  const want = [...ks].sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) fail(code);
};
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

function validatePacket(p) {
  exact(p, PACKET_KEYS, "INVALID_PACKET");
  if (p.packetVersion !== 1 || p.policy !== "ANVIL_RECORDED_ONLY_V1" || p.authority !== "READ_ONLY_NO_RECOVERY"
      || p.nextAction !== "HUMAN_REVIEW_ONLY" || p.guarantee !== GUARANTEE) fail("INVALID_PACKET");
  if (typeof p.ownerOpenRecorded !== "boolean") fail("INVALID_PACKET");
  if (!["PRESENT", "ABSENT", "UNSAFE"].includes(p.lockObserved)) fail("INVALID_PACKET");
  if (!Array.isArray(p.riskFlags) || p.riskFlags.some(f => typeof f !== "string")) fail("INVALID_PACKET");
  if (!Array.isArray(p.operations)) fail("INVALID_PACKET");
  const { fingerprint, ...payload } = p;
  if (typeof fingerprint !== "string" || fingerprint !== "sha256:" + createHash("sha256").update(canonical(payload)).digest("hex")) fail("FINGERPRINT_MISMATCH");
  for (const op of p.operations) {
    if (!plain(op) || typeof op.operationId !== "string" || !["OPEN", "CLOSED"].includes(op.status) || !plain(op.intent)
        || !["pay", "cancel"].includes(op.intent.kind) || !Array.isArray(op.children)
        || op.children.length < 1 || op.children.length > 2) fail("INVALID_OPERATION");
    for (const c of op.children) {
      exact(c, CHILD_KEYS, "INVALID_CHILD");
      if (!["refuel", "pay", "cancel"].includes(c.kind) || !STATES.includes(c.state)) fail("INVALID_CHILD");
      if (c.candidate !== null) {
        if (!plain(c.candidate) || !CLASSES.includes(c.candidate.classification)
            || typeof c.candidate.verifiedHistorically !== "boolean") fail("INVALID_CHILD");
      }
    }
  }
}

function child(c, parentPacketFlags) {
  const flags = [];
  let d;
  const cand = c.candidate;
  if (c.state === "RECOVERY_REQUIRED") { d = "ESCALATE_OPERATOR"; flags.push("RECOVERY_REQUIRED"); }
  else if (cand && !(cand.classification === "EQUIVALENT_CALL" && cand.verifiedHistorically)) {
    d = "ESCALATE_OPERATOR"; flags.push("REPLACEMENT_CANDIDATE_NOT_PROVEN_EQUIVALENT");
  } else if (["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN"].includes(c.state)) {
    d = "WAIT_FOR_EVIDENCE"; flags.push("NO_FINAL_RECEIPT_RECORDED");
  } else {
    d = "REVIEW_ONLY";
    if (c.state === "CONFIRMED") flags.push("RECORDED_NOT_FINALITY");
    if (c.outcome === "HELD") flags.push("HOLD_IS_REQUEST_NOT_PAYMENT");
  }
  return { childId: c.childId, kind: c.kind, nonce: c.nonce, state: c.state, transactionHash: c.transactionHash,
    candidateHash: cand ? cand.hash ?? null : null, disposition: d, reasons: [...flags, ...parentPacketFlags].sort() };
}

function parent(op, packet) {
  const reasons = new Set();
  const kids = op.children.map(c => child(c, []));
  let d = kids.reduce((a, k) => worst(a, k.disposition), "REVIEW_ONLY");
  const raise = (to, reason) => { d = worst(d, to); reasons.add(reason); };
  const [first, second] = op.children;
  if (packet.lockObserved === "UNSAFE") raise("ESCALATE_OPERATOR", "LOCK_STATE_UNSAFE");
  if (packet.lockObserved === "PRESENT") raise("WAIT_FOR_EVIDENCE", "LOCK_PRESENT");
  if (packet.ownerOpenRecorded) raise("WAIT_FOR_EVIDENCE", "OWNER_OPEN_RECORDED");
  if (first.kind === "refuel") {
    if (second === undefined && first.state === "CONFIRMED" && op.status === "OPEN") raise("ESCALATE_OPERATOR", "REFUEL_CONFIRMED_PAY_ABSENT");
    if (second !== undefined && first.state !== "CONFIRMED") raise("ESCALATE_OPERATOR", "PAY_NOT_ADMISSIBLE_WITHOUT_OWN_CONFIRMED_REFUEL");
    if (second === undefined && ["REVERTED", "NOT_SUBMITTED"].includes(first.state)) raise("ESCALATE_OPERATOR", "REFUEL_NOT_EFFECTIVE");
  }
  if (op.status === "OPEN" && op.children.every(c => ["CONFIRMED", "REVERTED", "NOT_SUBMITTED"].includes(c.state))) {
    raise("ESCALATE_OPERATOR", "OPEN_PARENT_FULLY_SETTLED_NOT_CLOSED");
  }
  if (op.status === "CLOSED" && op.children.some(c => !["CONFIRMED", "REVERTED", "NOT_SUBMITTED"].includes(c.state))) {
    raise("ESCALATE_OPERATOR", "CLOSED_PARENT_WITH_UNSETTLED_CHILD");
  }
  for (const k of kids) for (const r of k.reasons) reasons.add(r);
  return { operationId: op.operationId, status: op.status, intentKind: op.intent.kind, parentDisposition: d,
    reasons: [...reasons].sort(), children: kids };
}

export function dispositionFromPacket(packet) {
  validatePacket(packet);
  let overall = "REVIEW_ONLY";
  const operations = packet.operations.map(op => { const r = parent(op, packet); overall = worst(overall, r.parentDisposition); return r; });
  if (packet.lockObserved === "UNSAFE") overall = "ESCALATE_OPERATOR";
  return structuredClone({
    dispositionVersion: 1, policy: "DISPOSITION_ADVISORY_V1", authority: "READ_ONLY_NO_RECOVERY",
    packetFingerprint: packet.fingerprint, overall, riskFlags: [...packet.riskFlags].sort(), operations,
    executableActions: [], nextAction: "HUMAN_REVIEW_ONLY", guarantee: GUARANTEE,
  });
}
