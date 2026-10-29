// JN2 disk-backed semantic history tests. Synthetic receipts only; no signer/RPC.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { initializeStore, openStore } from "../journal.js";
import { canonical } from "../journal-schema.js";

const base = fileURLToPath(new URL("../../work/phase5a2b2a-r2/", import.meta.url));
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(base, "eligibility-"));
after(() => fs.rmSync(run, { recursive: true, force: true }));
const A = n => "0x" + String(n).repeat(40), H = n => "0x" + String(n).repeat(64);
const binding = { chainId: "31337", genesisHash: H(1), wallet: A(2) };
const code = expected => e => e.code === expected;
function spec(nonce, accountId = "0", refuel = false) {
  return { intent: { kind: "pay", contract: A(3), accountId, asset: A(0), recipient: A(4), amountRaw: "100", memoHash: H(5), requestId: null },
    child: { kind: refuel ? "refuel" : "pay", recipient: refuel ? binding.wallet : A(4), amountRaw: refuel ? "20" : "100", memoHash: refuel ? null : H(5), requestId: null,
      transaction: { nonce, type: 2, valueRaw: "0", gasLimit: "21000", maxFeePerGas: "3000000000", maxPriorityFeePerGas: "1000000000", calldataHash: H(6) } } };
}
const patch = (state, hash = H(7), outcome = null, status = 1) => ({ state, transactionHash: hash, outcome,
  receipt: outcome !== null || state === "REVERTED" ? { transactionHash: hash, blockHash: H(9), blockNumber: "42", status } : null, reasonCode: null });
