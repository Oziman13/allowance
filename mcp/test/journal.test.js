import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { initializeStore, openStore } from "../journal.js";
import { canonical } from "../journal-schema.js";

const base = fileURLToPath(new URL("../../work/phase5a2b2a/", import.meta.url));
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(base, "tests-")), children = [];
after(() => { for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL"); fs.rmSync(run, { recursive: true, force: true }); });
const H = n => "0x" + String(n).repeat(64), A = n => "0x" + String(n).repeat(40);
const walletBinding = { chainId: "31337", genesisHash: H(1), wallet: A(2) };
const fault = code => Object.assign(new Error("injected filesystem failure"), { code });
const isCode = code => e => e.code === code;
function spec({ accountId = "0", nonce = "0", refuel = false } = {}) {
  const intent = { kind: "pay", contract: A(3), accountId, asset: A(0), recipient: A(4), amountRaw: "100", memoHash: H(5), requestId: null };
  const child = { kind: refuel ? "refuel" : "pay", recipient: refuel ? walletBinding.wallet : intent.recipient,
    amountRaw: refuel ? "20" : intent.amountRaw, memoHash: refuel ? null : intent.memoHash, requestId: null,
    transaction: { nonce, type: 2, valueRaw: "0", gasLimit: "21000", maxFeePerGas: "3000000000", maxPriorityFeePerGas: "1000000000", calldataHash: H(6) } };
  return { intent, child };
}
function fixture(io = fs) {
  const parent = fs.mkdtempSync(path.join(run, "case-")), stateDir = path.join(parent, "state");
  const store = initializeStore({ stateDir, io }), opened = openStore({ ...store, io }), wallet = opened.createWallet(walletBinding);
  const dir = path.join(stateDir, createHash("sha256").update(canonical(walletBinding)).digest("hex"));
  return { parent, store, opened, wallet, dir, journal: path.join(dir, "journal.jsonl"), lock: path.join(dir, "owner.lock") };
}
const patch = (state, transactionHash = H(8), outcome = null, receipt = null) => ({ state, transactionHash, outcome, receipt, reasonCode: null });
const receipt = (hash = H(8), status = 1) => ({ transactionHash: hash, blockHash: H(9), blockNumber: "42", status });
function confirm(session, o, outcome = "PAID", hash = H(8)) {
  const c = o.children.at(-1).childId;
  session.transition(o.operationId, c, patch("SUBMITTING", hash));
  session.transition(o.operationId, c, patch("SUBMITTED", hash));
  return session.transition(o.operationId, c, patch("CONFIRMED", hash, outcome, receipt(hash)));
}
function rewriteLine(file, index, fn) {
  const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n"), old = JSON.parse(lines[index]);
  delete old.digest; fn(old); lines[index] = canonical({ ...old, digest: createHash("sha256").update(canonical(old)).digest("hex") });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}
function worker(mode, f, value = spec()) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./helpers/journal-process.mjs", import.meta.url)), mode,
    JSON.stringify({ store: f.store, wallet: f.wallet, spec: value })], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child); let output = "", stderr = "";
  child.stdout.on("data", x => { output += x; }); child.stderr.on("data", x => { stderr += x; });
  const exited = once(child, "exit");
  return { child, exited, async result() { await timeout(exited); assert.equal(stderr, ""); return JSON.parse(output.trim()); },
    async checkpoint() { await until(() => output.includes("\n")); return JSON.parse(output.trim()); } };
}
async function until(fn) { const end = Date.now() + 8000; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error("checkpoint timeout"); }
async function timeout(p) { let timer; try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("process timeout")), 8000); })]); } finally { clearTimeout(timer); } }

test("journal: private store/bootstrap and journal naming are synced before successful creation", () => {
  const events = [], io = { ...fs, fsyncSync(fd) { events.push(fs.fstatSync(fd).isDirectory() ? "directory" : "file"); fs.fsyncSync(fd); } };
  const f = fixture(io);
  assert.equal(fs.statSync(f.store.stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.journal).mode & 0o777, 0o600);
  assert(events.filter(x => x === "file").length >= 5); assert(events.filter(x => x === "directory").length >= 8);
  assert.equal(f.opened.inspect(f.wallet).ownerOpen, false);
  assert.throws(() => initializeStore(f.store)); // existing state is never reinitialized
  assert.throws(() => f.opened.createWallet(walletBinding));
});

