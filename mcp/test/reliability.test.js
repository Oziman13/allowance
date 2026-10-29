// Phase 5A-2A regressions. Real contracts on localhost Anvil; only metadata RPC responses are mocked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient, ABI, explain } from "../lib.js";

const RPC = "http://127.0.0.1:8547"; // separate from the existing suite's port 8546
const ANVIL = process.env.ANVIL || (existsSync(`${process.env.HOME}/.foundry/bin/anvil`) ? `${process.env.HOME}/.foundry/bin/anvil` : "anvil");
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public Anvil fixture only
const artifact = JSON.parse(readFileSync(new URL("../../out/Allowance.sol/Allowance.json", import.meta.url)));
const tokenArtifact = JSON.parse(readFileSync(new URL("../../out/MockTokens.sol/MockERC20.json", import.meta.url)));
const E = ethers.parseEther;
const clients = [], submissions = new WeakMap();
let anvil, provider, owner, al, token, address, shop;

before(async () => {
  anvil = spawn(ANVIL, ["--host", "127.0.0.1", "--port", "8547", "--silent"], { stdio: "ignore" });
  provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; }
    catch { if (i === 49) throw new Error("Anvil did not start"); await new Promise(r => setTimeout(r, 100)); }
  }
  owner = new ethers.NonceManager(new ethers.Wallet(OWNER_KEY, provider));
  al = await new ethers.ContractFactory(ABI, artifact.bytecode.object, owner).deploy();
  await al.waitForDeployment(); address = await al.getAddress();
  token = await new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode.object, owner).deploy();
  await token.waitForDeployment(); shop = ethers.Wallet.createRandom().address;
});
after(() => { for (const c of clients) c.provider.destroy(); provider?.destroy(); anvil?.kill(); });

async function connect(id, key) {
  const c = await createClient({ key, address, network: "local", rpc: RPC, accountId: id });
  clients.push(c); submissions.set(c, 0);
  const broadcast = c.provider.broadcastTransaction.bind(c.provider);
  c.provider.broadcastTransaction = (...args) => { submissions.set(c, submissions.get(c) + 1); return broadcast(...args); };
  return c;
}
async function fresh({ erc20 = false, wallet = ethers.Wallet.createRandom() } = {}) {
  const scale = erc20 ? 1_000_000n : E("1");
  const rules = { perPayment: scale, perPeriod: 3n * scale, period: 86400, expiresAt: 0, trustedOnly: false };
  if (erc20) {
    await (await token.mint(await owner.getAddress(), 10n * scale)).wait();
    await (await token.approve(address, 10n * scale)).wait();
    await (await owner.sendTransaction({ to: wallet.address, value: E("1") })).wait();
  }
  const id = Number(await al.accountCount());
  await (await al.openAccount(wallet.address, erc20 ? await token.getAddress() : ethers.ZeroAddress,
    "reliability", rules, [], 10n * scale, erc20 ? 0n : E("1"), { value: erc20 ? 0n : E("11") })).wait();
  return { c: await connect(id, wallet.privateKey), id, wallet, rules, scale };
}
async function held(c, memo = "held request") { return (await c.pay(shop, "2", memo)).request_id; }

