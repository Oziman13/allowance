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
import { initializeStore, openStore } from "../journal.js";
import { canonical } from "../journal-schema.js";
import { createLocalBroadcastAdapter } from "../local-broadcast.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const base = path.join(ROOT, "work/isolated-broadcast"); fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(base, "integration-")), fixtures = [], children = [];
const RPC = "http://127.0.0.1:8558", ADDRESS = "0x000000000000000000000000000000000000a110";
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
  anvil = spawn(ANVIL, ["--host", "127.0.0.1", "--port", "8558", "--silent"], { stdio: "ignore" });
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
  provider?.destroy(); anvil?.kill(); fs.rmSync(run, { recursive: true, force: true });
});
const rules = { perPayment: E("1"), perPeriod: E("3"), period: 86400, expiresAt: 0, trustedOnly: false };
async function open(agent, seed = "1") {
  const id = String(await al.accountCount());
  await (await al.openAccount(agent, ethers.ZeroAddress, "local adapter fixture", rules, [], E("5"), E(seed), { value: E("5") + E(seed) })).wait(); return id;
}
async function fixture() {
  const key = ethers.keccak256(ethers.toUtf8Bytes("public-allowance-local-adapter-fixture-" + ++serial));
  const agent = new ethers.Wallet(key), recipient = new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes("public-local-recipient-" + serial))).address.toLowerCase();
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
      const result = await forward(RPC, v);
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

test("local adapter: explicit local context and unsupported actions fail before signing or submission", async () => {
  const f = await fixture();
  for (const extra of [{ mode: "portaldot-testnet" }, { rpcUrl: "https://test-evm-rpc-v3.portaldot.dev" }, { rpcUrl: "http://localhost:8558" }, { rpcUrl: "http://127.0.0.1:8558/?rpc=x" }]) assert.throws(() => f.adapter(extra));
  await countSigns(f, async signs => {
    for (const mode of ["chain", "code"]) { f.mode = mode; await rejection(f.adapter().pay(f.input), mode === "chain" ? "NETWORK_IDENTITY" : "CONTRACT_IDENTITY"); }
    await rejection(f.adapter().refuel(), "UNSUPPORTED_ACTION"); await rejection(f.adapter().cancel(), "UNSUPPORTED_ACTION");
    await rejection(f.adapter().pay({ ...f.input, amountRaw: "0" }));
    f.mode = null; await rejection(f.adapter().pay({ ...f.input, amountRaw: String(E("2")) }), "HELD_UNSUPPORTED");
    assert.equal(signs(), 0); assert.equal(f.attempts.length, 0); assert.equal(f.store.inspect(f.wallet).operations.length, 0);
  });
});

test("local adapter: actual payment matches durable identity, exact envelope and legacy EIP-1559 strategy", async () => {
  const f = await fixture(), a = f.adapter();
  await countSigns(f, async signs => {
    const result = await a.pay(f.input); assert.equal(result.state, "SUBMITTED"); assert.equal(result.confirmation, "NOT_CHECKED");
    assert.equal(f.attempts.length, 1); assert.equal(signs(), 1); assert.deepEqual(f.gates, [{ state: "SUBMITTING", hashMatches: true }]);
    const tx = ethers.Transaction.from(f.raw[0]); assert.equal(result.transactionHash, ethers.keccak256(f.raw[0]));
    assert.equal(tx.from.toLowerCase(), f.agent.address.toLowerCase()); assert.equal(tx.to.toLowerCase(), ADDRESS); assert.equal(tx.nonce, 0); assert.equal(tx.chainId, 31337n); assert.equal(tx.value, 0n);
    assert.equal(tx.type, 2); assert.equal(tx.gasLimit, f.estimate); assert.equal(tx.maxPriorityFeePerGas, 1_000_000_000n); assert.equal(tx.maxFeePerGas, 2n * f.baseFee + 1_000_000_000n);
    const decoded = iface.parseTransaction({ data: tx.data }); assert.equal(decoded.name, "pay"); assert.equal(decoded.args[0], BigInt(f.id)); assert.equal(decoded.args[2], amount);
    await paid(f, result.transactionHash); noSecrets(f);
    const before = fs.readFileSync(f.journal); // Release/acquire OWNER frames may change; OP identity must not.
    await rejection(a.pay(f.input), "UNRESOLVED_OPERATION"); assert.equal(signs(), 1); assert.equal(f.attempts.length, 1);
    assert.equal(a.inspect().operations.length, 1); assert.equal(a.inspect().operations[0].children[0].transactionHash, result.transactionHash); assert(before.length > 0);
  });
});

