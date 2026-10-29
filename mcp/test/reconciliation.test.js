// Real localhost Anvil runtime; RPC faults are explicit relay fixtures, not V3 evidence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { ethers } from "ethers";
import { initializeStore, openStore, openReader } from "../journal.js";
import { createLocalReconciler } from "../local-reconcile.js";
import { confirmLocalOperation } from "../local-confirm.js";
import { canonical } from "../journal-schema.js";
import { createLocalBroadcastAdapter } from "../local-broadcast.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const base = path.join(ROOT, "work/reconciliation"); fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(base, "integration-")), fixtures = [], children = [];
const RPC = "http://127.0.0.1:8559", ADDRESS = "0x000000000000000000000000000000000000a110";
const ANVIL = process.env.ANVIL || "anvil", E = ethers.parseEther, amount = E("0.1");
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public Anvil fixture
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "out/Allowance.sol/Allowance.json")));
const iface = new ethers.Interface(artifact.abi), codeHash = ethers.keccak256(artifact.deployedBytecode.object);
let anvil, provider, owner, al, genesis, serial = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = c => Object.assign(new Error("injected disk failure"), { code: c });
async function until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(10); } throw Error("fixture deadline"); }
async function bounded(p) { let timer; try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("worker deadline")), 8000); })]); } finally { clearTimeout(timer); } }
function forward(url, value) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(value), req = http.request(url, { method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, res => {
      let text = ""; res.on("data", x => { text += x; }); res.on("end", () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } }); res.on("error", reject);
    }); req.on("error", reject); req.end(body);
  });
}
before(async () => {
  anvil = spawn(ANVIL, ["--host", "127.0.0.1", "--port", "8559", "--silent"], { stdio: "ignore" });
  provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  await until(async () => { try { await provider.getBlockNumber(); return true; } catch { return false; } });
  // No deployment transaction. Slot 5 (_lock) is verified by solc storageLayout;
  // successful nonReentrant open/pay execution also checks the fixture setup.
  await provider.send("anvil_setCode", [ADDRESS, artifact.deployedBytecode.object]);
  await provider.send("anvil_setStorageAt", [ADDRESS, ethers.toBeHex(5n, 32), ethers.toBeHex(1n, 32)]);
  owner = new ethers.NonceManager(new ethers.Wallet(OWNER_KEY, provider)); al = new ethers.Contract(ADDRESS, artifact.abi, owner);
  genesis = (await provider.getBlock(0)).hash.toLowerCase();
});
after(async () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const f of fixtures) { for (const s of f.sockets) s.destroy(); await new Promise(r => f.server.close(r)); }
  try { await provider?.send("evm_setAutomine", [true]); } catch {}
  provider?.destroy(); anvil?.kill(); fs.rmSync(run, { recursive: true, force: true });
});
const rules = { perPayment: E("1"), perPeriod: E("3"), period: 86400, expiresAt: 0, trustedOnly: false };
async function open(agent, seed = "1") {
  const id = String(await al.accountCount());
  await (await al.openAccount(agent, ethers.ZeroAddress, "local adapter fixture", rules, [], E("5"), E(seed), { value: E("5") + E(seed) })).wait(); return id;
}
async function fixture() {
  const key = ethers.keccak256(ethers.toUtf8Bytes("public-reconciliation-agent-" + ++serial));
  const agent = new ethers.Wallet(key), recipient = new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes("public-reconciliation-recipient-" + serial))).address.toLowerCase();
  const id = await open(agent.address), root = fs.mkdtempSync(path.join(run, "case-")), state = initializeStore({ stateDir: path.join(root, "state") });
  const store = openStore(state), binding = { chainId: "31337", genesisHash: genesis, wallet: agent.address.toLowerCase() }, wallet = store.createWallet(binding);
  const dir = path.join(state.stateDir, ethers.sha256(ethers.toUtf8Bytes(canonical(binding))).slice(2));
  const f = { key, agent, id, recipient, state, store, wallet, journal: path.join(dir, "journal.jsonl"), lock: path.join(dir, "owner.lock"), mode: null,
    attempts: [], forwarded: [], raw: [], methods: [], gates: [], sockets: new Set(), accepted: 0, baseFee: null, estimate: null };
  f.server = http.createServer(async (req, res) => {
    try {
      let text = ""; for await (const x of req) text += x;
      const v = JSON.parse(text); f.methods.push(v.method);
      if (f.mode === "chain" && v.method === "eth_chainId") { res.end(JSON.stringify({ jsonrpc: "2.0", id: v.id, result: "0x190f1b89" })); return; }
      if (f.mode === "code" && v.method === "eth_getCode") { res.end(JSON.stringify({ jsonrpc: "2.0", id: v.id, result: "0x00" })); return; }
      if (f.mode === "stale-nonce" && v.method === "eth_getTransactionCount") { res.end(JSON.stringify({ jsonrpc: "2.0", id: v.id, result: "0x0" })); return; }
      const tx = v.method === "eth_sendRawTransaction" ? ethers.Transaction.from(v.params[0]) : null;
      if (tx) {
        f.attempts.push({ hash: tx.hash, nonce: tx.nonce }); f.raw.push(v.params[0]);
        const recorded = f.store.inspect(f.wallet).operations.at(-1).children.at(-1);
        f.gates.push({ state: recorded.state, hashMatches: recorded.transactionHash === tx.hash });
        f.forwarded.push(tx.hash);
      }
      if (f.beforeRpc) await f.beforeRpc(v);
      const result = await forward(RPC, v);
      if (f.transform) await f.transform(v, result);
      if (v.method === "eth_getBlockByNumber" && v.params[0] === "latest") f.baseFee = BigInt(result.result.baseFeePerGas);
      if (v.method === "eth_estimateGas" && result.result) f.estimate = BigInt(result.result);
      if (tx && !result.error) {
        f.accepted++;
        if (f.mode === "duplicate") { f.forwarded.push(tx.hash); await forward(RPC, v); }
        if (f.mode === "hold") return; // process-death fixture; never release an acknowledgement
        if (f.mode === "socket") { res.destroy(); return; }
        if (f.mode === "rpc") { res.end(JSON.stringify({ jsonrpc: "2.0", id: v.id, error: { code: -32000, message: "injected after acceptance" } })); return; }
        if (f.mode === "429") { res.writeHead(429, { "retry-after": "1" }); res.end("{}"); return; }
        if (f.mode === "redirect") { res.writeHead(302, { location: f.options.rpcUrl }); res.end("{}"); return; }
        if (f.mode === "wrong-hash") result.result = "0x" + "9".repeat(64);
      }
      res.end(JSON.stringify(result));
    } catch { if (!res.destroyed) { res.statusCode = 500; res.end("fixture error"); } }
  });
  f.server.on("connection", s => { f.sockets.add(s); s.on("close", () => f.sockets.delete(s)); });
  await new Promise(r => f.server.listen(0, "127.0.0.1", r));
  f.options = { mode: "anvil-journal", rpcUrl: `http://127.0.0.1:${f.server.address().port}`, key, contract: ADDRESS, accountId: id, expectedCodeHash: codeHash, state, wallet };
  f.input = { recipient, amountRaw: String(amount), memo: "isolated local payment" };
  f.adapter = (extra = {}) => createLocalBroadcastAdapter({ ...f.options, ...extra }); fixtures.push(f); return f;
}
async function rejection(p, expected) { let error; try { await p; } catch (e) { error = e; } assert(error, "expected rejection"); if (expected) assert.equal(error.code, expected); return error; }
async function paid(f, hash, expected = amount) {
  const receipt = await provider.getTransactionReceipt(hash); assert.equal(receipt.status, 1);
  const event = receipt.logs.filter(l => l.address.toLowerCase() === ADDRESS).map(l => { try { return iface.parseLog(l); } catch { return null; } }).find(e => e?.name === "Paid");
  assert(event); assert.equal(event.args.accountId, BigInt(f.id)); assert.equal(event.args.to.toLowerCase(), f.recipient); assert.equal(event.args.amount, expected); assert.equal(event.args.memo, f.input.memo);
  assert.equal(await provider.getBalance(f.recipient), expected); assert.equal((await al.getAccount(f.id))[0].balance, E("5") - expected);
}
function noSecrets(f) {
  const text = fs.readFileSync(f.journal, "utf8"); assert(!text.includes(f.key)); assert(!text.includes(OWNER_KEY)); assert(!text.includes(f.input.memo));
  for (const raw of f.raw) { assert(!text.includes(raw)); assert(!text.includes(ethers.Transaction.from(raw).signature.serialized)); }
}
async function countSigns(f, fn) {
  const original = ethers.Wallet.prototype.signTransaction; let calls = 0;
  ethers.Wallet.prototype.signTransaction = function(tx) { if (this.address.toLowerCase() === f.agent.address.toLowerCase()) { calls++; assert.equal(this.provider, null); } return original.call(this, tx); };
  try { await fn(() => calls); } finally { ethers.Wallet.prototype.signTransaction = original; }
}
function worker(f, mode, options = f.options) {
  const { key, ...safe } = options;
  const child = spawn(process.execPath, [fileURLToPath(new URL("./helpers/local-broadcast-process.mjs", import.meta.url)), JSON.stringify({ mode, options: safe, input: f.input })],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCAL_ADAPTER_FIXTURE_KEY: key } });
  children.push(child); let output = "", stderr = ""; child.stdout.on("data", x => { output += x; }); child.stderr.on("data", x => { stderr += x; }); const exited = once(child, "exit");
  return { child, exited, async checkpoint() { await until(() => output.includes("\n")); assert.equal(stderr, ""); return JSON.parse(output.trim()); },
    async result() { await bounded(exited); assert.equal(stderr, ""); return JSON.parse(output.trim()); } };
}

