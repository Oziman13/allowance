// Disk-backed nonce regressions. All receipts/hashes are synthetic journal inputs;
// no signer, provider, key, RPC or real broadcast is used in this file.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { initializeStore, openStore } from "../journal.js";
import { canonical, operation, validateChange } from "../journal-schema.js";

const base = fileURLToPath(new URL("../../work/phase5a2b2a-r1/", import.meta.url));
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(base, "nonce-tests-"));
after(() => fs.rmSync(run, { recursive: true, force: true }));
const H = n => "0x" + String(n).repeat(64), A = n => "0x" + String(n).repeat(40);
const binding = { chainId: "31337", genesisHash: H(1), wallet: A(2) };
const code = expected => e => e.code === expected;
function spec(nonce, { accountId = "0", contract = A(3), refuel = false } = {}) {
  const intent = { kind: "pay", contract, accountId, asset: A(0), recipient: A(4), amountRaw: "100", memoHash: H(5), requestId: null };
  return { intent, child: { kind: refuel ? "refuel" : "pay", recipient: refuel ? binding.wallet : intent.recipient,
    amountRaw: refuel ? "20" : intent.amountRaw, memoHash: refuel ? null : intent.memoHash, requestId: null,
    transaction: { nonce, type: 2, valueRaw: "0", gasLimit: "21000", maxFeePerGas: "3000000000", maxPriorityFeePerGas: "1000000000", calldataHash: H(6) } } };
}
function fixture() {
  const parent = fs.mkdtempSync(path.join(run, "case-"));
  const config = initializeStore({ stateDir: path.join(parent, "state") }), store = openStore(config), wallet = store.createWallet(binding);
  const dir = path.join(config.stateDir, createHash("sha256").update(canonical(binding)).digest("hex"));
  return { config, store, wallet, journal: path.join(dir, "journal.jsonl"), lock: path.join(dir, "owner.lock") };
}
const patch = (state, hash, outcome = null, status = 1) => ({ state, transactionHash: hash, outcome,
  receipt: outcome !== null || state === "REVERTED" ? { transactionHash: hash, blockHash: H(9), blockNumber: "42", status } : null, reasonCode: null });
function settle(s, o, hash, outcome = "PAID", reverted = false) {
  const c = o.children.at(-1).childId;
  s.transition(o.operationId, c, patch("SUBMITTING", hash)); s.transition(o.operationId, c, patch("SUBMITTED", hash));
  return s.transition(o.operationId, c, reverted ? patch("REVERTED", hash, null, 0) : patch("CONFIRMED", hash, outcome));
}
function reopened(f, { accountId = "1", contract = A(3), reverted = false, laterNonce = "1" } = {}) {
  let s = f.store.acquire(f.wallet);
  const a = s.admit(spec("0", { refuel: true })); settle(s, a, H(7), "REFUELED"); s.closeOperation(a.operationId, "ABANDONED");
  const b = s.admit(spec(laterNonce, { accountId, contract })); settle(s, b, H(8), "PAID", reverted); s.closeOperation(b.operationId);
  s.release(); // Exercise real store/session restart before reopening the older parent.
  s = openStore(f.config).acquire(f.wallet);
  s.transition(a.operationId, a.children[0].childId, patch("RECOVERY_REQUIRED", H(7), "REFUELED"));
  const old = s.transition(a.operationId, a.children[0].childId, patch("CONFIRMED", H(7), "REFUELED"));
  return { s, a: old, b };
}
function rejectWithoutSend(f, action, expected = "NONCE_CONFLICT") {
  const before = fs.readFileSync(f.journal), counters = { simulatedSigns: 0, simulatedBroadcasts: 0 };
  assert.throws(() => { action(); counters.simulatedSigns++; counters.simulatedBroadcasts++; }, code(expected));
  assert.deepEqual(counters, { simulatedSigns: 0, simulatedBroadcasts: 0 });
  assert.deepEqual(fs.readFileSync(f.journal), before);
}

