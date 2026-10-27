// End-to-end tests against a local chain (anvil) and the real compiled contract.
// Run from the repo root: forge build && (cd mcp && npm test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient, ABI, explain } from "../lib.js";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0
const ANVIL = process.env.ANVIL || (existsSync(`${process.env.HOME}/.foundry/bin/anvil`) ? `${process.env.HOME}/.foundry/bin/anvil` : "anvil");
const artifact = JSON.parse(readFileSync(new URL("../../out/Allowance.sol/Allowance.json", import.meta.url), "utf8"));

let anvil, provider, owner, al, agentKey, shop, accountId;
const E = ethers.parseEther;

async function waitForChain() {
  for (let i = 0; i < 50; i++) {
    try { await provider.getBlockNumber(); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("anvil did not start");
}

before(async () => {
  anvil = spawn(ANVIL, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  await waitForChain();
  owner = new ethers.NonceManager(new ethers.Wallet(OWNER_KEY, provider));
  const c = await new ethers.ContractFactory(ABI, artifact.bytecode.object, owner).deploy();
  al = new ethers.Contract(await c.getAddress(), ABI, owner);
  const agent = ethers.Wallet.createRandom();
  agentKey = agent.privateKey;
  shop = ethers.Wallet.createRandom().address;
  const rules = { perPayment: E("1"), perPeriod: E("3"), period: 86400, expiresAt: 0, trustedOnly: true };
  const tx = await al.openAccount(agent.address, ethers.ZeroAddress, "test agent", rules, [shop], E("20"), E("0.01"), { value: E("20.01") });
  const r = await tx.wait();
  accountId = Number(r.logs.map((l) => al.interface.parseLog(l)).find((p) => p?.name === "AccountOpened").args.accountId);
});

after(() => anvil?.kill());

test("finds the agent's allowance and reports its rules", async () => {
  const c = await createClient({ key: agentKey, address: await al.getAddress(), network: "local", rpc: RPC });
  assert.equal(c.accountId, accountId);
  const s = await c.status();
  assert.equal(s.state, "active");
  assert.equal(s.can_spend_now_without_asking, "3 POT");
  assert.equal(s.period_limit, "3 POT per day");
  assert.match(s.recipients, /trusted recipients only/);
});

test("preview tells the three outcomes apart", async () => {
  const c = await createClient({ key: agentKey, address: await al.getAddress(), network: "local", rpc: RPC });
  assert.equal((await c.preview(shop, 0.5)).result, "pays instantly");
  const big = await c.preview(shop, 2);
  assert.equal(big.result, "needs owner approval");
  assert.equal(big.reason, "larger than the per-payment cap");
  assert.equal((await c.preview(ethers.Wallet.createRandom().address, 0.1)).reason, "the recipient is not trusted");
});

test("pays inside the rules, refuelling its own gas from the same budget", async () => {
  const c = await createClient({ key: agentKey, address: await al.getAddress(), network: "local", rpc: RPC, minGas: E("0.05") });
  const out = await c.pay(shop, "0.5", "API credits");
  assert.equal(out.result, "paid");
  assert.ok(out.gas_refuel, "agent started with 0.01 POT gas, so it should refuel");
  assert.equal(await provider.getBalance(shop), E("0.5"));
  const s = await c.status();
  // 3 POT limit - 0.5 payment - 0.1 refuel (2 x minGas) = 2.4
  assert.equal(s.can_spend_now_without_asking, "2.4 POT");
});

test("a payment outside the rules is held, then the owner approves it", async () => {
  const c = await createClient({ key: agentKey, address: await al.getAddress(), network: "local", rpc: RPC });
  const out = await c.pay(shop, "2", "GPU hour");
  assert.equal(out.result, "held for owner approval");
  assert.equal((await c.request(out.request_id)).status, "pending");
  await (await al.approve(out.request_id, false)).wait();
  assert.equal((await c.request(out.request_id)).status, "approved");
});

test("the agent can withdraw its own request", async () => {
  const c = await createClient({ key: agentKey, address: await al.getAddress(), network: "local", rpc: RPC });
  const out = await c.pay(ethers.Wallet.createRandom().address, "0.1", "unknown vendor");
  assert.equal(out.result, "held for owner approval");
  assert.equal((await c.cancel(out.request_id)).status, "cancelled");
});

test("full MCP round trip: a frozen allowance stops the assistant with a clear message", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../index.js", import.meta.url).pathname],
    env: { ...process.env, ALLOWANCE_AGENT_KEY: agentKey, ALLOWANCE_ADDRESS: await al.getAddress(), ALLOWANCE_NETWORK: "local", ALLOWANCE_RPC: RPC },
  });
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["allowance_cancel", "allowance_pay", "allowance_preview", "allowance_request", "allowance_status"]);

    const ok = await mcp.callTool({ name: "allowance_pay", arguments: { to: shop, amount: 0.25, memo: "search API" } });
    assert.ok(!ok.isError, ok.content[0].text);
    assert.equal(JSON.parse(ok.content[0].text).result, "paid");

    await (await al.setFrozen(accountId, true)).wait();
    const blocked = await mcp.callTool({ name: "allowance_pay", arguments: { to: shop, amount: 0.25, memo: "search API" } });
    assert.ok(blocked.isError);
    assert.match(blocked.content[0].text, /frozen/);
    const st = JSON.parse((await mcp.callTool({ name: "allowance_status", arguments: {} })).content[0].text);
    assert.equal(st.state, "frozen by owner");
  } finally {
    await mcp.close();
  }
});