const readOptions = (f, extra = {}) => { const { key, ...rest } = f.options; return { ...rest, ...extra }; };
const ref = out => [out.operationId, out.childId];
const one = { maxPolls: 1 };
const observe = (f, out, control = one, extra = {}) => createLocalReconciler(readOptions(f, extra)).reconcile(...ref(out), control);
function rewriteEvent(log, name, values) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), values); log.topics = encoded.topics; log.data = encoded.data;
}
// Explicit local fixture transaction producer for historical refuel/cancel/held
// evidence. The adapter itself continues to reject those execution routes.
async function recorded(f, { kind = "pay", rawAmount = amount, requestId = null, send = true, beforeSend = null } = {}) {
  const memoHash = ethers.keccak256(ethers.toUtf8Bytes(f.input.memo));
  const intent = kind === "cancel" ? { kind, contract: ADDRESS, accountId: f.id, asset: ethers.ZeroAddress, recipient: null, amountRaw: "0", memoHash: null, requestId }
    : { kind: "pay", contract: ADDRESS, accountId: f.id, asset: ethers.ZeroAddress, recipient: f.recipient, amountRaw: String(kind === "refuel" ? amount : rawAmount), memoHash, requestId: null };
  const data = iface.encodeFunctionData(kind, kind === "cancel" ? [requestId] : kind === "refuel" ? [f.id, rawAmount] : [f.id, f.recipient, rawAmount, f.input.memo]);
  const s = f.store.acquire(f.wallet), baseFee = (await provider.getBlock("latest")).baseFeePerGas;
  const unsigned = { type: 2, chainId: 31337n, nonce: await provider.getTransactionCount(f.agent.address, "pending"), to: ADDRESS, value: 0n, data,
    gasLimit: await provider.estimateGas({ from: f.agent.address, to: ADDRESS, data }), maxFeePerGas: 2n * baseFee + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  const op = s.admit({ intent, child: { kind, recipient: kind === "refuel" ? f.agent.address.toLowerCase() : intent.recipient,
    amountRaw: kind === "cancel" ? "0" : String(rawAmount), memoHash: kind === "refuel" ? null : intent.memoHash, requestId,
    transaction: { nonce: String(unsigned.nonce), type: 2, valueRaw: "0", gasLimit: String(unsigned.gasLimit), maxFeePerGas: String(unsigned.maxFeePerGas),
      maxPriorityFeePerGas: String(unsigned.maxPriorityFeePerGas), calldataHash: ethers.keccak256(data) } } });
  const raw = await f.agent.signTransaction(unsigned), transactionHash = ethers.keccak256(raw), childId = op.children[0].childId;
  const patch = state => ({ state, transactionHash, outcome: null, receipt: null, reasonCode: null });
  s.transition(op.operationId, childId, patch("SUBMITTING"));
  if (send) { if (beforeSend) await beforeSend(); await provider.send("eth_sendRawTransaction", [raw]); s.transition(op.operationId, childId, patch("SUBMITTED")); }
  s.release(); return { operationId: op.operationId, childId, transactionHash };
}
async function keylessWorker(f, out) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./helpers/reconciliation-process.mjs", import.meta.url)), JSON.stringify({ options: readOptions(f), ...out })],
    { stdio: ["ignore", "pipe", "pipe"], env: {} });
  children.push(child); let output = "", stderr = ""; child.stdout.on("data", v => { output += v; }); child.stderr.on("data", v => { stderr += v; });
  await bounded(once(child, "exit")); assert.equal(stderr, ""); return JSON.parse(output.trim());
}