test("journal: exact identity, opaque stable IDs and complete state transitions survive reopen", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), value = spec({ accountId: String(1n << 200n) });
  const o = s.admit(value), c = o.children[0].childId;
  assert.match(o.operationId, /^[0-9a-f-]{36}$/);
  assert.throws(() => s.transition(o.operationId, c, patch("CONFIRMED", H(8), "PAID", receipt())), isCode("INVALID_TRANSITION"));
  for (const state of ["SUBMITTING", "SUBMITTED", "UNKNOWN", "RECOVERY_REQUIRED"]) s.transition(o.operationId, c, patch(state));
  s.transition(o.operationId, c, patch("CONFIRMED", H(8), "PAID", receipt()));
  s.closeOperation(o.operationId); s.transition(o.operationId, c, patch("RECOVERY_REQUIRED", H(8), "PAID", receipt()));
  s.transition(o.operationId, c, patch("REVERTED", H(8), null, receipt(H(8), 0)));
  s.closeOperation(o.operationId); s.release();
  const read = openStore(f.store).inspect(f.wallet);
  assert.equal(read.operations[0].operationId, o.operationId);
  assert.equal(read.operations[0].children[0].childId, c);
  assert.equal(read.operations[0].intent.accountId, String(1n << 200n));
  assert.equal(read.operations[0].children[0].state, "REVERTED");
  const next = openStore(f.store).acquire(f.wallet);
  assert.throws(() => next.admit(spec()), isCode("NONCE_CONFLICT"));
  next.admit(spec({ nonce: "1" })); next.release();
});

test("journal: refuel/payment children require confirmed prior progress and preserve partial abandonment", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), o = s.admit(spec({ refuel: true }));
  assert.throws(() => s.addChild(o.operationId, spec({ nonce: "1" }).child), isCode("INVALID_TRANSITION"));
  confirm(s, o, "REFUELED");
  assert.throws(() => s.addChild(o.operationId, spec().child), isCode("NONCE_CONFLICT"));
  const withPay = s.addChild(o.operationId, spec({ nonce: "1" }).child);
  assert.equal(withPay.children[0].state, "CONFIRMED"); assert.equal(withPay.children.length, 2);
  s.transition(o.operationId, withPay.children[1].childId, patch("NOT_SUBMITTED", null));
  s.closeOperation(o.operationId, "ABANDONED"); s.release();
  const saved = f.opened.inspect(f.wallet).operations[0];
  assert.equal(saved.closure, "ABANDONED"); assert.equal(saved.children[0].outcome, "REFUELED");
  assert.equal(saved.children[1].state, "NOT_SUBMITTED");
});

test("journal: unresolved operations block all accounts/contracts sharing a wallet", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), o = s.admit(spec());
  const other = spec({ accountId: "1", nonce: "1" }); other.intent.contract = A(7);
  assert.throws(() => s.admit(other), isCode("UNRESOLVED_OPERATION"));
  assert.throws(() => s.closeOperation(o.operationId), isCode("UNRESOLVED_OPERATION"));
  const independent = f.opened.createWallet({ ...walletBinding, wallet: A(7) }), t = f.opened.acquire(independent);
  t.admit(spec()); t.release();
  s.transition(o.operationId, o.children[0].childId, patch("NOT_SUBMITTED", null)); s.closeOperation(o.operationId); s.release();
});