// Encode exactly checksummed legacy frames, including a valid hash chain/seal.
// This fixture models old-writer output, not a repair mechanism or checksum corruption.
function appendLegacy(f, body) {
  const lines = fs.readFileSync(f.journal, "utf8").trimEnd().split("\n"), footer = JSON.parse(lines.pop());
  const encode = value => canonical({ ...value, digest: createHash("sha256").update(canonical(value)).digest("hex") });
  const frame = { ...body, schemaVersion: 1, sequence: String(BigInt(footer.sequence) + 1n), previousDigest: footer.lastDigest };
  const encoded = encode(frame);
  lines.push(encoded, encode({ kind: "SEAL", schemaVersion: 1, sequence: frame.sequence, lastDigest: JSON.parse(encoded).digest }));
  fs.writeFileSync(f.journal, lines.join("\n") + "\n");
}
function legacyChild(f, a) {
  const operation = structuredClone(a);
  operation.children.push({ childId: randomUUID(), spec: spec("1").child, state: "PREPARED", transactionHash: null, outcome: null, receipt: null, reasonCode: null });
  const token = JSON.parse(fs.readFileSync(f.lock, "utf8")).token;
  appendLegacy(f, { kind: "OP", ownerToken: token, operation });
  return { operation, token };
}

test("nonce repair: reopened refuel cannot reuse a confirmed nonce across parents/accounts/contracts", () => {
  for (const context of [{ accountId: "0" }, { accountId: "1", contract: A(6) }]) {
    const f = fixture(), { s, a } = reopened(f, context);
    rejectWithoutSend(f, () => s.addChild(a.operationId, spec("1").child));
    // A larger nonce still works; the rejection neither changes bytes nor poisons valid ownership.
    const next = s.addChild(a.operationId, spec("2").child);
    assert.deepEqual(next.children.map(c => c.spec.transaction.nonce), ["0", "2"]); s.release();
  }
});

test("nonce repair: reverted and closed history still blocks reused and lower child nonces", () => {
  for (const nonce of ["1", "2"]) {
    const f = fixture(), { s, a } = reopened(f, { reverted: true, laterNonce: "2" });
    rejectWithoutSend(f, () => s.addChild(a.operationId, spec(nonce).child)); s.release();
  }
});

test("nonce repair: sibling reuse rejects while sequential refuel/pay and hash observations survive restart", () => {
  const f = fixture(), s = f.store.acquire(f.wallet), a = s.admit(spec("0", { refuel: true })); settle(s, a, H(7), "REFUELED");
  rejectWithoutSend(f, () => s.addChild(a.operationId, spec("0").child));
  const withPay = s.addChild(a.operationId, spec("1").child), c = withPay.children[1].childId;
  s.transition(a.operationId, c, patch("SUBMITTING", H(8))); s.transition(a.operationId, c, patch("UNKNOWN", H(8)));
  s.transition(a.operationId, c, patch("SUBMITTED", H(8)));
  s.transition(a.operationId, c, patch("CONFIRMED", H(8), "PAID")); s.closeOperation(a.operationId); s.release();
  const saved = openStore(f.config).inspect(f.wallet).operations[0];
  assert.deepEqual(saved.children.map(x => x.spec.transaction.nonce), ["0", "1"]);
  const t = openStore(f.config).acquire(f.wallet);
  rejectWithoutSend(f, () => t.admit(spec("1", { accountId: "1" }))); t.admit(spec("2", { accountId: "1" })); t.release();
  // The documented proof-based exception remains compatible; this is not
  // release due merely to closing a parent or failing to find a receipt.
  const g = fixture(), u = g.store.acquire(g.wallet), aborted = u.admit(spec("0"));
  u.transition(aborted.operationId, aborted.children[0].childId, patch("NOT_SUBMITTED", null));
  u.closeOperation(aborted.operationId); u.release();
  const v = openStore(g.config).acquire(g.wallet), reused = v.admit(spec("0"));
  assert.notEqual(reused.children[0].childId, aborted.children[0].childId); v.release();
  assert.deepEqual(openStore(g.config).inspect(g.wallet).operations.map(o => o.children[0].state), ["NOT_SUBMITTED", "PREPARED"]);
});