test("reconciliation: exact Paid evidence is persisted only by explicit confirmation; keyless reader cannot write or sign", async () => {
  const f = await fixture(), a = f.adapter(), out = await a.pay(f.input); await paid(f, out.transactionHash);
  for (const extra of [{ key: f.key }, { rpcUrl: "https://test-evm-rpc-v3.portaldot.dev" }, { mode: "portaldot-testnet" }]) assert.throws(() => createLocalReconciler(readOptions(f, extra)));
  const neverRead = f.methods.length;
  await rejection(observe(f, { ...out, operationId: "../../outside" })); assert.equal(f.methods.length, neverRead);
  const before = fs.readFileSync(f.journal), methods = f.methods.length;
  const readonly = { ...fs, fsyncSync() { throw Error("reader fsync forbidden"); }, writeSync() { throw Error("reader write forbidden"); },
    openSync(p, flags, ...args) { assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT), 0); return fs.openSync(p, flags, ...args); } };
  await countSigns(f, async signs => {
    const seen = await observe(f, out, one, { io: readonly }); assert.equal(seen.observation, "CONFIRMED"); assert.equal(seen.outcome, "PAID");
    assert.equal(seen.transactionHash, out.transactionHash); assert.equal(seen.policy.independentV3Finality, false); assert(seen.freshness.observedAt);
    assert.equal(signs(), 0); assert.deepEqual(fs.readFileSync(f.journal), before);
    assert(!f.methods.slice(methods).some(m => /send|sign|estimateGas/.test(m)));
    const result = await a.confirm(...ref(out), one); assert.equal(result.journalState, "CONFIRMED"); assert.equal(signs(), 0);
    const c = a.inspect().operations[0].children[0]; assert.equal(c.receipt.transactionHash, out.transactionHash); assert.equal(c.evidence.event.name, "Paid");
    assert.equal(c.evidence.policy, "ANVIL_CANONICAL_V1"); assert.equal(f.attempts.length, 1); noSecrets(f);
    assert.equal((await keylessWorker(f, out)).signs, 0);
  });
});