test("journal: new contradictions block SUBMITTING and receipts must preserve exact hash/outcome", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), first = s.admit(spec());
  confirm(s, first); s.closeOperation(first.operationId);
  const next = s.admit(spec({ nonce: "1" })), c = next.children[0].childId;
  s.transition(first.operationId, first.children[0].childId, patch("RECOVERY_REQUIRED", H(8), "PAID", receipt()));
  const before = fs.readFileSync(f.journal, "utf8"); let simulatedBroadcasts = 0;
  assert.throws(() => { s.transition(next.operationId, c, patch("SUBMITTING", H(7))); simulatedBroadcasts++; }, isCode("UNRESOLVED_OPERATION"));
  assert.equal(simulatedBroadcasts, 0); assert.equal(fs.readFileSync(f.journal, "utf8"), before);
  s.transition(first.operationId, first.children[0].childId, patch("CONFIRMED", H(8), "PAID", receipt())); s.closeOperation(first.operationId);
  s.transition(next.operationId, c, patch("SUBMITTING", H(7))); s.transition(next.operationId, c, patch("SUBMITTED", H(7)));
  for (const [outcome, r] of [["PAID", receipt()], ["REFUELED", receipt(H(7))], ["PAID", receipt(H(7), 0)]])
    assert.throws(() => s.transition(next.operationId, c, patch("CONFIRMED", H(7), outcome, r)), isCode("INVALID_RECEIPT"));
  s.release();
});

test("journal: cancellation identity is durable and release sync failures revoke old ownership", () => {
  let armed = false, directorySyncs = 0;
  const io = { ...fs, fsyncSync(fd) {
    if (armed && fs.fstatSync(fd).isDirectory() && ++directorySyncs === 2) throw fault("EIO");
    fs.fsyncSync(fd);
  } };
  const f = fixture(io), s = f.opened.acquire(f.wallet), value = spec();
  value.intent = { ...value.intent, kind: "cancel", recipient: null, amountRaw: "0", memoHash: null, requestId: "9007199254740993" };
  value.child = { ...value.child, kind: "cancel", recipient: null, amountRaw: "0", memoHash: null, requestId: value.intent.requestId };
  const o = s.admit(value); confirm(s, o, "CANCELLED"); s.closeOperation(o.operationId); armed = true;
  assert.throws(() => s.release(), e => e.fsCode === "EIO");
  assert.throws(() => s.admit(spec({ nonce: "1" })), isCode("OWNERSHIP_UNCERTAIN"));
  // CLOSE was file+directory synced before unlink. A fresh explicit acquisition
  // re-establishes naming durability; it does not revive the old capability.
  const reopened = openStore(f.store), fresh = reopened.acquire(f.wallet);
  assert.equal(reopened.inspect(f.wallet).operations[0].intent.requestId, "9007199254740993"); fresh.release();
});

test("journal: strict input rejects secrets, SDK errors, numeric loss and identity changes without writes", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), original = fs.readFileSync(f.journal, "utf8");
  const secret = "PRIVATE-SEED-PHRASE-DO-NOT-STORE", raw = "0x02" + "ab".repeat(200);
  const bad = [];
  for (const [key, v] of [["privateKey", secret], ["seedPhrase", secret], ["signedTransaction", raw], ["error", new Error(secret)]]) { const x = spec(); x[key] = v; bad.push(x); }
  const numeric = spec(); numeric.intent.amountRaw = 100; bad.push(numeric);
  const noncanonical = spec(); noncanonical.child.transaction.nonce = "01"; bad.push(noncanonical);
  const unsafe = spec(); unsafe.child.transaction.sender = A(7); bad.push(unsafe);
  let invoked = false; const hidden = spec(); Object.defineProperty(hidden.intent, "toJSON", { value() { invoked = true; return secret; } }); bad.push(hidden);
  for (const x of bad) assert.throws(() => s.admit(x));
  assert.equal(invoked, false); assert.equal(fs.readFileSync(f.journal, "utf8"), original);
  const o = s.admit(spec()), c = o.children[0].childId;
  s.transition(o.operationId, c, patch("SUBMITTING"));
  assert.throws(() => s.transition(o.operationId, c, patch("UNKNOWN", H(7))), isCode("IDENTITY_MISMATCH"));
  assert(!fs.readFileSync(f.journal, "utf8").includes(secret)); assert(!fs.readFileSync(f.journal, "utf8").includes(raw));
});

