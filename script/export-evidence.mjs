// Export Allowance's on-chain evidence from the Portaldot V3 testnet into evidence/onchain.json.
//
//   npm --prefix mcp install         # once, for ethers
//   node script/export-evidence.mjs
//
// Read-only: it asks the public RPC for the deployed code and every event the contract has
// emitted (eth_getLogs keeps working after the testnet prunes old receipts), decodes them with
// the contract's ABI and writes one JSON file anyone can diff against the chain again.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const { ethers } = createRequire(new URL('mcp/package.json', root))('ethers');
const net = JSON.parse(readFileSync(new URL('config/networks.json', root)))['portaldot-testnet'];
const abi = new ethers.Interface(JSON.parse(readFileSync(new URL('docs/abi.json', root))));
const rpc = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });

const plain = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v);
const code = await rpc.getCode(net.allowance);
const latest = await rpc.getBlockNumber();
const logs = await rpc.getLogs({ address: net.allowance, fromBlock: net.allowanceFromBlock, toBlock: latest });
const events = logs.map((l) => {
  const e = abi.parseLog(l);
  return {
    block: l.blockNumber,
    tx: l.transactionHash,
    event: e.name,
    args: Object.fromEntries(e.fragment.inputs.map((input, i) => [input.name, plain(e.args[i])])),
    explorer: `https://scanner-testnet-v3.portaldot.dev/#/blocks/${l.blockNumber}`,
  };
});
const out = {
  network: { name: net.name, chainId: net.chainId, rpc: net.rpc },
  contract: net.allowance,
  deployBlock: net.allowanceFromBlock,
  deployTx: net.allowanceDeployTx,
  codeBytes: (code.length - 2) / 2,
  codeKeccak256: ethers.keccak256(code),
  readAtBlock: latest,
  readAt: new Date().toISOString(),
  events,
};
mkdirSync(new URL('evidence/', root), { recursive: true });
writeFileSync(new URL('evidence/onchain.json', root), JSON.stringify(out, null, 2) + '\n');
console.log(`evidence/onchain.json: ${events.length} events from block ${net.allowanceFromBlock} to ${latest}, code ${out.codeBytes} bytes`);