test("local adapter: disk/fsync failures before signing or after signing produce zero wire submissions", async () => {
  for (const stage of ["prepare-write", "prepare-partial", "prepare-file", "prepare-directory", "submit-file", "submit-directory"]) {
    const f = await fixture(); let target = null, partial = false;
    const io = { ...fs, writeSync(fd, b, o, n, p) {
      const text = b.toString(); if (text.includes('"kind":"OP"')) target = text.includes('"state":"SUBMITTING"') ? "submit" : text.includes('"state":"PREPARED"') ? "prepare" : target;
      if (target === "prepare" && stage === "prepare-write") throw fail("ENOSPC");
      if (target === "prepare" && stage === "prepare-partial") { if (partial) throw fail("ENOSPC"); partial = true; return fs.writeSync(fd, b, o, Math.min(n, 37), p); }
      return fs.writeSync(fd, b, o, n, p);
    }, fsyncSync(fd) { const kind = fs.fstatSync(fd).isDirectory() ? "directory" : "file"; if (stage === `${target}-${kind}`) throw fail("EIO"); fs.fsyncSync(fd); } };
    await countSigns(f, async signs => {
      const err = await rejection(f.adapter({ io }).pay(f.input)); assert.equal(err.broadcastAttempted, false); assert.equal(f.attempts.length, 0);
      assert.equal(signs(), stage.startsWith("submit") ? 1 : 0); assert(fs.existsSync(f.lock));
      await rejection(f.adapter().pay(f.input)); assert.equal(f.attempts.length, 0); assert.equal(await provider.getBalance(f.recipient), 0n); noSecrets(f);
    });
  }
});

test("local adapter: acceptance followed by RPC/socket/429/redirect/timeout failure preserves hash without retry", async () => {
  for (const mode of ["rpc", "socket", "429", "redirect", "timeout"]) {
    const f = await fixture(); f.mode = mode === "timeout" ? "hold" : mode;
    await countSigns(f, async signs => {
      const error = await rejection(f.adapter().pay(f.input, { timeoutMs: mode === "timeout" ? 500 : 5000 })); assert.equal(error.state, "UNKNOWN"); assert.equal(error.transactionHash, f.attempts[0].hash);
      if (mode === "timeout") assert.equal(error.code, "TIMEOUT");
      assert.equal(f.attempts.length, 1); assert.equal(f.forwarded.length, 1); assert.equal(signs(), 1);
      const c = f.store.inspect(f.wallet).operations[0].children[0]; assert.equal(c.state, "UNKNOWN"); assert.equal(c.transactionHash, error.transactionHash);
      await paid(f, error.transactionHash); await rejection(f.adapter().pay(f.input), "UNRESOLVED_OPERATION"); assert.equal(f.attempts.length, 1); assert.equal(signs(), 1); noSecrets(f);
    });
  }
});

test("local adapter: deliberate duplicate delivery retains one hash and one payment, without a new business retry", async () => {
  const f = await fixture(); f.mode = "duplicate";
  await countSigns(f, async signs => {
    const out = await f.adapter().pay(f.input); assert.equal(signs(), 1); assert.equal(f.attempts.length, 1);
    assert.deepEqual(f.forwarded, [out.transactionHash, out.transactionHash]); assert.equal(await provider.getTransactionCount(f.agent.address), 1);
    await paid(f, out.transactionHash); assert(!f.methods.includes("eth_getTransactionReceipt")); noSecrets(f);
  });
});

