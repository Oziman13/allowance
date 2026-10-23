// Allowance client used by the MCP server (and its tests).
// The agent key only ever signs calls to the Allowance contract. Every rule is enforced on-chain,
// so nothing here is a security boundary: this file only makes the contract easy for an AI to use.
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

export const ABI = JSON.parse(readFileSync(new URL("./abi.json", import.meta.url), "utf8"));
const ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];

export const NETWORKS = {
  "portaldot-testnet": { name: "Portaldot V3 Testnet", chainId: 420420777, rpc: "https://test-evm-rpc-v3.portaldot.dev", symbol: "POT", explorer: null,
    allowance: "0xdF8567f1fA9F6aFBe1c8f99453544C35009ac07f" }, // public deployment (2026-10-19)
  local: { name: "Local (anvil)", chainId: 31337, rpc: "http://127.0.0.1:8545", symbol: "POT", explorer: null },
};

const HOLD = ["", "larger than the per-payment cap", "over this period's limit", "the recipient is not trusted"];
const STATUS = ["none", "pending", "approved", "rejected", "cancelled"];

// What the AI should do after each error: plain words, one next step.
const ERRORS = {
  AccountFrozen: "The owner has frozen this allowance. Do not retry. Tell the user the agent is frozen.",
  AccountExpired: "This allowance has expired. Do not retry. Ask the user to extend it.",
  InsufficientBudget: "Not enough budget left in the allowance. Ask the user to add budget.",
  NotAgent: "This key is not the agent for that allowance. Check ALLOWANCE_ACCOUNT_ID.",
  NotPending: "That request was already decided or cancelled.",
  InvalidAddress: "That recipient address can't be used.",
  InvalidAmount: "The amount must be greater than zero.",
  TextTooLong: "The memo is too long (140 characters max).",
  TransferFailed: "The recipient refused the payment, so nothing moved.",
  UnknownAccount: "No allowance with that id exists in this contract.",
  UnknownRequest: "No request with that id exists.",
  OutsideRules: "That gas refuel is outside the rules for this period.",
};

export function explain(err, iface) {
  const data = err?.data || err?.info?.error?.data || err?.error?.data;
  let name = err?.revert?.name;
  if (!name && data) { try { name = iface.parseError(data)?.name; } catch {} }
  if (name) return ERRORS[name] || name;
  const msg = err?.shortMessage || err?.message || String(err);
  if (/insufficient funds/i.test(msg)) return "The agent doesn't have enough POT for this transaction's gas and storage deposit (asking for approval stores a request on chain). Nothing was sent. Ask the user to top up the agent's gas.";
  // Node rejections ethers can't parse ("could not coalesce error"): show the node's own words.
  const raw = err?.error?.message || err?.info?.error?.message;
  if (raw) return `The network rejected the transaction (${raw}${err?.error?.code ? `, code ${err.error.code}` : ""}). Nothing was sent. Don't retry in a loop; tell the user.`;
  return msg;
}

/**
 * @param {object} o
 * @param {string} o.key        agent private key
 * @param {string} [o.address] Allowance contract address (defaults to the network's public deployment)
 * @param {string} [o.rpc]      RPC URL (defaults to the network's)
 * @param {string} [o.network]  "portaldot-testnet" | "local"
 * @param {number} [o.accountId] account to use; defaults to the newest one this agent controls
 * @param {bigint} [o.minGas]   refuel when the agent's own balance drops below this (wei)
 */