test("journal: invalid operation IDs and traversal never select filesystem paths", () => {
  const f = fixture(), s = f.opened.acquire(f.wallet), before = fs.readFileSync(f.journal, "utf8");
  for (const value of ["../owner.lock", "/etc/passwd", "", "a/../../b", "x\0y"]) {
    assert.throws(() => s.closeOperation(value), isCode("INVALID_ID"));
    assert.throws(() => s.transition(value, value, patch("UNKNOWN")), isCode("INVALID_ID"));
  }
  assert.equal(fs.readFileSync(f.journal, "utf8"), before); s.release();
  assert.throws(() => openStore({ ...f.store, stateDir: f.parent + "/../" + path.basename(f.parent) + "/state" }), isCode("UNSAFE_PATH"));
  assert.throws(() => f.opened.acquire({ ...f.wallet, journalId: "00000000-0000-4000-8000-000000000000" }), isCode("IDENTITY_MISMATCH"));
  assert(!fs.existsSync(f.lock));
});

test("journal: unknown schemas, checksums and truncated seals fail closed on reopen", () => {
  for (const mode of ["version", "checksum", "torn", "boundary", "extra-field"]) {
    const f = fixture(), s = f.opened.acquire(f.wallet); s.admit(spec()); s.release();
    if (mode === "version") rewriteLine(f.journal, 0, v => { v.schemaVersion = 2; });
    if (mode === "checksum") fs.writeFileSync(f.journal, fs.readFileSync(f.journal, "utf8").replace('"amountRaw":"100"', '"amountRaw":"101"'));
    if (mode === "torn") fs.truncateSync(f.journal, fs.statSync(f.journal).size - 9);
    if (mode === "boundary") { const lines = fs.readFileSync(f.journal, "utf8").trimEnd().split("\n"); fs.writeFileSync(f.journal, lines.slice(0, -2).join("\n") + "\n"); }
    if (mode === "extra-field") rewriteLine(f.journal, 0, v => { v.extra = "unexpected"; });
    assert.throws(() => f.opened.inspect(f.wallet), isCode(mode === "version" ? "UNSUPPORTED_SCHEMA" : "CORRUPT_STATE"));
    let broadcasts = 0; try { f.opened.acquire(f.wallet).admit(spec()); broadcasts++; } catch {}
    assert.equal(broadcasts, 0); assert(!fs.existsSync(f.lock));
  }
});

test("journal: root manifest versions, missing state and binding mismatches never bootstrap silently", () => {
  const f = fixture(); rewriteLine(path.join(f.store.stateDir, "store.json"), 0, v => { v.schemaVersion = 99; });
  assert.throws(() => openStore(f.store), isCode("UNSUPPORTED_SCHEMA"));
  const g = fixture(); fs.unlinkSync(g.journal);
  assert.throws(() => g.opened.acquire(g.wallet)); assert.throws(() => g.opened.createWallet(walletBinding));
  const h = fixture(); assert.throws(() => openStore({ ...h.store, storeId: "00000000-0000-4000-8000-000000000000" }), isCode("IDENTITY_MISMATCH"));
  assert.throws(() => h.opened.acquire({ ...h.wallet, binding: { ...walletBinding, chainId: "1" } }));
});