test("R1: failed or malformed six-decimal metadata never sends, never caches guesses, and recovers", async () => {
  const { c, id } = await fresh({ erc20: true });
  const call = c.provider.call.bind(c.provider);
  const tokenAddress = (await token.getAddress()).toLowerCase();
  let decimals = "unavailable";
  c.provider.call = async (tx) => {
    if (tx.to?.toLowerCase() === tokenAddress) {
      if (tx.data === "0x313ce567" && decimals !== "valid") {
        if (decimals === "unavailable") throw new Error("simulated decimals RPC outage");
        return decimals;
      }
    }
    return call(tx);
  };
  const before = await al.getAccount(id), nonce = await provider.getTransactionCount(c.agent.address);
  const recipientBefore = await token.balanceOf(shop), requestsBefore = await al.requestCount();
  // Each response represents a different failure boundary, including uint8 ABI masking.
  for (const response of ["unavailable", "0x", "0x06", ethers.toBeHex(262n, 32), ethers.toBeHex(81n, 32), ethers.toBeHex(6n, 64)]) {
    decimals = response;
    await assert.rejects(c.pay(shop, "0.000000000001", "wrong units"), /token decimals/i);
    await assert.rejects(c.preview(shop, "1"), /token decimals/i);
    assert.equal(submissions.get(c), 0, "metadata failure must not broadcast pay or refuel");
  }
  assert.deepEqual((await al.getAccount(id)).toArray(true), before.toArray(true));
  assert.equal(await token.balanceOf(shop), recipientBefore);
  assert.equal(await al.requestCount(), requestsBefore);
  assert.equal(await provider.getTransactionCount(c.agent.address), nonce);
  decimals = "valid";
  assert.equal((await c.preview(shop, "0.0000001")).result, "invalid");
  await assert.rejects(c.pay(shop, "0.0000001", "too precise"));
  assert.equal(submissions.get(c), 0, "precision rejection must not broadcast");
  const out = await c.pay(shop, "1", "exact token units");
  assert.equal(out.result, "paid"); assert.equal(out.amount, "1 mUSD");
  assert.equal(await token.balanceOf(shop) - recipientBefore, 1_000_000n);
  await c.pay(shop, "0.000001", "one raw unit");
  assert.equal(await token.balanceOf(shop) - recipientBefore, 1_000_001n);
  assert.equal((await c.status()).budget_left, "8.999999 mUSD");
  assert.equal(submissions.get(c), 2);

  // TOKEN is only a display fallback. Missing decimals still blocks, even if symbol also fails.
  const fallback = await connect(id, c.agent.privateKey);
  const fallbackCall = fallback.provider.call.bind(fallback.provider);
  fallback.provider.call = async (tx) => {
    if (tx.to?.toLowerCase() === tokenAddress && tx.data === "0x95d89b41") throw new Error("symbol unavailable");
    if (tx.to?.toLowerCase() === tokenAddress && tx.data === "0x313ce567" && decimals !== "valid") throw new Error("decimals unavailable");
    return fallbackCall(tx);
  };
  decimals = "unavailable";
  await assert.rejects(fallback.pay(shop, "1", "unknown metadata"), /token decimals/i);
  assert.equal(submissions.get(fallback), 0);
  decimals = "valid";
  assert.equal((await fallback.status()).budget_left, "8.999999 TOKEN");
  assert.equal((await fallback.preview(shop, "0.000001")).result, "pays instantly");
});

for (const erc20 of [false, true]) {
  test(`R4: cold ${erc20 ? "ERC-20" : "native POT"} request lookup preserves all four statuses without writes`, async () => {
    const { c, id, wallet } = await fresh({ erc20 });
    const rows = [];
    for (const status of ["pending", "approved", "rejected", "cancelled"]) {
      rows.push({ status, rid: await held(c, `lookup ${status}`) });
    }
    await (await al.approve(rows[1].rid, false)).wait();
    await (await al.reject(rows[2].rid)).wait();
    await c.cancel(rows[3].rid);
    const nonce = await provider.getTransactionCount(wallet.address), account = await al.getAccount(id);
    for (const { rid, status } of rows) {
      const cold = await connect(id, wallet.privateKey);
      assert.deepEqual(await cold.request(rid), { request_id: rid, status, amount: erc20 ? "2 mUSD" : "2 POT",
        to: shop, memo: `lookup ${status}`, held_because: "larger than the per-payment cap" });
      assert.equal(submissions.get(cold), 0);
    }
    const cold = await connect(id, wallet.privateKey);
    await assert.rejects(cold.request(Number(await al.requestCount()) + 1), e => {
      assert.equal(explain(e, cold.iface), "No request with that id exists."); return true;
    });
    assert.equal(submissions.get(cold), 0);
    assert.equal(await provider.getTransactionCount(wallet.address), nonce);
    assert.deepEqual((await al.getAccount(id)).toArray(true), account.toArray(true));
  });
}

