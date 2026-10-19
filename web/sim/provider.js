// Simulation mode: a tiny Ethereum-compatible chain that runs entirely in the browser.
//
// It executes the *real* Allowance bytecode (the same build that is deployed on Portaldot V3)
// in EthereumJS's EVM, and exposes it as an EIP-1193 provider, so the dashboard works
// unchanged: same contract, same rules, same errors, but nothing touches a real chain and
// no wallet or test POT is needed. One transaction = one block. State lives in memory and
// is gone when the page is reloaded.
//
// Built into docs/sim.js by build.py (esbuild); loaded only when someone clicks
// "Try it without a wallet".
import { createVM, runTx } from "@ethereumjs/vm";
import { Common, Hardfork, Mainnet, createCustomCommon } from "@ethereumjs/common";
import { createBlock } from "@ethereumjs/block";
import { createTx, createTxFromRLP } from "@ethereumjs/tx";
import {
  Account, Address, bigIntToHex, bytesToHex, createAddressFromPrivateKey, createAddressFromString, createContractAddress, hexToBytes,
} from "@ethereumjs/util";

export const CHAIN_ID = 77001;
const GWEI = 1_000_000_000n;
const BASE_FEE = 1n * GWEI;
const BLOCK_GAS = 30_000_000n;
const ETHER = 10n ** 18n;

const hex = (n) => bigIntToHex(BigInt(n));
const toBig = (v, d = 0n) => (v == null ? d : BigInt(v));
const addr = (s) => createAddressFromString(s);
const lower = (s) => s.toLowerCase();

class RpcError extends Error {
  constructor(message, code = -32000, data) { super(message); this.code = code; this.data = data; }
}

