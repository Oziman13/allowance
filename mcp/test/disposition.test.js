import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "../journal-schema.js";
import { dispositionFromPacket, DispositionError } from "../local-disposition.js";

const H = (n) => "0x" + String(n).repeat(64);
const mk = (s, extra = {}) => ({ childId: "c" + s.kind + s.state, kind: s.kind, nonce: "1", state: s.state,
  transactionHash: ["PREPARED", "NOT_SUBMITTED"].includes(s.state) ? null : H(1), outcome: s.outcome ?? null, reasonCode: null,
  recordedReceipt: null, candidate: s.candidate ?? null, observationPolicy: null, observedAt: null, ...extra });
function packet({ children, status = "OPEN", lock = "ABSENT", owner = false, flags = [] }) {
  const p = { packetVersion: 1, policy: "ANVIL_RECORDED_ONLY_V1", authority: "READ_ONLY_NO_RECOVERY", binding: "b", journalId: "j",
    ownerOpenRecorded: owner, lockObserved: lock, riskFlags: flags,
    operations: [{ operationId: "op1", status, closure: null, intent: { kind: "pay" }, children: children.map(mk) }],
    guarantee: "HISTORICAL_JOURNAL_SNAPSHOT_NOT_CHAIN_FINALITY", nextAction: "HUMAN_REVIEW_ONLY" };
  return { ...p, fingerprint: "sha256:" + createHash("sha256").update(canonical(p)).digest("hex") };
}
const run = (o) => dispositionFromPacket(packet(o));
const pd = (r) => r.operations[0].parentDisposition;
const why = (r) => r.operations[0].reasons;

test("closed fully settled parent is review only; hold flagged as request", () => {
  const r = run({ status: "CLOSED", children: [{ kind: "pay", state: "CONFIRMED", outcome: "HELD" }] });
  assert.equal(pd(r), "REVIEW_ONLY");
  assert.ok(why(r).includes("HOLD_IS_REQUEST_NOT_PAYMENT") && why(r).includes("RECORDED_NOT_FINALITY"));
});
test("in-flight children wait for evidence", () => {
  for (const state of ["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN"])
    assert.equal(pd(run({ children: [{ kind: "pay", state }] })), "WAIT_FOR_EVIDENCE");
});
test("recovery required escalates", () => {
  assert.equal(pd(run({ children: [{ kind: "pay", state: "RECOVERY_REQUIRED" }] })), "ESCALATE_OPERATOR");
});
test("unverified, different or cancellation candidates escalate; verified equivalent does not", () => {
  for (const classification of ["UNVERIFIED", "DIFFERENT_CALL", "CANCELLATION"])
    assert.equal(pd(run({ children: [{ kind: "pay", state: "UNKNOWN", candidate: { hash: H(2), classification, verifiedHistorically: true } }] })), "ESCALATE_OPERATOR");
  assert.equal(pd(run({ children: [{ kind: "pay", state: "UNKNOWN", candidate: { hash: H(2), classification: "EQUIVALENT_CALL", verifiedHistorically: false } }] })), "ESCALATE_OPERATOR");
  assert.equal(pd(run({ children: [{ kind: "pay", state: "UNKNOWN", candidate: { hash: H(2), classification: "EQUIVALENT_CALL", verifiedHistorically: true } }] })), "WAIT_FOR_EVIDENCE");
});
test("refuel confirmed with pay absent on open parent escalates, no auto action", () => {
  const r = run({ children: [{ kind: "refuel", state: "CONFIRMED", outcome: "REFUELED" }] });
  assert.equal(pd(r), "ESCALATE_OPERATOR");
  assert.ok(why(r).includes("REFUEL_CONFIRMED_PAY_ABSENT"));
  assert.deepEqual(r.executableActions, []);
});
test("pay after unresolved refuel is not admissible", () => {
  const r = run({ children: [{ kind: "refuel", state: "RECOVERY_REQUIRED" }, { kind: "pay", state: "PREPARED" }] });
  assert.equal(pd(r), "ESCALATE_OPERATOR");
  assert.ok(why(r).includes("PAY_NOT_ADMISSIBLE_WITHOUT_OWN_CONFIRMED_REFUEL"));
});
test("open parent that is fully settled escalates; closed with unsettled child escalates", () => {
  assert.ok(why(run({ children: [{ kind: "pay", state: "CONFIRMED", outcome: "PAID" }] })).includes("OPEN_PARENT_FULLY_SETTLED_NOT_CLOSED"));
  assert.ok(why(run({ status: "CLOSED", children: [{ kind: "pay", state: "UNKNOWN" }] })).includes("CLOSED_PARENT_WITH_UNSETTLED_CHILD"));
});
test("lock and owner state can only raise the result", () => {
  const closed = { status: "CLOSED", children: [{ kind: "pay", state: "CONFIRMED", outcome: "PAID" }] };
  assert.equal(pd(run({ ...closed, lock: "PRESENT" })), "WAIT_FOR_EVIDENCE");
  assert.equal(pd(run({ ...closed, owner: true })), "WAIT_FOR_EVIDENCE");
  const r = run({ ...closed, lock: "UNSAFE" });
  assert.equal(r.overall, "ESCALATE_OPERATOR");
});
test("output carries fixed advisory fields and preserves hashes and nonce", () => {
  const r = run({ status: "CLOSED", children: [{ kind: "pay", state: "REVERTED" }] });
  assert.equal(r.nextAction, "HUMAN_REVIEW_ONLY");
  assert.equal(r.guarantee, "HISTORICAL_JOURNAL_SNAPSHOT_NOT_CHAIN_FINALITY");
  assert.equal(r.operations[0].children[0].transactionHash, H(1));
  assert.equal(r.operations[0].children[0].nonce, "1");
});
test("tampered, malformed or incomplete packets throw", () => {
  const p = packet({ children: [{ kind: "pay", state: "UNKNOWN" }] });
  assert.throws(() => dispositionFromPacket({ ...p, riskFlags: ["x"] }), DispositionError);
  assert.throws(() => dispositionFromPacket({ ...p, nextAction: "RETRY" }), DispositionError);
  const { ownerOpenRecorded, ...missing } = p;
  assert.throws(() => dispositionFromPacket(missing), DispositionError);
  assert.throws(() => dispositionFromPacket(null), DispositionError);
  const bad = packet({ children: [{ kind: "pay", state: "WEIRD" }] });
  assert.throws(() => dispositionFromPacket(bad), DispositionError);
});
test("input is not mutated and output is independent", () => {
  const p = packet({ children: [{ kind: "pay", state: "UNKNOWN" }] });
  const before = JSON.stringify(p);
  const r = dispositionFromPacket(p);
  r.operations[0].reasons.push("x");
  assert.equal(JSON.stringify(p), before);
});