test("nonce repair: replay rejects legacy conflicts even if the later snapshot abandoned the child", () => {
  for (const laterAborted of [false, true]) {
    const f = fixture(), { a } = reopened(f), { operation, token } = legacyChild(f, a);
    if (laterAborted) {
      operation.children[1].state = "NOT_SUBMITTED";
      appendLegacy(f, { kind: "OP", ownerToken: token, operation });
      operation.status = "CLOSED"; operation.closure = "ABANDONED";
      appendLegacy(f, { kind: "OP", ownerToken: token, operation });
    }
    appendLegacy(f, { kind: "OWNER", token, action: "CLOSE" }); fs.unlinkSync(f.lock); // Model clean legacy release.
    const before = fs.readFileSync(f.journal);
    assert.throws(() => openStore(f.config).inspect(f.wallet), code("CORRUPT_STATE"));
    rejectWithoutSend(f, () => openStore(f.config).acquire(f.wallet), "CORRUPT_STATE");
    assert(!fs.existsSync(f.lock)); assert.deepEqual(fs.readFileSync(f.journal), before);
  }
});

test("nonce repair: a live SUBMITTING attempt fails closed on legacy conflicting history", () => {
  const f = fixture(), { s, a } = reopened(f), { operation } = legacyChild(f, a);
  rejectWithoutSend(f, () => s.transition(a.operationId, operation.children[1].childId, patch("SUBMITTING", H(6))), "CORRUPT_STATE");
  assert.throws(() => s.release(), code("OWNERSHIP_UNCERTAIN")); assert(fs.existsSync(f.lock));
});

test("nonce repair: shared boundary validation rejects conflicting SUBMITTING while allowing its own identity", () => {
  const f = fixture(), { a } = reopened(f);
  const prepared = structuredClone(a);
  prepared.children.push({ childId: randomUUID(), spec: spec("2").child, state: "PREPARED", transactionHash: null, outcome: null, receipt: null, reasonCode: null });
  for (const state of ["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN", "RECOVERY_REQUIRED", "CONFIRMED", "REVERTED"]) {
    const other = structuredClone(f.store.inspect(f.wallet).operations.find(o => o.intent.accountId === "1"));
    other.status = state === "CONFIRMED" || state === "REVERTED" ? "CLOSED" : "OPEN";
    other.closure = other.status === "CLOSED" ? "RESOLVED" : null;
    Object.assign(other.children[0], patch(state, state === "PREPARED" ? null : H(8), state === "CONFIRMED" ? "PAID" : null, state === "REVERTED" ? 0 : 1));
    other.children[0].spec.transaction.nonce = "2";
    operation(other, binding.wallet); // Each context record is individually schema-valid.
    const next = structuredClone(prepared);
    Object.assign(next.children[1], patch("SUBMITTING", H(6)));
    const history = new Map([[prepared.operationId, prepared], [other.operationId, other]]);
    let signs = 0, broadcasts = 0;
    assert.throws(() => { validateChange(prepared, next, binding.wallet, history); signs++; broadcasts++; }, code("NONCE_CONFLICT"));
    assert.equal(signs, 0); assert.equal(broadcasts, 0);
  }
  const next = structuredClone(prepared); Object.assign(next.children[1], patch("SUBMITTING", H(6)));
  assert.doesNotThrow(() => validateChange(prepared, next, binding.wallet, new Map([[prepared.operationId, prepared]])));
  const later = structuredClone(f.store.inspect(f.wallet).operations.find(o => o.intent.accountId === "1"));
  later.children[0].spec.transaction.nonce = "3";
  assert.throws(() => validateChange(prepared, next, binding.wallet, new Map([[prepared.operationId, prepared], [later.operationId, later]])), code("NONCE_CONFLICT"));
});