test("R4: a restarted MCP server can use allowance_request as its first tool call", async () => {
  const { c, id, wallet } = await fresh({ erc20: true });
  const rid = await held(c, "server restart");
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../index.js", import.meta.url).pathname],
    env: { ...process.env, ALLOWANCE_AGENT_KEY: wallet.privateKey, ALLOWANCE_ADDRESS: address,
      ALLOWANCE_NETWORK: "local", ALLOWANCE_RPC: RPC, ALLOWANCE_ACCOUNT_ID: String(id) } });
  const mcp = new Client({ name: "reliability-regression", version: "1.0.0" });
  const nonce = await provider.getTransactionCount(wallet.address);
  await mcp.connect(transport);
  try {
    const result = await mcp.callTool({ name: "allowance_request", arguments: { request_id: rid } });
    assert.ok(!result.isError, result.content[0].text);
    const out = JSON.parse(result.content[0].text);
    assert.equal(out.amount, "2 mUSD"); assert.equal(out.status, "pending"); assert.equal(out.request_id, rid);
    assert.deepEqual(Object.keys(out).sort(), ["request_id", "status", "amount", "to", "memo", "held_because"].sort());
    assert.equal(await provider.getTransactionCount(wallet.address), nonce);
  } finally { await mcp.close(); }
});

test("R5: shared-agent cancellation isolates accounts and preserves freeze, expiry and rotation boundaries", async () => {
  const wallet = ethers.Wallet.createRandom();
  const a = await fresh({ wallet }), b = await fresh({ wallet });
  const own = await held(a.c), foreign = [];
  for (let i = 0; i < 3; i++) foreign.push(await held(b.c));
  const sent = submissions.get(a.c), nonce = await provider.getTransactionCount(wallet.address);
  await assert.rejects(a.c.request(foreign[0]), /another allowance/);
  await assert.rejects(a.c.cancel(foreign[0]), /another allowance/);
  await assert.rejects(a.c.cancel(Number(await al.requestCount()) + 1), e => {
    assert.equal(explain(e, a.c.iface), "No request with that id exists."); return true;
  });
  assert.equal(submissions.get(a.c), sent);
  assert.equal(await provider.getTransactionCount(wallet.address), nonce);
  assert.equal(Number((await al.getRequest(foreign[0])).status), 1);
  assert.equal((await a.c.cancel(own)).status, "cancelled");
  await (await al.setFrozen(b.id, true)).wait();
  assert.equal((await b.c.cancel(foreign[0])).status, "cancelled");
  await (await al.setFrozen(b.id, false)).wait();
  await (await al.setRules(b.id, { ...b.rules, expiresAt: 1 })).wait();
  assert.equal((await b.c.cancel(foreign[1])).status, "cancelled");
  const replacement = ethers.Wallet.createRandom();
  await (await al.rotateAgent(b.id, replacement.address)).wait();
  const beforeRevoked = submissions.get(b.c), revokedNonce = await provider.getTransactionCount(wallet.address);
  await assert.rejects(b.c.cancel(foreign[2]), e => { assert.match(explain(e, b.c.iface), /not the agent/); return true; });
  assert.equal(submissions.get(b.c), beforeRevoked);
  assert.equal(await provider.getTransactionCount(wallet.address), revokedNonce);
  assert.equal(Number((await al.getRequest(foreign[2])).status), 1);
  await (await owner.sendTransaction({ to: replacement.address, value: E("1") })).wait();
  const current = await connect(b.id, replacement.privateKey);
  assert.equal((await current.cancel(foreign[2])).status, "cancelled");
});