test("journal: symlinks, hardlinks, writable permissions and lock substitution are rejected", () => {
  for (const target of ["root", "journal", "lock", "hardlink", "permissions", "substitute"]) {
    const f = fixture(), sentinel = path.join(f.parent, "sentinel"); fs.writeFileSync(sentinel, "untouched", { mode: 0o600 });
    if (target === "root") { const alias = path.join(f.parent, "alias"); fs.symlinkSync(f.store.stateDir, alias); assert.throws(() => openStore({ ...f.store, stateDir: alias })); }
    if (target === "journal") { fs.unlinkSync(f.journal); fs.symlinkSync(sentinel, f.journal); assert.throws(() => f.opened.acquire(f.wallet)); }
    if (target === "lock") { fs.symlinkSync(sentinel, f.lock); assert.throws(() => f.opened.acquire(f.wallet)); assert(fs.lstatSync(f.lock).isSymbolicLink()); }
    if (target === "hardlink") { fs.linkSync(f.journal, path.join(f.parent, "linked")); assert.throws(() => f.opened.acquire(f.wallet), isCode("UNSAFE_FILE")); }
    if (target === "permissions") { fs.chmodSync(f.journal, 0o644); assert.throws(() => f.opened.acquire(f.wallet), isCode("UNSAFE_FILE")); }
    if (target === "substitute") { const s = f.opened.acquire(f.wallet); rewriteLine(f.lock, 0, v => { v.token = "00000000-0000-4000-8000-000000000000"; }); assert.throws(() => s.admit(spec()), isCode("OWNERSHIP_UNCERTAIN")); assert.throws(() => s.release()); }
    assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched");
  }
});

test("journal: short writes complete, but zero/partial failed writes poison admission", () => {
  const io = { ...fs, writeSync(fd, buf, offset, length, position) { return fs.writeSync(fd, buf, offset, Math.min(7, length), position); } };
  const good = fixture(io), s = good.opened.acquire(good.wallet); s.admit(spec()); s.release(); assert.equal(good.opened.inspect(good.wallet).operations.length, 1);
  for (const mode of ["zero", "partial", "full-disk", "permission"]) {
    let armed = false, wrote = false;
    const adapter = { ...fs, writeSync(fd, b, o, n, p) {
      if (!armed) return fs.writeSync(fd, b, o, n, p);
      if (mode === "zero") return 0;
      if (mode === "partial" && !wrote) { wrote = true; return fs.writeSync(fd, b, o, Math.min(37, n), p); }
      throw fault(mode === "permission" ? "EACCES" : "ENOSPC");
    } };
    const f = fixture(adapter), owner = f.opened.acquire(f.wallet); armed = true; let broadcasts = 0;
    assert.throws(() => { const op = owner.admit(spec()); owner.transition(op.operationId, op.children[0].childId, patch("SUBMITTING")); broadcasts++; });
    assert.equal(broadcasts, 0); assert.throws(() => owner.admit(spec())); assert.throws(() => owner.release()); assert(fs.existsSync(f.lock));
    if (mode === "partial") assert.throws(() => openStore(f.store).inspect(f.wallet), isCode("CORRUPT_STATE"));
  }
});

test("journal: file/directory fsync faults at bootstrap, acquisition and admission never admit", () => {
  for (const stage of ["store", "wallet", "acquire", "admit"]) for (const kind of ["file", "directory"]) {
    let armed = false;
    const io = { ...fs, fsyncSync(fd) { if (armed && (fs.fstatSync(fd).isDirectory() ? "directory" : "file") === kind) throw fault("EIO"); fs.fsyncSync(fd); } };
    const parent = fs.mkdtempSync(path.join(run, "sync-")); let store, opened, wallet, session, broadcasts = 0;
    if (stage === "store") armed = true;
    try {
      store = initializeStore({ stateDir: path.join(parent, "state"), io }); opened = openStore({ ...store, io });
      if (stage === "wallet") armed = true;
      wallet = opened.createWallet(walletBinding);
      if (stage === "acquire") armed = true;
      session = opened.acquire(wallet);
      if (stage === "admit") armed = true;
      const op = session.admit(spec()); session.transition(op.operationId, op.children[0].childId, patch("SUBMITTING")); broadcasts++;
    } catch (e) { assert.equal(e.code, "FILESYSTEM_ERROR"); assert.equal(e.fsCode, "EIO"); }
    assert.equal(broadcasts, 0, `${stage}/${kind}`);
    if (session) { assert.throws(() => session.admit(spec())); assert.throws(() => session.release()); }
  }
});