async function fresh({ budget = "2", seed = "0.01", expiresAt = 0 } = {}) {
  const wallet = ethers.Wallet.createRandom();
  const rules = { perPayment: E("1"), perPeriod: E("3"), period: 86400, expiresAt, trustedOnly: false };
  const receipt = await (await al.openAccount(wallet.address, ethers.ZeroAddress, "audit", rules, [], E(budget), E(seed), { value: E(budget) + E(seed) })).wait();
  const id = Number(receipt.logs.map(l => { try { return al.interface.parseLog(l); } catch { return null; } }).find(p => p?.name === "AccountOpened").args.accountId);
  return createClient({ key: wallet.privateKey, address: await al.getAddress(), network: "local", rpc: RPC, accountId: id });
}

test("audit: preview rejects contract-invalid addresses and amounts", async () => {
  const c = await fresh();
  for (const to of [ethers.ZeroAddress, await al.getAddress(), "bad"]) {
    assert.equal((await c.preview(to, "0.1")).result, "invalid");
    await assert.rejects(c.pay(to, "0.1", "audit"));
  }
  for (const amount of ["0", "-1", "bad", ethers.formatEther(1n << 128n)]) {
    assert.equal((await c.preview(shop, amount)).result, "invalid");
    await assert.rejects(c.pay(shop, amount, "audit"));
  }
});

test("audit: frozen and expired capacity is zero; single payment differs from capacity", async () => {
  const c = await fresh();
  assert.equal((await c.status()).can_spend_now_without_asking, "2 POT");
  assert.equal((await c.status()).max_single_payment_without_asking, "1 POT");
  await (await al.setFrozen(c.accountId, true)).wait();
  assert.equal((await c.status()).can_spend_now_without_asking, "0 POT");
  const expired = await fresh({ expiresAt: 1 });
  assert.equal((await expired.status()).can_spend_now_without_asking, "0 POT");
});

test("audit: held requests may exceed budget; instant payments may not", async () => {
  const c = await fresh({ budget: "0.2" });
  assert.equal((await c.preview(shop, "0.5")).result, "blocked");
  assert.equal((await c.preview(shop, "2")).result, "needs owner approval");
  assert.equal((await c.pay(shop, "2", "audit")).result, "held for owner approval");
});

test("audit: zero gas cannot bootstrap refuel and does not move budget", async () => {
  const c = await fresh({ seed: "0" });
  await assert.rejects(c.pay(shop, "0.1", "audit"));
  assert.equal((await c.status()).budget_left, "2 POT");
});