function fixture() {
  const root = fs.mkdtempSync(path.join(run, "case-")), config = initializeStore({ stateDir: path.join(root, "state") });
  const store = openStore(config), wallet = store.createWallet(binding), s = store.acquire(wallet);
  const dir = path.join(config.stateDir, createHash("sha256").update(canonical(binding)).digest("hex"));
  return { config, store, wallet, s, journal: path.join(dir, "journal.jsonl"), lock: path.join(dir, "owner.lock") };
}
const current = (f, id) => f.store.inspect(f.wallet).operations.find(o => o.operationId === id);
function confirm(f, o, hash = H(7), outcome = "PAID") {
  const c = o.children.at(-1).childId;
  f.s.transition(o.operationId, c, patch("SUBMITTING", hash)); f.s.transition(o.operationId, c, patch("SUBMITTED", hash));
  return f.s.transition(o.operationId, c, patch("CONFIRMED", hash, outcome));
}
function candidate(o, childId, change) {
  const next = structuredClone(o); Object.assign(next.children.find(c => c.childId === childId), change);
  next.status = "OPEN"; next.closure = null; return next;
}
function rejectsWithoutEffects(f, action, expected = "UNRESOLVED_OPERATION") {
  const before = fs.readFileSync(f.journal), counters = { simulatedSigns: 0, simulatedBroadcasts: 0 };
  assert.throws(() => { action(); counters.simulatedSigns++; counters.simulatedBroadcasts++; }, code(expected));
  assert.deepEqual(counters, { simulatedSigns: 0, simulatedBroadcasts: 0 }); assert.deepEqual(fs.readFileSync(f.journal), before);
}
// A fresh process, not merely a second Store instance; no signing key is needed.
function restartRead(f) {
  const script = `const { openStore } = await import(process.argv[2]); const c = JSON.parse(process.argv[1]);
    try { console.log(JSON.stringify({accepted:true, operations:openStore(c.config).inspect(c.wallet).operations})); }
    catch(e) { console.log(JSON.stringify({accepted:false, code:e.code})); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify({ config: f.config, wallet: f.wallet }), new URL("../journal.js", import.meta.url).href],
    { encoding: "utf8", timeout: 5000, maxBuffer: 256 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, "");
  return JSON.parse(child.stdout);
}
// Test-only complete frames with valid checksums, sequence, owner token and seal.
function append(f, operation) {
  const lines = fs.readFileSync(f.journal, "utf8").trimEnd().split("\n"), seal = JSON.parse(lines.pop());
  const encode = v => canonical({ ...v, digest: createHash("sha256").update(canonical(v)).digest("hex") });
  const frame = encode({ kind: "OP", schemaVersion: 1, sequence: String(BigInt(seal.sequence) + 1n), previousDigest: seal.lastDigest,
    ownerToken: JSON.parse(fs.readFileSync(f.lock, "utf8")).token, operation });
  lines.push(frame, encode({ kind: "SEAL", schemaVersion: 1, sequence: String(BigInt(seal.sequence) + 1n), lastDigest: JSON.parse(frame).digest }));
  fs.writeFileSync(f.journal, lines.join("\n") + "\n");
}
function rejectReplay(f, poisonedAction) {
  const before = fs.readFileSync(f.journal);
  assert.deepEqual(restartRead(f), { accepted: false, code: "CORRUPT_STATE" });
  assert.throws(() => openStore(f.config).inspect(f.wallet), code("CORRUPT_STATE"));
  rejectsWithoutEffects(f, poisonedAction, "CORRUPT_STATE");
  assert.throws(() => f.s.release(), code("OWNERSHIP_UNCERTAIN")); assert(fs.existsSync(f.lock));
  assert.deepEqual(fs.readFileSync(f.journal), before);
}
function crossParent(f, refuel = false, bState = "PREPARED") {
  const a = f.s.admit(spec("0", "0", refuel)); confirm(f, a, H(7), refuel ? "REFUELED" : "PAID");
  f.s.closeOperation(a.operationId, refuel ? "ABANDONED" : "RESOLVED");
  const b = f.s.admit(spec("1", "1"));
  if (bState === "NOT_SUBMITTED") f.s.transition(b.operationId, b.children[0].childId, patch("NOT_SUBMITTED", null));
  if (bState === "UNKNOWN") {
    f.s.transition(b.operationId, b.children[0].childId, patch("SUBMITTING", H(8)));
    f.s.transition(b.operationId, b.children[0].childId, patch("UNKNOWN", H(8)));
  }
  f.s.transition(a.operationId, a.children[0].childId, patch("RECOVERY_REQUIRED", H(7), refuel ? "REFUELED" : "PAID"));
  return { a: current(f, a.operationId), b: current(f, b.operationId) };
}

test("eligibility repair: another unresolved parent blocks live and replayed SUBMITTING, including an invalid prefix", () => {
  for (const laterResolved of [false, true]) {
    const f = fixture(), { a, b } = crossParent(f), c = b.children[0].childId;
    const submit = () => f.s.transition(b.operationId, c, patch("SUBMITTING", H(8)));
    rejectsWithoutEffects(f, submit); append(f, candidate(b, c, patch("SUBMITTING", H(8))));
    if (laterResolved) {
      // The final snapshot would look eligible; the preceding invalid frame still must fail.
      const resolved = candidate(a, a.children[0].childId, patch("CONFIRMED", H(7), "PAID")); append(f, resolved);
      resolved.status = "CLOSED"; resolved.closure = "RESOLVED"; append(f, resolved);
    }
    rejectReplay(f, submit);
  }
});

test("eligibility repair: a recovering or reverted earlier refuel blocks live and replayed payment SUBMITTING", () => {
  for (const state of ["RECOVERY_REQUIRED", "REVERTED"]) {
    const f = fixture(), a = f.s.admit(spec("0", "0", true)); confirm(f, a, H(7), "REFUELED");
    const withPay = f.s.addChild(a.operationId, spec("1").child), c = withPay.children[1].childId;
    f.s.transition(a.operationId, a.children[0].childId, patch("RECOVERY_REQUIRED", H(7), "REFUELED"));
    if (state === "REVERTED") f.s.transition(a.operationId, a.children[0].childId, patch("REVERTED", H(7), null, 0));
    const submit = () => f.s.transition(a.operationId, c, patch("SUBMITTING", H(8)));
    rejectsWithoutEffects(f, submit); append(f, candidate(current(f, a.operationId), c, patch("SUBMITTING", H(8))));
    rejectReplay(f, submit);
  }
});

test("eligibility repair: admission and child creation share preceding-state unresolved-parent rules", () => {
  const admission = fixture(), { a } = crossParent(admission);
  rejectsWithoutEffects(admission, () => admission.s.admit(spec("2", "2")));
  append(admission, { operationId: randomUUID(), intent: spec("2", "2").intent, status: "OPEN", closure: null,
    children: [{ childId: randomUUID(), spec: spec("2", "2").child, ...patch("PREPARED", null) }] });
  rejectReplay(admission, () => admission.s.closeOperation(a.operationId));
  for (const bState of ["PREPARED", "NOT_SUBMITTED", "UNKNOWN"]) {
    const f = fixture(), { a } = crossParent(f, true, bState);
    const ready = f.s.transition(a.operationId, a.children[0].childId, patch("CONFIRMED", H(7), "REFUELED"));
    const add = () => f.s.addChild(a.operationId, spec("2").child);
    rejectsWithoutEffects(f, add);
    ready.children.push({ childId: randomUUID(), spec: spec("2").child, ...patch("PREPARED", null) }); append(f, ready);
    rejectReplay(f, add);
  }
});

test("eligibility repair: valid recovery, explicit abort, closure and sequential refuel/pay replay identically", () => {
  const f = fixture(), { a, b } = crossParent(f, true);
  const parity = () => {
    const read = restartRead(f); assert.equal(read.accepted, true); assert.deepEqual(read.operations, f.store.inspect(f.wallet).operations);
  };
  parity(); // Two OPEN parents must remain representable after contradictory evidence.
  f.s.transition(b.operationId, b.children[0].childId, patch("NOT_SUBMITTED", null)); parity();
  f.s.closeOperation(b.operationId); parity();
  rejectsWithoutEffects(f, () => f.s.admit(spec("1", "2")));
  f.s.transition(a.operationId, a.children[0].childId, patch("CONFIRMED", H(7), "REFUELED")); parity();
  // The explicitly aborted B nonce can be used only after its parent closes.
  const withPay = f.s.addChild(a.operationId, spec("1").child), c = withPay.children[1].childId; parity();
  f.s.transition(a.operationId, c, patch("SUBMITTING", H(8))); parity();
  // Evidence discovered AFTER eligible submission cannot retroactively make
  // that submission invalid, or prevent recording later observations.
  f.s.transition(a.operationId, a.children[0].childId, patch("RECOVERY_REQUIRED", H(7), "REFUELED")); parity();
  f.s.transition(a.operationId, c, patch("UNKNOWN", H(8))); parity();
  rejectsWithoutEffects(f, () => f.s.transition(a.operationId, c, patch("NOT_SUBMITTED", null)), "INVALID_TRANSITION");
  f.s.transition(a.operationId, c, patch("SUBMITTED", H(8))); parity();
  f.s.transition(a.operationId, c, patch("CONFIRMED", H(8), "PAID")); parity();
  rejectsWithoutEffects(f, () => f.s.closeOperation(a.operationId));
  f.s.transition(a.operationId, a.children[0].childId, patch("CONFIRMED", H(7), "REFUELED"));
  f.s.closeOperation(a.operationId); parity();
  f.s.release(); f.s = openStore(f.config).acquire(f.wallet); parity();
  rejectsWithoutEffects(f, () => f.s.admit(spec("1", "2")), "NONCE_CONFLICT");
  const next = f.s.admit(spec("2", "2")); parity();
  f.s.transition(next.operationId, next.children[0].childId, patch("SUBMITTING", H(6)));
  f.s.transition(next.operationId, next.children[0].childId, patch("SUBMITTED", H(6)));
  f.s.transition(next.operationId, next.children[0].childId, patch("REVERTED", H(6), null, 0)); f.s.closeOperation(next.operationId); parity();
  rejectsWithoutEffects(f, () => f.s.admit(spec("2", "3")), "NONCE_CONFLICT"); f.s.release(); parity();
});

test("eligibility repair: uncertain or settled outcomes cannot masquerade as NOT_SUBMITTED in live or replay", () => {
  for (const state of ["SUBMITTING", "SUBMITTED", "UNKNOWN", "RECOVERY_REQUIRED", "CONFIRMED", "REVERTED"]) {
    const f = fixture(), o = f.s.admit(spec("0")), c = o.children[0].childId;
    f.s.transition(o.operationId, c, patch("SUBMITTING"));
    if (state !== "SUBMITTING") f.s.transition(o.operationId, c, patch("SUBMITTED"));
    if (state === "UNKNOWN" || state === "RECOVERY_REQUIRED") f.s.transition(o.operationId, c, patch("UNKNOWN"));
    if (state === "RECOVERY_REQUIRED") f.s.transition(o.operationId, c, patch("RECOVERY_REQUIRED"));
    if (state === "CONFIRMED" || state === "REVERTED") f.s.transition(o.operationId, c, patch(state, H(7), state === "CONFIRMED" ? "PAID" : null, state === "REVERTED" ? 0 : 1));
    const abort = () => f.s.transition(o.operationId, c, { ...patch("NOT_SUBMITTED", null), reasonCode: "TIMEOUT" });
    rejectsWithoutEffects(f, abort, "INVALID_TRANSITION");
    append(f, candidate(current(f, o.operationId), c, { ...patch("NOT_SUBMITTED", null), reasonCode: "TIMEOUT" }));
    rejectReplay(f, abort);
  }
});