test("reconciliation: delayed inclusion is pending, then bounded confirmation observes the actual payment", async () => {
  const f = await fixture(); await provider.send("evm_setAutomine", [false]);
  try {
    const a = f.adapter(), out = await a.pay(f.input), pending = await observe(f, out);
    assert.equal(pending.observation, "PENDING"); assert.equal(pending.outcome, null); assert.equal(await provider.getBalance(f.recipient), 0n);
    let reads = 0;
    f.beforeRpc = async v => { if (v.method === "eth_getTransactionReceipt" && ++reads === 2) { await sleep(60); await provider.send("evm_mine", []); } };
    const result = await a.confirm(...ref(out), { timeoutMs: 2000, pollMs: 25 });
    assert.equal(result.observation, "CONFIRMED", JSON.stringify(result)); assert(result.polls >= 2);
    await paid(f, out.transactionHash); assert.equal(f.attempts.length, 1);
  } finally { await provider.send("evm_setAutomine", [true]); }
});

test("reconciliation: the deadline bounds slow context and receipt RPCs, preserving hash and preventing late mutations", async () => {
  for (const method of ["eth_chainId", "eth_getTransactionReceipt"]) {
    const f = await fixture(), out = await f.adapter().pay(f.input);
    f.beforeRpc = async v => { if (v.method === method) await sleep(350); };
    const before = fs.readFileSync(f.journal), start = performance.now();
    const result = await observe(f, out, { timeoutMs: 100, pollMs: 10 });
    assert(performance.now() - start < 300); assert.equal(result.timedOut, true); assert.equal(result.observation, "UNKNOWN");
    assert.equal(result.transactionHash, out.transactionHash); await sleep(400);
    assert.deepEqual(fs.readFileSync(f.journal), before); assert.equal(f.attempts.length, 1); await paid(f, out.transactionHash);
  }
});