test("local adapter: wrong acknowledgement and post-acceptance persistence failures never report payment completion", async () => {
  for (const mode of ["wrong-hash", "ack-file", "ack-directory"]) {
    const f = await fixture(); f.mode = mode;
    let target = false;
    const io = { ...fs, writeSync(fd, b, o, n, p) { if (b.toString().includes('"state":"SUBMITTED"')) target = true; return fs.writeSync(fd, b, o, n, p); },
      fsyncSync(fd) { if (target && mode === `ack-${fs.fstatSync(fd).isDirectory() ? "directory" : "file"}`) throw fail("EIO"); fs.fsyncSync(fd); } };
    const err = await rejection(f.adapter({ io }).pay(f.input)); assert.equal(err.transactionHash, f.attempts[0].hash); assert.equal(f.attempts.length, 1); await paid(f, err.transactionHash);
    if (mode === "wrong-hash") { assert.equal(err.state, "RECOVERY_REQUIRED"); assert.equal(f.store.inspect(f.wallet).operations[0].children[0].state, "RECOVERY_REQUIRED"); }
    else { assert.equal(err.state, "UNKNOWN"); assert.equal(err.persistenceFailed, true); assert(fs.existsSync(f.lock)); }
    await rejection(f.adapter().pay(f.input)); assert.equal(f.attempts.length, 1); noSecrets(f);
  }
});

test("local adapter: same-wallet accounts coordinate concurrent admission and keyless restart blocks unresolved history", async () => {
  const f = await fixture(), id = await open(f.agent.address, "0"), otherOptions = { ...f.options, accountId: id };
  await countSigns(f, async signs => {
    const results = await Promise.allSettled([f.adapter().pay(f.input), createLocalBroadcastAdapter(otherOptions).pay(f.input)]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1); const bad = results.find(x => x.status === "rejected"); assert.equal(bad.reason.code, "WALLET_BUSY");
    assert.equal(signs(), 1); assert.equal(f.attempts.length, 1);
    const restarted = await worker(f, "try", otherOptions).result(); assert.equal(restarted.code, "UNRESOLVED_OPERATION"); assert.equal(restarted.signs, 0); assert.equal(f.attempts.length, 1);
    await paid(f, f.attempts[0].hash); noSecrets(f);
  });
});

test("local adapter: a stale RPC nonce cannot reuse closed cross-account history; sequential nonce succeeds", async () => {
  const f = await fixture(), first = await f.adapter().pay(f.input);
  await paid(f, first.transactionHash);
  // Explicit test-only reconciliation using the real receipt and matched Paid
  // evidence above. The adapter has no reconciliation/close/replacement API.
  const receipt = await provider.getTransactionReceipt(first.transactionHash), session = f.store.acquire(f.wallet);
  session.transition(first.operationId, first.childId, { state: "CONFIRMED", transactionHash: first.transactionHash, outcome: "PAID", reasonCode: null,
    receipt: { transactionHash: first.transactionHash, blockHash: receipt.blockHash, blockNumber: String(receipt.blockNumber), status: 1 } });
  session.closeOperation(first.operationId); session.release();
  const other = f.adapter({ accountId: await open(f.agent.address, "0") }), before = f.store.inspect(f.wallet).operations;
  await countSigns(f, async signs => {
    f.mode = "stale-nonce";
    const error = await rejection(other.pay(f.input), "NONCE_CONFLICT");
    assert.equal(error.broadcastAttempted, false); assert.equal(signs(), 0); assert.equal(f.attempts.length, 1);
    assert.deepEqual(f.store.inspect(f.wallet).operations, before);
    f.mode = null; const next = await other.pay(f.input);
    assert.equal(signs(), 1); assert.equal(f.attempts.length, 2); assert.equal(f.attempts[1].nonce, 1);
    assert.notEqual(next.transactionHash, first.transactionHash); assert.equal((await provider.getTransactionReceipt(next.transactionHash)).status, 1);
    assert.equal(await provider.getBalance(f.recipient), 2n * amount); noSecrets(f);
  });
});