export async function createSimulation({ bytecode, ownerKey, startBalance = 10_000n * ETHER }) {
  const common = createCustomCommon({ chainId: CHAIN_ID, name: "allowance-simulation" }, Mainnet, { hardfork: Hardfork.Cancun });
  const vm = await createVM({ common });
  const ownerPk = hexToBytes(ownerKey);
  const owner = createAddressFromPrivateKey(ownerPk);
  await vm.stateManager.putAccount(owner, new Account(0n, startBalance));

  let timeOffset = 0; // seconds added by "fast-forward"
  const now = () => Math.floor(Date.now() / 1000) + timeOffset;
  const blocks = []; // { number, hash, timestamp, txs: [hash] }
  const txs = new Map(); // hash -> { tx, receipt, blockNumber, index }
  const logs = []; // { address, topics, data, blockNumber, blockHash, transactionHash, transactionIndex, logIndex }
  const listeners = new Map();

  function header(number, timestamp) {
    return { number, timestamp: BigInt(timestamp), gasLimit: BLOCK_GAS, baseFeePerGas: BASE_FEE, coinbase: createAddressFromString("0x" + "00".repeat(19) + "01") };
  }
  function blockHash(n) { return "0x" + n.toString(16).padStart(64, "0").replace(/^0{4}/, "a110"); }
  function pushBlock(timestamp, txHashes) {
    const number = blocks.length;
    const b = { number, hash: blockHash(number), timestamp, txs: txHashes };
    blocks.push(b);
    return b;
  }
  pushBlock(now(), []); // genesis

  const latest = () => blocks[blocks.length - 1];
  const nextTimestamp = () => Math.max(now(), latest().timestamp + 1);

  async function execute(tx) {
    const ts = nextTimestamp();
    const number = BigInt(blocks.length);
    const block = createBlock({ header: header(number, ts) }, { common });
    const res = await runTx(vm, { tx, block, skipBlockGasLimitValidation: true, skipHardForkValidation: true });
    const hash = bytesToHex(tx.hash());
    const b = pushBlock(ts, [hash]);
    const to = tx.to ? tx.to.toString() : null;
    const created = res.createdAddress ? res.createdAddress.toString() : null;
    const ok = res.execResult.exceptionError === undefined;
    const txLogs = (ok ? res.execResult.logs || [] : []).map(([address, topics, data], i) => {
      const l = {
        address: bytesToHex(address), topics: topics.map(bytesToHex), data: bytesToHex(data),
        blockNumber: hex(b.number), blockHash: b.hash, transactionHash: hash, transactionIndex: "0x0", logIndex: hex(i), removed: false,
      };
      logs.push(l);
      return l;
    });
    const from = tx.getSenderAddress().toString();
    const receipt = {
      transactionHash: hash, transactionIndex: "0x0", blockHash: b.hash, blockNumber: hex(b.number),
      from, to, contractAddress: ok ? created : null, cumulativeGasUsed: hex(res.totalGasSpent), gasUsed: hex(res.totalGasSpent),
      effectiveGasPrice: hex(BASE_FEE), logs: txLogs, logsBloom: "0x" + "00".repeat(256), status: ok ? "0x1" : "0x0", type: hex(tx.type),
    };
    txs.set(hash, { tx, receipt, blockNumber: b.number });
    emit("block", b.number);
    return hash;
  }

  // Read-only execution against the latest state; nothing is kept.
  async function dryRun(call) {
    const from = call.from ? addr(call.from) : owner;
    await vm.stateManager.checkpoint();
    try {
      const res = await vm.evm.runCall({
        caller: from, origin: from, to: call.to ? addr(call.to) : undefined,
        data: call.data || call.input ? hexToBytes(call.data || call.input) : new Uint8Array(),
        value: toBig(call.value), gasLimit: toBig(call.gas, BLOCK_GAS), skipBalance: true,
        block: createBlock({ header: header(BigInt(blocks.length), nextTimestamp()) }, { common }),
      });
      return res;
    } finally {
      await vm.stateManager.revert();
    }
  }
  function revertError(res) {
    const data = bytesToHex(res.execResult.returnValue);
    return new RpcError("execution reverted", 3, data);
  }

  async function nonceOf(a) { return (await vm.stateManager.getAccount(addr(a)))?.nonce ?? 0n; }

  async function sendFromOwner(p) {
    if (lower(p.from || owner.toString()) !== lower(owner.toString())) throw new RpcError("Unknown account " + p.from, 4100);
    const est = p.gas ? BigInt(p.gas) : await estimate(p);
    const tx = createTx({
      type: 2, chainId: BigInt(CHAIN_ID), nonce: await nonceOf(owner.toString()), to: p.to || undefined,
      value: toBig(p.value), data: p.data || p.input || "0x", gasLimit: est,
      maxFeePerGas: 2n * BASE_FEE, maxPriorityFeePerGas: 0n,
    }, { common }).sign(ownerPk);
    return execute(tx);
  }

  async function estimate(call) {
    const res = await dryRun(call);
    if (res.execResult.exceptionError) throw revertError(res);
    return (res.execResult.executionGasUsed + 100_000n) * 2n;
  }

  function filterLogs(f = {}) {
    const fromB = f.fromBlock && f.fromBlock !== "earliest" ? (f.fromBlock === "latest" ? latest().number : Number(f.fromBlock)) : 0;
    const toB = f.toBlock && f.toBlock !== "latest" ? Number(f.toBlock) : latest().number;
    const addrs = f.address ? [].concat(f.address).map(lower) : null;
    return logs.filter((l) => {
      const n = Number(l.blockNumber);
      if (n < fromB || n > toB) return false;
      if (addrs && !addrs.includes(lower(l.address))) return false;
      return (f.topics || []).every((t, i) => t == null || [].concat(t).map(lower).includes(lower(l.topics[i] || "")));
    });
  }

  function blockJson(b, full) {
    return {
      number: hex(b.number), hash: b.hash, parentHash: b.number ? blocks[b.number - 1].hash : "0x" + "00".repeat(32),
      timestamp: hex(b.timestamp), gasLimit: hex(BLOCK_GAS), gasUsed: "0x0", baseFeePerGas: hex(BASE_FEE),
      miner: "0x" + "00".repeat(19) + "01", difficulty: "0x0", nonce: "0x0000000000000000", extraData: "0x",
      logsBloom: "0x" + "00".repeat(256), sha3Uncles: "0x" + "00".repeat(32), stateRoot: "0x" + "00".repeat(32),
      transactionsRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), size: "0x0", uncles: [],
      transactions: full ? b.txs.map((h) => txJson(h)) : b.txs,
    };
  }
  function txJson(h) {
    const t = txs.get(h);
    if (!t) return null;
    const j = t.tx.toJSON();
    return { ...j, hash: h, from: t.tx.getSenderAddress().toString(), blockHash: t.receipt.blockHash, blockNumber: t.receipt.blockNumber, transactionIndex: "0x0", type: hex(t.tx.type) };
  }
  function blockByTag(tag) {
    if (tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized" || tag == null) return latest();
    if (tag === "earliest") return blocks[0];
    return blocks[Number(tag)] || null;
  }

  const methods = {
    eth_chainId: () => hex(CHAIN_ID),
    net_version: () => String(CHAIN_ID),
    web3_clientVersion: () => "allowance-simulation/ethereumjs",
    eth_accounts: () => [owner.toString()],
    eth_requestAccounts: () => [owner.toString()],
    eth_blockNumber: () => hex(latest().number),
    eth_gasPrice: () => hex(BASE_FEE),
    eth_maxPriorityFeePerGas: () => "0x0",
    eth_feeHistory: () => ({ oldestBlock: hex(latest().number), baseFeePerGas: [hex(BASE_FEE), hex(BASE_FEE)], gasUsedRatio: [0], reward: [["0x0"]] }),
    eth_getBalance: async ([a]) => hex((await vm.stateManager.getAccount(addr(a)))?.balance ?? 0n),
    eth_getTransactionCount: async ([a]) => hex(await nonceOf(a)),
    eth_getCode: async ([a]) => bytesToHex(await vm.stateManager.getCode(addr(a))),
    eth_getBlockByNumber: ([tag, full]) => { const b = blockByTag(tag); return b ? blockJson(b, full) : null; },
    eth_getBlockByHash: ([h, full]) => { const b = blocks.find((x) => x.hash === h); return b ? blockJson(b, full) : null; },
    eth_getTransactionByHash: ([h]) => txJson(h),
    eth_getTransactionReceipt: ([h]) => txs.get(h)?.receipt ?? null,
    eth_getLogs: ([f]) => filterLogs(f),
    eth_call: async ([call]) => {
      const res = await dryRun(call);
      if (res.execResult.exceptionError) throw revertError(res);
      return bytesToHex(res.execResult.returnValue);
    },
    eth_estimateGas: async ([call]) => hex(await estimate(call)),
    eth_sendTransaction: async ([p]) => sendFromOwner(p),
    eth_sendRawTransaction: async ([raw]) => {
      const tx = createTxFromRLP(hexToBytes(raw), { common });
      if (!tx.isSigned()) throw new RpcError("transaction is not signed");
      const pre = await dryRun({ from: tx.getSenderAddress().toString(), to: tx.to?.toString(), data: bytesToHex(tx.data), value: tx.value });
      if (pre.execResult.exceptionError) throw revertError(pre);
      return execute(tx);
    },
    wallet_switchEthereumChain: () => null,
    wallet_addEthereumChain: () => null,
  };

  function emit(event, ...args) { for (const fn of listeners.get(event) || []) try { fn(...args); } catch {} }

  const provider = {
    isAllowanceSimulation: true,
    async request({ method, params = [] }) {
      const fn = methods[method];
      if (!fn) throw new RpcError(`${method} is not available in simulation mode`, 4200);
      return fn(params);
    },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    // --- simulation helpers (not part of EIP-1193)
    owner: owner.toString(),
    chainId: CHAIN_ID,
    /** Move the simulated clock forward and mine an empty block, so period limits reset. */
    async advance(seconds) { timeOffset += seconds; pushBlock(nextTimestamp(), []); emit("block", latest().number); },
    /** Give an address some native POT (used to fund demo agents' gas). */
    async faucet(address, wei) {
      const a = addr(address);
      const acc = (await vm.stateManager.getAccount(a)) ?? new Account();
      acc.balance += BigInt(wei);
      await vm.stateManager.putAccount(a, acc);
    },
    now,
  };

  // Deploy the real Allowance bytecode as the owner's first transaction.
  const deployHash = await sendFromOwner({ data: bytecode, gas: hex(BLOCK_GAS) });
  const rcpt = txs.get(deployHash).receipt;
  if (rcpt.status !== "0x1") throw new Error("Simulation: deploying Allowance failed");
  provider.allowance = rcpt.contractAddress;
  provider.allowanceFromBlock = Number(rcpt.blockNumber);
  provider.expectedAddress = createContractAddress(owner, 0n).toString();
  return provider;
}

// Expose for the dashboard (docs/sim.js is an IIFE bundle).
globalThis.AllowanceSim = { createSimulation, CHAIN_ID };
