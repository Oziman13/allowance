// Read Allowance from a native Portaldot (Substrate) account, without signing anything.
//
// Portaldot V3 is one chain with two faces: Substrate accounts (5…) and an EVM side run by
// pallet-revive (0x…). This script shows that a Substrate account can already reach the
// Allowance contract through revive's runtime API: which 0x address the contract sees for it,
// whether that address is mapped yet, and a dry-run read of its allowances.
//
//   cd substrate && npm install
//   node check.mjs                      # the deployer's account, public RPC
//   node check.mjs 5Your…SS58…Address   # any Portaldot account
//   RPC=wss://test-node-v3.portaldot.dev node check.mjs
//
// Only reads chain state and dry-runs calls (reviveApi.call). No key, no extrinsic.
import { ApiPromise, HttpProvider, WsProvider } from '@polkadot/api';
import { Interface, formatEther as fe } from 'ethers';
const formatEther = (v) => fe(v).replace(/\.0$/, '');
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const nets = JSON.parse(readFileSync(new URL('../config/networks.json', here)));
const net = nets['portaldot-testnet'];
const abi = new Interface(JSON.parse(readFileSync(new URL('../docs/abi.json', here))));
const RPC = process.env.RPC || 'https://test-node-v3.portaldot.dev';
// Default: the Substrate twin of the deployer's MetaMask address (0x… followed by twelve 0xEE bytes).
const who = process.argv[2] || '5CcDLjHrfoBeL4NX6ZGQzhBbzCrsS7qwFazkzFcF83pWjq3v';

const api = await ApiPromise.create({
  provider: RPC.startsWith('ws') ? new WsProvider(RPC) : new HttpProvider(RPC),
  noInitWarn: true,
});
const ok = (b) => (b ? 'yes' : 'NO');
try {
  const rt = api.runtimeVersion;
  console.log(`Chain        ${(await api.rpc.system.chain()).toString()} · ${rt.specName} ${rt.specVersion}`);
  console.log(`Genesis      ${api.genesisHash.toHex()}`);
  console.log(`Revive       mapAccount ${ok(api.tx.revive?.mapAccount)} · call ${ok(api.tx.revive?.call)} · dry run ${ok(api.call.reviveApi?.call)}`);

  // The 0x address the contract sees as msg.sender when this account calls it.
  const h160 = (await api.call.reviveApi.address(who)).toString();
  const mapped = (await api.query.revive.originalAccount(h160)).isSome;
  const twin = h160.toLowerCase() + 'ee'.repeat(12);
  const isTwin = api.createType('AccountId32', who).toHex().toLowerCase() === twin;
  console.log(`Account      ${who}`);
  console.log(`Acts as      ${h160}${isTwin ? '  (this is the twin of a MetaMask address)' : ''}`);
  console.log(`Mapped       ${isTwin ? 'not needed (fallback account)' : mapped ? 'yes' : 'no: send revive.mapAccount() once before acting on the EVM side'}`);

  // Dry-run reads of the Allowance contract from this account.
  const read = async (fn, args) => {
    const r = await api.call.reviveApi.call(who, net.allowance, 0, null, null, abi.encodeFunctionData(fn, args));
    const res = r.result.toJSON();
    if (!res.ok) throw new Error(`${fn}: ${JSON.stringify(res)}`);
    if (Number(res.ok.flags?.bits ?? res.ok.flags) & 1) throw new Error(`${fn} reverted`); // bit 0 = REVERT
    return abi.decodeFunctionResult(fn, res.ok.data);
  };
  const [count] = await read('accountCount', []);
  const [mine] = await read('accountsOfOwner', [h160]);
  console.log(`Contract     ${net.allowance} · ${count} ${count === 1n ? 'allowance' : 'allowances'} in total`);
  console.log(`Owned here   ${mine.length ? mine.join(', ') : 'none'}`);
  for (const id of mine) {
    const [a, left] = await read('getAccount', [id]);
    const now = left < a.balance ? left : a.balance; // never more than the budget
    console.log(`  #${id} ${a.name}: budget ${formatEther(a.balance)} POT, can spend ${formatEther(now)} POT now without asking, ${a.frozen ? 'frozen' : 'active'}`);
  }
} finally {
  await api.disconnect();
}