test("journal: failed journal creation preserves incomplete state instead of repairing it", () => {
  for (const code of ["ENOSPC", "EACCES"]) {
    const f = fixture(), other = { ...walletBinding, wallet: A(8) };
    const io = { ...fs, openSync(p, flags, mode) { if (p.endsWith("journal.jsonl") && (flags & fs.constants.O_CREAT)) throw fault(code); return fs.openSync(p, flags, mode); } };
    const store = openStore({ ...f.store, io }); assert.throws(() => store.createWallet(other), e => e.fsCode === code);
    assert.throws(() => f.opened.createWallet(other));
  }
});

test("journal: unsupported filesystem/platform and broadened directory permissions fail closed", () => {
  const f = fixture();
  assert.throws(() => openStore({ ...f.store, io: { ...fs, statfsSync() { return { type: 0x6969 }; } } }), isCode("UNSUPPORTED_FILESYSTEM"));
  fs.chmodSync(f.store.stateDir, 0o750); assert.throws(() => openStore(f.store), isCode("UNSAFE_PERMISSIONS")); fs.chmodSync(f.store.stateDir, 0o700);
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  try { Object.defineProperty(process, "platform", { value: "win32" }); assert.throws(() => openStore(f.store), isCode("UNSUPPORTED_PLATFORM")); }
  finally { Object.defineProperty(process, "platform", original); }
});

test("journal: release errors revoke the capability; no PID or time-based ownership takeover", () => {
  let armed = false;
  const io = { ...fs, unlinkSync(p) { if (armed && p.endsWith("owner.lock")) throw fault("EACCES"); fs.unlinkSync(p); } };
  const f = fixture(io), s = f.opened.acquire(f.wallet); armed = true;
  assert.throws(() => s.release(), e => e.fsCode === "EACCES"); assert.throws(() => s.admit(spec()), isCode("OWNERSHIP_UNCERTAIN"));
  fs.utimesSync(f.lock, new Date(0), new Date(0));
  assert.throws(() => openStore(f.store).acquire(f.wallet), isCode("WALLET_BUSY"));
});

test("journal processes: concurrent ownership and SIGKILL stay blocked without stale-lock deletion", async () => {
  const f = fixture(), a = worker("hold", f); assert.equal((await a.checkpoint()).checkpoint, "ownership-acquired");
  const token = fs.readFileSync(f.lock, "utf8"); const b = await worker("try", f, spec({ accountId: "1" })).result();
  assert.equal(b.code, "WALLET_BUSY"); assert.equal(b.simulatedBroadcasts, 0);
  a.child.kill("SIGKILL"); assert.equal((await timeout(a.exited))[1], "SIGKILL");
  const restart = await worker("try", f).result(); assert.equal(restart.code, "WALLET_BUSY"); assert.equal(restart.simulatedBroadcasts, 0);
  assert.equal(fs.readFileSync(f.lock, "utf8"), token);
  fs.unlinkSync(f.lock); // adversarial/manual deletion is NOT a supported recovery operation
  assert.throws(() => f.opened.acquire(f.wallet), isCode("OWNERSHIP_UNCERTAIN"));
});

test("journal processes: clean restart preserves unresolved IDs and refuses a second account", async () => {
  const f = fixture(), first = await worker("admit", f).result(); assert.equal(first.simulatedBroadcasts, 0);
  const second = await worker("try", f, spec({ accountId: "1", nonce: "1" })).result();
  assert.equal(second.code, "UNRESOLVED_OPERATION"); assert.equal(second.simulatedBroadcasts, 0);
  assert.equal(f.opened.inspect(f.wallet).operations[0].operationId, first.operationId);
});

test("journal processes: torn-write and durable-before-ack termination do not permit replay", async () => {
  for (const mode of ["torn", "durable"]) {
    const f = fixture(), child = worker(mode, f); await child.checkpoint(); child.child.kill("SIGKILL"); await timeout(child.exited);
    if (mode === "torn") assert.throws(() => f.opened.inspect(f.wallet), isCode("CORRUPT_STATE"));
    else { const read = f.opened.inspect(f.wallet); assert.equal(read.operations[0].children[0].state, "PREPARED"); }
    const restarted = await worker("try", f).result(); assert.equal(restarted.simulatedBroadcasts, 0); assert.equal(restarted.admitted, false);
  }
});