test("local adapter processes: SIGKILL at PREPARED, signed and durable SUBMITTING boundaries prevents untracked sends", async () => {
  for (const mode of ["prepared", "signed", "submitting", "broadcast"]) {
    const f = await fixture(); if (mode === "broadcast") f.mode = "hold";
    const w = worker(f, mode); let checkpoint;
    if (mode === "broadcast") await until(() => f.accepted === 1); else checkpoint = await w.checkpoint();
    w.child.kill("SIGKILL"); assert.equal((await bounded(w.exited))[1], "SIGKILL");
    const saved = f.store.inspect(f.wallet).operations[0].children[0];
    assert.equal(saved.state, mode === "submitting" || mode === "broadcast" ? "SUBMITTING" : "PREPARED");
    assert.equal(f.attempts.length, mode === "broadcast" ? 1 : 0); assert(fs.existsSync(f.lock));
    if (mode === "submitting") assert.equal(saved.transactionHash, checkpoint.transactionHash);
    if (mode === "broadcast") { assert.equal(saved.transactionHash, f.attempts[0].hash); await paid(f, saved.transactionHash); }
    else assert.equal(await provider.getBalance(f.recipient), 0n);
    const restart = await worker(f, "try").result(); assert.equal(restart.code, "WALLET_BUSY"); assert.equal(restart.signs, 0);
    assert.equal(f.attempts.length, mode === "broadcast" ? 1 : 0); noSecrets(f);
  }
});

test("local adapter: terminal timeout or cancellation cannot resume a delayed signing continuation", async () => {
  for (const stop of ["timeout", "cancel"]) {
    const f = await fixture(), original = ethers.Wallet.prototype.signTransaction, controller = new AbortController(); let signed = false;
    ethers.Wallet.prototype.signTransaction = async function(tx) { const raw = await original.call(this, tx); signed = true; await sleep(800); return raw; };
    try {
      const pending = f.adapter().pay(f.input, { timeoutMs: stop === "timeout" ? 500 : 2000, signal: controller.signal });
      await until(() => signed); if (stop === "cancel") controller.abort();
      await rejection(pending, stop === "cancel" ? "CANCELLED" : "TIMEOUT"); await sleep(850);
      assert.equal(f.attempts.length, 0); assert.equal(await provider.getBalance(f.recipient), 0n);
      const op = f.store.inspect(f.wallet).operations[0]; assert.equal(op.children[0].state, "NOT_SUBMITTED"); assert.equal(op.status, "CLOSED"); noSecrets(f);
    } finally { ethers.Wallet.prototype.signTransaction = original; }
  }
});

test("local adapter: ownership loss during signing or after durable SUBMITTING prevents late wire delivery", async () => {
  for (const when of ["sign", "submit"]) {
    const f = await fixture(), original = ethers.Wallet.prototype.signTransaction; let scheduled = false;
    const io = { ...fs, fsyncSync(fd) {
      fs.fsyncSync(fd);
      if (when === "submit" && !scheduled && fs.fstatSync(fd).isDirectory() && fs.readlinkSync(`/proc/self/fd/${fd}`) === path.dirname(f.journal)
          && fs.readFileSync(f.journal, "utf8").includes('"state":"SUBMITTING"')) { scheduled = true; queueMicrotask(() => fs.unlinkSync(f.lock)); }
    } };
    if (when === "sign") ethers.Wallet.prototype.signTransaction = async function(tx) { const raw = await original.call(this, tx); fs.unlinkSync(f.lock); await sleep(20); return raw; };
    try {
      const error = await rejection(f.adapter({ io }).pay(f.input)); assert.equal(error.broadcastAttempted, false); assert.equal(f.attempts.length, 0);
      assert.equal(await provider.getBalance(f.recipient), 0n); assert.equal(error.persistenceFailed, true);
      await rejection(f.adapter().pay(f.input)); assert.equal(f.attempts.length, 0); noSecrets(f);
    } finally { ethers.Wallet.prototype.signTransaction = original; }
  }
});

test("local adapter: corrupt history fails closed before preparation/signing and cannot silently reset", async () => {
  const f = await fixture(); fs.truncateSync(f.journal, fs.statSync(f.journal).size - 17); const before = fs.readFileSync(f.journal);
  await countSigns(f, async signs => {
    await rejection(f.adapter().pay(f.input), "CORRUPT_STATE"); assert.equal(signs(), 0); assert.equal(f.attempts.length, 0); assert.equal(f.methods.length, 0);
    assert.deepEqual(fs.readFileSync(f.journal), before); assert(!fs.existsSync(f.lock));
  });
});