export async function createClient(o) {
  const net = NETWORKS[o.network || "portaldot-testnet"];
  if (!net) throw new Error(`Unknown network "${o.network}". Use one of: ${Object.keys(NETWORKS).join(", ")}`);
  o = { ...o, address: o.address || net.allowance };
  if (!ethers.isAddress(o.address)) throw new Error("ALLOWANCE_ADDRESS must be the Allowance contract address.");
  const provider = new ethers.JsonRpcProvider(o.rpc || net.rpc, net.chainId, { staticNetwork: true, cacheTimeout: -1 });
  provider.pollingInterval = 500;
  const agent = new ethers.Wallet(o.key, provider);
  const al = new ethers.Contract(o.address, ABI, agent);
  const minGas = o.minGas ?? ethers.parseEther("0.05");

  // Portaldot V3 charges storage deposits through gas, so a held request can cost ~15 POT.
  // Its RPC reports a priority fee of 0, and the transaction pool rejected such large transactions
  // ("1010 Invalid Transaction"). Send them the way the dashboard's successful ones were sent
  // (verified on chain): EIP-1559 with a 1 gwei tip, max fee = 2 × base fee + tip, gas limit = the
  // estimate. The chain charges the base fee only, so the tip doesn't change the cost.
  const TIP = 1_000_000_000n;
  async function fees(method, args) {
    const base = (await provider.getBlock("latest")).baseFeePerGas ?? (await provider.getFeeData()).gasPrice;
    const gasLimit = await al[method].estimateGas(...args);
    return { type: 2, maxPriorityFeePerGas: TIP, maxFeePerGas: base * 2n + TIP, gasLimit };
  }
  const send = async (method, ...args) => al[method](...args, await fees(method, args));

  let id = o.accountId;
  if (id == null || Number.isNaN(id)) {
    const ids = (await al.accountsOfAgent(agent.address)).map(Number);
    for (const i of ids.reverse()) {
      const [a] = await al.getAccount(i);
      if (a.agent.toLowerCase() === agent.address.toLowerCase()) { id = i; break; }
    }
    if (id == null) throw new Error(`The agent ${agent.address} has no allowance in ${o.address}. Create one on the Allowance dashboard first.`);
  }

  let meta;
  async function account() {
    const [a, left] = await al.getAccount(id);
    if (a.agent.toLowerCase() !== agent.address.toLowerCase()) throw new Error(ERRORS.NotAgent);
    if (!meta) {
      if (a.asset === ethers.ZeroAddress) meta = { symbol: net.symbol, decimals: 18, native: true };
      else {
        const t = new ethers.Contract(a.asset, ERC20, provider);
        meta = { symbol: await t.symbol().catch(() => "TOKEN"), decimals: Number(await t.decimals().catch(() => 18)), native: false };
      }
    }
    return { a, left };
  }
  const fmt = (v) => `${ethers.formatUnits(v, meta.decimals).replace(/\.0$/, "")} ${meta.symbol}`;
  const parse = (x) => ethers.parseUnits(String(x), meta.decimals);
  const link = (h) => (net.explorer ? `${net.explorer}/tx/${h}` : h);
  const now = async () => Number((await provider.getBlock("latest")).timestamp);

  async function status() {
    const { a, left } = await account();
    const t = await now();
    const expired = Number(a.rules.expiresAt) !== 0 && t >= Number(a.rules.expiresAt);
    const resetIn = Number(a.periodStart) + Number(a.rules.period) - t;
    return {
      allowance: a.name || `#${id}`,
      account_id: id,
      network: net.name,
      state: a.frozen ? "frozen by owner" : expired ? "expired" : "active",
      // The period limit caps what the agent may spend alone; the budget caps what exists. Show the smaller.
      can_spend_now_without_asking: fmt(left < a.balance ? left : a.balance),
      note: "Payments the owner approves don't count against the period limit; they still come out of the budget.",
      period_limit: `${fmt(a.rules.perPeriod)} per ${periodName(Number(a.rules.period))}`,
      period_resets_in: left === a.rules.perPeriod ? "nothing spent this period" : resetIn > 0 ? duration(resetIn) : "on the next payment",
      per_payment_limit: fmt(a.rules.perPayment),
      recipients: a.rules.trustedOnly ? "trusted recipients only; others need owner approval" : "any recipient",
      budget_left: fmt(a.balance),
      expires: Number(a.rules.expiresAt) ? new Date(Number(a.rules.expiresAt) * 1000).toISOString() : "never",
      agent: agent.address,
      agent_gas_balance: meta.native ? fmt(await provider.getBalance(agent.address)) : `${ethers.formatEther(await provider.getBalance(agent.address))} ${net.symbol}`,
    };
  }

  async function preview(to, amount) {
    const { a } = await account();
    if (!ethers.isAddress(to)) return { result: "invalid", reason: "Not a valid 0x address." };
    const t = await now();
    if (a.frozen) return { result: "blocked", reason: ERRORS.AccountFrozen };
    if (Number(a.rules.expiresAt) && t >= Number(a.rules.expiresAt)) return { result: "blocked", reason: ERRORS.AccountExpired };
    const amt = parse(amount);
    const [hold, left] = await al.preview(id, to, amt);
    if (Number(hold) !== 0) return { result: "needs owner approval", reason: HOLD[Number(hold)], left_this_period: fmt(left) };
    if (amt > a.balance) return { result: "blocked", reason: ERRORS.InsufficientBudget };
    return { result: "pays instantly", left_this_period_after: fmt(left - amt) };
  }

  // Keep enough native POT on the agent to pay for its own transactions.
  // The refuel comes out of the same budget and counts against the same limits.
  async function ensureGas() {
    if (!meta.native) return null;
    const bal = await provider.getBalance(agent.address);
    if (bal >= minGas) return null;
    const { a, left } = await account();
    let amt = minGas * 2n;
    for (const cap of [a.rules.perPayment, left, a.balance]) if (amt > cap) amt = cap;
    if (amt === 0n) return null;
    const tx = await send("refuel", id, amt);
    await tx.wait();
    return { refueled: fmt(amt), tx: link(tx.hash) };
  }

  async function pay(to, amount, memo) {
    await account();
    if (!ethers.isAddress(to)) throw new Error("Not a valid 0x address.");
    const amt = parse(amount);
    await al.pay.staticCall(id, to, amt, memo); // fails fast, without spending gas, if frozen, expired or out of budget
    const gas = await ensureGas();
    const t0 = Date.now();
    const tx = await send("pay", id, to, amt, memo);
    const rcpt = await tx.wait();
    const held = rcpt.logs.map((l) => { try { return al.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "PaymentHeld");
    const out = held
      ? { result: "held for owner approval", request_id: Number(held.args.requestId), reason: HOLD[Number(held.args.reason)], amount: fmt(amt), next_step: "Tell the user it is waiting for their approval. Check later with allowance_request.", tx: link(tx.hash) }
      : { result: "paid", amount: fmt(amt), to, memo, confirmed_in_ms: Date.now() - t0, tx: link(tx.hash) };
    if (gas) out.gas_refuel = gas;
    return out;
  }

  async function request(requestId) {
    const r = await al.getRequest(requestId);
    if (Number(r.accountId) !== id) throw new Error("That request belongs to another allowance.");
    return { request_id: Number(requestId), status: STATUS[Number(r.status)], amount: fmt(r.amount), to: r.to, memo: r.memo, held_because: HOLD[Number(r.reason)] };
  }

  async function cancel(requestId) {
    const tx = await send("cancel", requestId);
    await tx.wait();
    return { request_id: Number(requestId), status: "cancelled", tx: link(tx.hash) };
  }

  return { agent, provider, contract: al, accountId: id, network: net, status, preview, pay, request, cancel, iface: al.interface };
}

function duration(s) {
  const n = (v, u) => `${v} ${u}${v === 1 ? "" : "s"}`;
  if (s >= 86400) return n(Math.round(s / 86400), "day");
  if (s >= 3600) return n(Math.round(s / 3600), "hour");
  return n(Math.max(1, Math.round(s / 60)), "minute");
}
const periodName = (s) => ({ 3600: "hour", 86400: "day", 604800: "week" })[s] || duration(s);