for (const amount of ["0", "-1", "bad", ethers.formatEther(1n << 128n)]) {
  test(`audit: invalid preview amount ${amount}`, async () => {
    const c = await fresh();
    assert.equal((await c.preview(shop, amount)).result, "invalid");
  });
}
for (const state of ["frozen", "expired"]) {
  test(`audit: ${state} reports zero spending capacity`, async () => {
    const c = await fresh({ expiresAt: state === "expired" ? 1 : 0 });
    if (state === "frozen") await (await al.setFrozen(c.accountId, true)).wait();
    assert.equal((await c.status()).can_spend_now_without_asking, "0 POT");
    assert.equal((await c.preview(shop, "0.1")).result, "blocked");
    await assert.rejects(c.pay(shop, "0.1", "audit"));
  });
}
test("audit: RPC timeout does not assert nothing was sent", () => {
  assert.doesNotMatch(explain({ info: { error: { message: "upstream timeout" } } }, al.interface), /Nothing was sent/);
});

test("audit: successful receipt without payment evidence is not paid", async () => {
  const c = await fresh({ seed: "1" });
  const fake = async () => ({ hash: ethers.ZeroHash, wait: async () => ({ status: 1, logs: [] }) });
  fake.staticCall = async () => [true, 0n];
  fake.estimateGas = async () => 100000n;
  Object.defineProperty(c.contract, "pay", { value: fake });
  await assert.rejects(c.pay(shop, "0.1", "audit"), /confirm/i);
});

test("audit: refuel does not consume the budget reserved for an instant payment", async () => {
  const c = await fresh({ budget: "0.1" });
  assert.equal((await c.preview(shop, "0.1")).result, "pays instantly");
  assert.equal((await c.pay(shop, "0.1", "audit")).result, "paid");
});

for (const kind of ["pending", "reverted", "timeout", "replacement"]) {
  test(`audit: ${kind} transaction never reports paid`, async () => {
    const c = await fresh({ seed: "1" });
    const fake = async () => ({ hash: ethers.ZeroHash, wait: async () => {
      if (kind === "pending") return null;
      if (kind === "reverted") throw Object.assign(new Error("reverted"), { receipt: { status: 0, hash: ethers.ZeroHash } });
      throw Object.assign(new Error(kind), { code: kind === "replacement" ? "TRANSACTION_REPLACED" : "TIMEOUT" });
    } });
    fake.staticCall = async () => [true, 0n];
    fake.estimateGas = async () => 100000n;
    Object.defineProperty(c.contract, "pay", { value: fake });
    await assert.rejects(c.pay(shop, "0.1", "audit"), e => {
      const message = explain(e, c.iface);
      assert.match(message, kind === "reverted" ? /reverted/ : /not confirmed/);
      assert.match(message, new RegExp(ethers.ZeroHash));
      return true;
    });
  });
}

test("audit: refuel preserves period capacity and exhausted limits still allow requests", async () => {
  const c = await fresh({ budget: "5", seed: "1" });
  for (const amount of ["1", "1", "0.9"]) await (await c.contract.refuel(c.accountId, E(amount))).wait();
  await provider.send("anvil_setBalance", [c.agent.address, ethers.toQuantity(E("0.01"))]);
  assert.equal((await c.pay(shop, "0.1", "audit")).result, "paid");
  assert.equal((await c.status()).can_spend_now_without_asking, "0 POT");
  const held = await c.pay(shop, "0.1", "audit");
  assert.equal(held.result, "held for owner approval");
  assert.equal(held.gas_refuel, undefined);
  await provider.send("evm_increaseTime", [86400]);
  await provider.send("evm_mine", []);
  assert.equal((await c.status()).can_spend_now_without_asking, "2 POT");
});

test("audit: a preview is advisory when the owner freezes before payment", async () => {
  const c = await fresh();
  assert.equal((await c.preview(shop, "0.1")).result, "pays instantly");
  await (await al.setFrozen(c.accountId, true)).wait();
  await assert.rejects(c.pay(shop, "0.1", "audit"));
  assert.equal((await c.status()).budget_left, "2 POT");
});