test("reconciliation: missing transaction and receipt never prove failure; unavailable history preserves recorded confirmation", async () => {
  const f = await fixture(), out = await recorded(f, { send: false }), before = fs.readFileSync(f.journal);
  const absent = await observe(f, out); assert.equal(absent.observation, "UNKNOWN"); assert.equal(absent.outcome, null);
  assert.deepEqual(fs.readFileSync(f.journal), before); assert.equal(await provider.getBalance(f.recipient), 0n); assert.equal(f.attempts.length, 0);
  const g = await fixture(), sent = await g.adapter().pay(g.input); await g.adapter().confirm(...ref(sent), one);
  g.transform = (v, r) => { if (["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(v.method)) r.result = null; };
  const observed = await g.adapter().confirm(...ref(sent), one);
  assert.equal(observed.observation, "UNKNOWN"); assert.equal(observed.recordedOutcome, "PAID"); assert.equal(observed.journalState, "CONFIRMED");
  assert.equal(observed.transactionHash, sent.transactionHash); assert.equal(g.attempts.length, 1);
});

test("reconciliation: RPC errors during polling keep the operation uncertain and reserve its nonce", async () => {
  const f = await fixture(), a = f.adapter(), out = await a.pay(f.input);
  f.transform = (v, r) => { if (v.method === "eth_getTransactionReceipt") { delete r.result; r.error = { code: -32000, message: "injected polling error" }; } };
  const result = await a.confirm(...ref(out), one); assert.equal(result.observation, "UNKNOWN"); assert.equal(result.journalState, "UNKNOWN");
  assert.equal(result.transactionHash, out.transactionHash); assert.equal(f.attempts.length, 1);
  await rejection(a.pay(f.input), "UNRESOLVED_OPERATION"); await paid(f, out.transactionHash);
  const g = await fixture(); await provider.send("evm_setAutomine", [false]);
  try {
    g.mode = "rpc"; const uncertain = await rejection(g.adapter().pay(g.input));
    const child = g.store.inspect(g.wallet).operations[0].children[0];
    const pending = await g.adapter().confirm(uncertain.operationId, child.childId, one);
    assert.equal(pending.observation, "PENDING"); assert.equal(pending.journalState, "SUBMITTED"); assert.equal(g.attempts.length, 1);
  } finally { await provider.send("evm_mine", []); await provider.send("evm_setAutomine", [true]); }
});

test("reconciliation: actual PaymentHeld creation is distinct from Paid and remains HELD after later approval and agent rotation", async () => {
  const f = await fixture(), out = await recorded(f, { rawAmount: E("2") });
  const result = await confirmLocalOperation(readOptions(f), ...ref(out), one);
  assert.equal(result.observation, "CONFIRMED"); assert.equal(result.outcome, "HELD"); assert.equal(result.evidence.event.name, "PaymentHeld");
  assert.equal(await provider.getBalance(f.recipient), 0n); const requestId = result.evidence.event.requestId;
  await (await al.approve(requestId, false)).wait(); await (await al.rotateAgent(f.id, ethers.Wallet.createRandom().address)).wait();
  const again = await observe(f, out); assert.equal(again.outcome, "HELD"); assert.equal(again.evidence.event.requestId, requestId);
  assert.equal(await provider.getBalance(f.recipient), E("2")); noSecrets(f);
});

test("reconciliation: a real status-0 payment is REVERTED, retains identity, and never retries", async () => {
  const f = await fixture(), out = await recorded(f, { beforeSend: async () => { await (await al.setFrozen(f.id, true)).wait(); } });
  const result = await confirmLocalOperation(readOptions(f), ...ref(out), one);
  assert.equal(result.observation, "REVERTED"); assert.equal(result.journalState, "REVERTED"); assert.equal(result.receipt.status, 0);
  assert.equal(result.transactionHash, out.transactionHash); assert.equal(await provider.getBalance(f.recipient), 0n);
  assert.equal(result.outcome, null); assert.equal(result.evidence.event, null); noSecrets(f);
});

test("reconciliation: receipt success with wrong emitter/account/recipient/amount/memo is never a confirmed payment", async () => {
  const f = await fixture(), a = f.adapter(), out = await a.pay(f.input);
  for (const field of ["emitter", "account", "recipient", "amount", "memo"]) {
    f.transform = (v, r) => {
      if (v.method !== "eth_getTransactionReceipt" || !r.result) return;
      const log = r.result.logs[0];
      if (field === "emitter") log.address = f.recipient;
      else rewriteEvent(log, "Paid", [field === "account" ? BigInt(f.id) + 1n : f.id, field === "recipient" ? f.agent.address : f.recipient,
        field === "amount" ? amount + 1n : amount, field === "memo" ? "forged" : f.input.memo]);
    };
    const before = fs.readFileSync(f.journal), result = await observe(f, out);
    assert.equal(result.observation, "RECOVERY_REQUIRED", field); assert.equal(result.outcome, null); assert.deepEqual(fs.readFileSync(f.journal), before);
  }
  const bad = await a.confirm(...ref(out), one); assert.equal(bad.journalState, "RECOVERY_REQUIRED");
  f.transform = null; await paid(f, out.transactionHash); assert.equal(f.attempts.length, 1);
});

test("reconciliation: historical Refueled and Cancelled require exact child event identity; execution stays unsupported", async () => {
  const f = await fixture(), out = await recorded(f, { kind: "refuel", rawAmount: E("0.05") });
  f.transform = (v, r) => { if (v.method === "eth_getTransactionReceipt" && r.result) rewriteEvent(r.result.logs[0], "Refueled", [f.id, f.agent.address, E("0.06")]); };
  assert.equal((await observe(f, out)).observation, "RECOVERY_REQUIRED"); f.transform = null;
  const good = await confirmLocalOperation(readOptions(f), ...ref(out), one); assert.equal(good.outcome, "REFUELED");
  assert.equal((await al.getAccount(f.id))[0].balance, E("4.95")); await rejection(f.adapter().refuel(), "UNSUPPORTED_ACTION");
  const g = await fixture(), connected = al.connect(new ethers.Wallet(g.key, provider));
  const heldReceipt = await (await connected.pay(g.id, g.recipient, E("2"), g.input.memo)).wait();
  const held = heldReceipt.logs.map(l => { try { return iface.parseLog(l); } catch { return null; } }).find(e => e?.name === "PaymentHeld");
  const cancelled = await recorded(g, { kind: "cancel", requestId: String(held.args.requestId) });
  for (const field of ["request", "account", "status"]) {
    g.transform = (v, r) => { if (v.method === "eth_getTransactionReceipt" && r.result) rewriteEvent(r.result.logs[0], "RequestResolved",
      [field === "request" ? held.args.requestId + 1n : held.args.requestId, field === "account" ? BigInt(g.id) + 1n : g.id, field === "status" ? 3 : 4]); };
    assert.equal((await observe(g, cancelled)).observation, "RECOVERY_REQUIRED", field);
  }
  g.transform = null;
  assert.equal((await confirmLocalOperation(readOptions(g), ...ref(cancelled), one)).outcome, "CANCELLED");
  assert.equal((await al.getRequest(held.args.requestId)).status, 4n); await rejection(g.adapter().cancel(), "UNSUPPORTED_ACTION");
});

test("reconciliation: conflicting receipt/block evidence and historical contradictions fail closed", async () => {
  const f = await fixture(), a = f.adapter(), out = await a.pay(f.input); await a.confirm(...ref(out), one);
  for (const field of ["canonical-block", "head-conflict", "removed-log", "changed-receipt", "transaction-envelope"]) {
    let receipts = 0;
    f.transform = (v, r) => {
      if (v.method === "eth_getBlockByNumber" && !["latest", "0x0"].includes(v.params[0]) && field === "canonical-block") r.result.hash = "0x" + "f".repeat(64);
      if (v.method === "eth_getBlockByNumber" && v.params[0] === "latest" && field === "head-conflict") r.result.hash = "0x" + "f".repeat(64);
      if (v.method === "eth_getTransactionReceipt" && r.result) {
        receipts++;
        if (field === "removed-log") r.result.logs[0].removed = true;
        if (field === "changed-receipt" && receipts >= 2) r.result.blockHash = "0x" + "f".repeat(64);
      }
      if (v.method === "eth_getTransactionByHash" && r.result && field === "transaction-envelope") r.result.nonce = "0x1";
    };
    const seen = await observe(f, out); assert.equal(seen.observation, "RECOVERY_REQUIRED", field); assert.equal(seen.transactionHash, out.transactionHash);
  }
  const result = await a.confirm(...ref(out), one); assert.equal(result.journalState, "RECOVERY_REQUIRED"); assert.equal(result.recordedOutcome, "PAID");
  assert.equal(f.attempts.length, 1); f.transform = null; await paid(f, out.transactionHash);
});

test("reconciliation processes: keyless restart can observe an accepted crash transaction without taking over its lock", async () => {
  const f = await fixture(); f.mode = "hold"; const w = worker(f, "broadcast"); await until(() => f.accepted === 1);
  w.child.kill("SIGKILL"); await bounded(w.exited);
  const c = f.store.inspect(f.wallet).operations[0], out = { operationId: c.operationId, childId: c.children[0].childId, transactionHash: c.children[0].transactionHash };
  const before = fs.readFileSync(f.journal), lockBefore = fs.readFileSync(f.lock), restarted = await keylessWorker(f, out);
  assert.equal(restarted.signs, 0); assert.equal(restarted.result.observation, "CONFIRMED"); assert.equal(restarted.result.recordedState, "SUBMITTING");
  assert.deepEqual(fs.readFileSync(f.journal), before); assert.deepEqual(fs.readFileSync(f.lock), lockBefore);
  const err = await rejection(confirmLocalOperation(readOptions(f), ...ref(out), one), "WALLET_BUSY"); assert.equal(err.transactionHash, out.transactionHash);
  assert.equal(f.attempts.length, 1); await paid(f, out.transactionHash);
});

test("reconciliation: verified fee/different-call/self-transfer replacements retain both hashes and never settle the original", async () => {
  for (const kind of ["EQUIVALENT_CALL", "DIFFERENT_CALL", "CANCELLATION", "UNVERIFIED"]) {
    const f = await fixture(); await provider.send("evm_setAutomine", [false]); let out, candidateHash;
    try {
      out = await f.adapter().pay(f.input); const old = ethers.Transaction.from(f.raw[0]);
      if (kind === "UNVERIFIED") candidateHash = "0x" + "a".repeat(64);
      else {
        const data = kind === "CANCELLATION" ? "0x" : kind === "DIFFERENT_CALL" ? iface.encodeFunctionData("refuel", [f.id, E("0.05")]) : old.data;
        const raw = await f.agent.signTransaction({ type: 2, chainId: 31337n, nonce: old.nonce, to: kind === "CANCELLATION" ? f.agent.address : ADDRESS,
          value: 0n, data, gasLimit: old.gasLimit, maxFeePerGas: old.maxFeePerGas * 3n, maxPriorityFeePerGas: old.maxPriorityFeePerGas * 3n });
        candidateHash = ethers.keccak256(raw); await provider.send("eth_sendRawTransaction", [raw]);
      }
      await provider.send("evm_mine", []);
    } finally { await provider.send("evm_setAutomine", [true]); }
    const result = await f.adapter().confirm(...ref(out), { ...one, replacementHash: candidateHash });
    assert.equal(result.observation, "RECOVERY_REQUIRED"); assert.equal(result.replacement.classification, kind, JSON.stringify(result));
    assert.equal(result.replacement.verified, kind !== "UNVERIFIED"); assert.equal(result.transactionHash, out.transactionHash);
    const saved = f.store.inspect(f.wallet).operations[0].children[0]; assert.equal(saved.transactionHash, out.transactionHash); assert.equal(saved.evidence.replacement.candidateHash, candidateHash);
    const restart = await observe(f, out); assert.equal(restart.observation, "RECOVERY_REQUIRED"); assert.equal(restart.replacement.candidateHash, candidateHash);
    assert.equal(f.attempts.length, 1); await rejection(f.adapter().pay(f.input), "UNRESOLVED_OPERATION");
    if (kind === "EQUIVALENT_CALL") await paid(f, candidateHash);
    else if (kind !== "UNVERIFIED") assert.equal(await provider.getBalance(f.recipient), 0n);
  }
  const f = await fixture(), out = await f.adapter().pay(f.input);
  f.transform = (v, r) => { if (["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(v.method)) r.result = null; };
  const nonceOnly = await observe(f, out); assert.equal(nonceOnly.observation, "RECOVERY_REQUIRED"); assert.equal(nonceOnly.replacement, null);
});

test("reconciliation: journal write/fsync failure after inclusion preserves hash, uncertainty and fail-closed ownership", async () => {
  for (const phase of ["write", "file", "directory"]) {
    const f = await fixture(), out = await f.adapter().pay(f.input); let target = false;
    const io = { ...fs, writeSync(fd, b, o, n, p) {
      if (b.toString().includes('"state":"CONFIRMED"')) target = true;
      if (target && phase === "write") throw fail("ENOSPC"); return fs.writeSync(fd, b, o, n, p);
    }, fsyncSync(fd) { if (target && phase === (fs.fstatSync(fd).isDirectory() ? "directory" : "file")) throw fail("EIO"); fs.fsyncSync(fd); } };
    const err = await rejection(confirmLocalOperation(readOptions(f, { io }), ...ref(out), one));
    assert.equal(err.state, "UNKNOWN"); assert.equal(err.transactionHash, out.transactionHash); assert.equal(err.persistenceFailed, true);
    assert(fs.existsSync(f.lock)); assert.equal(f.attempts.length, 1); await paid(f, out.transactionHash); noSecrets(f);
    await rejection(f.adapter().pay(f.input)); assert.equal(f.attempts.length, 1);
  }
});

test("reconciliation: evidence replay stays validated, corrupt/unsafe paths reject and reader bytes remain unchanged", async () => {
  const f = await fixture(), out = await f.adapter().pay(f.input); await f.adapter().confirm(...ref(out), one);
  const restored = openReader(f.state).inspect(f.wallet).operations[0].children[0]; assert.equal(restored.evidence.event.name, "Paid");
  assert.equal(restored.transactionHash, out.transactionHash);
  // Bad evidence must fail on live writes, without changing a single byte.
  const g = await fixture(), sent = await g.adapter().pay(g.input), seen = await observe(g, sent), s = g.store.acquire(g.wallet);
  const badEvidence = structuredClone(seen.evidence); badEvidence.head.hash = "0x" + "f".repeat(64);
  const unchanged = fs.readFileSync(g.journal);
  assert.throws(() => s.transition(...ref(sent), { state: "CONFIRMED", transactionHash: sent.transactionHash, receipt: seen.receipt,
    outcome: "PAID", reasonCode: null, evidence: badEvidence }), e => e.code === "INVALID_RECEIPT");
  assert.deepEqual(fs.readFileSync(g.journal), unchanged); s.release();
  // A later valid recovery frame must not hide bad evidence in earlier history.
  f.transform = (v, r) => { if (v.method === "eth_getTransactionReceipt" && r.result) r.result.logs[0].address = f.recipient; };
  await f.adapter().confirm(...ref(out), one);
  const frames = fs.readFileSync(f.journal, "utf8").trimEnd().split("\n").map(JSON.parse);
  let previous;
  const forged = frames.map((frame, i) => {
    const { digest, ...body } = frame;
    if (body.kind === "OP" && body.operation.children[0].state === "CONFIRMED") body.operation.children[0].evidence.event.name = "Refueled";
    if (body.kind === "SEAL") body.lastDigest = previous;
    else if (i) body.previousDigest = previous;
    const next = ethers.sha256(ethers.toUtf8Bytes(canonical(body))).slice(2);
    if (body.kind !== "SEAL") previous = next;
    return canonical({ ...body, digest: next });
  }).join("\n") + "\n";
  fs.writeFileSync(f.journal, forged); const corrupt = fs.readFileSync(f.journal);
  assert.throws(() => openReader(f.state).inspect(f.wallet), e => e.code === "CORRUPT_STATE");
  assert.deepEqual(fs.readFileSync(f.journal), corrupt);
  const bad = await fixture(); fs.chmodSync(bad.state.stateDir, 0o755);
  assert.throws(() => createLocalReconciler(readOptions(bad)), e => e.code === "UNSAFE_PERMISSIONS"); fs.chmodSync(bad.state.stateDir, 0o700);
  fs.truncateSync(f.journal, fs.statSync(f.journal).size - 10); const before = fs.readFileSync(f.journal);
  await rejection(observe(f, out)); assert.deepEqual(fs.readFileSync(f.journal), before); assert.equal(f.attempts.length, 1);
});


test("reconciliation repair: candidate survives RPC lookup failure and keyless restart", async () => {
  const f = await fixture(), out = await f.adapter().pay(f.input);
  const candidateHash = "0x" + "b".repeat(64);
  f.transform = (v, response) => {
    if (v.method === "eth_getTransactionByHash" && v.params[0] === candidateHash) {
      delete response.result;
      response.error = { code: -32000, message: "injected candidate lookup failure" };
    }
  };
  const result = await f.adapter().confirm(...ref(out), { ...one, replacementHash: candidateHash });
  assert.equal(result.observation, "UNKNOWN");
  const saved = f.store.inspect(f.wallet).operations[0].children[0];
  assert.equal(saved.state, "RECOVERY_REQUIRED");
  assert.equal(saved.evidence.replacement.candidateHash, candidateHash);
  assert.equal(saved.evidence.replacement.classification, "UNVERIFIED");
  assert.equal(saved.transactionHash, out.transactionHash);
  const journalBefore = fs.readFileSync(f.journal);
  f.transform = null;
  const restarted = await observe(f, out);
  assert.equal(restarted.replacement.candidateHash, candidateHash);
  assert.deepEqual(fs.readFileSync(f.journal), journalBefore);
  assert.equal(f.attempts.length, 1);
  await rejection(f.adapter().pay(f.input), "UNRESOLVED_OPERATION");
});
