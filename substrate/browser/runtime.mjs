import { ApiPromise, HttpProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { GENESIS, NativeError } from './controller.mjs';

const fail = (code, message) => { throw new NativeError(code, message); };
const hex = (v, bytes) => typeof v === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(v);
const lower = v => v.toLowerCase();
export function normalizeAccount(account) {
  if (!account || !['sr25519', 'ed25519', 'ecdsa', undefined].includes(account.type)) throw new Error('Unsupported account type');
  const bytes = decodeAddress(account.address);
  if (bytes.length !== 32) throw new Error('Expected AccountId32');
  const id = '0x' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  if (account.genesisHash && lower(account.genesisHash) !== GENESIS) throw new Error('Account restricted to another chain');
  return { id, ss58: encodeAddress(bytes, 42), name: String(account.name || 'Native account').slice(0, 100) };
}

// A positive RPC allowlist: generic SDK transaction methods cannot reach the network.
// state_call is a read-only runtime invocation (ReviveApi_address), never an extrinsic.
export const SUBSTRATE_READS = new Set(['rpc_methods', 'system_chain', 'system_properties', 'system_name',
  'system_version', 'state_getRuntimeVersion', 'state_getMetadata', 'chain_getBlockHash',
  'chain_getFinalizedHead', 'chain_getHeader', 'state_call', 'state_getStorage', 'state_queryStorageAt']);
export const EVM_READS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
export async function readRpc(url, method, params, signal, allowed, fetcher = fetch) {
  if (!allowed.has(method)) fail('unsupported', 'RPC method is outside the read-only boundary.');
  signal?.throwIfAborted();
  const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || data.id !== 1 || !Object.hasOwn(data, 'result')) throw new Error('RPC error or malformed response');
  return data.result;
}
class ReadProvider extends HttpProvider {
  constructor(url, signal) { super(url, {}, 0); this.url = url; this.signal = signal; }
  send(method, params) { return readRpc(this.url, method, params, this.signal, SUBSTRATE_READS); }
  clone() { return new ReadProvider(this.url, this.signal); }
  on() { return () => {}; } // HTTP snapshots have no subscriptions.
}

export function verifyNetwork({ genesis, specName, specVersion, transactionVersion }, account) {
  if (lower(genesis) !== GENESIS || specName !== 'portaldot-v3') fail('wrong-network', 'Wrong network: genesis or runtime name does not match Portaldot V3. No identity was accepted.');
  if (!/^\d+$/.test(specVersion) || !/^\d+$/.test(transactionVersion)) fail('unverified', 'Runtime versions could not be verified.');
  if (account.genesisHash && lower(account.genesisHash) !== GENESIS) fail('wrong-network', 'Account belongs to another network.');
}
export function mappingState(id, h160, reverse) {
  if (!hex(id, 32) || !hex(h160, 20) || (reverse !== null && !hex(reverse, 32))) fail('unverified', 'Malformed address or reverse mapping result.');
  if (reverse !== null) return lower(reverse) === lower(id) ? 'confirmed' : 'conflicting';
  // EVM fallback-shaped bytes are not proof of a native key or runtime exemption.
  return lower(id) === lower(h160) + 'ee'.repeat(12) ? 'unverified' : 'unmapped';
}
export function verifyCapabilities(at) {
  const metadata = at.registry.metadata;
  const revive = metadata.pallets.find(p => p.name.toString().toLowerCase() === 'revive');
  let calls = [];
  if (revive?.calls?.isSome) calls = at.registry.lookup.getSiType(revive.calls.unwrap().type).def.asVariant.variants.map(v => v.name.toString());
  const capabilities = { address: typeof at.call.reviveApi?.address === 'function',
    dryRun: typeof at.call.reviveApi?.call === 'function',
    reverse: typeof at.query.revive?.originalAccount === 'function',
    mapAccount: calls.includes('map_account'), call: calls.includes('call') };
  if (!capabilities.address || !capabilities.reverse) fail('unsupported-api', 'Required ReviveApi.address or revive.originalAccount read API is unavailable. No local H160 derivation was substituted.');
  // Inspect metadata only. Never construct or invoke api.tx methods.
  return capabilities;
}

export async function readOwnership({ net, iface, h160, signal, rpc = readRpc, checkOwner = true }) {
  const call = (method, params) => rpc(net.rpc, method, params, signal, EVM_READS);
  if (BigInt(await call('eth_chainId', [])) !== 420420777n) fail('wrong-network', 'EVM endpoint reports the wrong chain ID.');
  const block = await call('eth_getBlockByNumber', ['finalized', false]);
  if (!block || !hex(block.hash, 32) || !/^0x[0-9a-f]+$/i.test(block.number)) fail('unverified', 'EVM finalized block is unavailable. No latest-block fallback was used.');
  const code = await call('eth_getCode', [net.allowance, block.number]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) fail('unverified', 'Configured contract has no verified deployed code. This panel cannot deploy.');
  if (!checkOwner) return { block: block.number, hash: block.hash, code: 'present', contract: net.allowance };
  const read = async (method, args) => iface.decodeFunctionResult(method,
    await call('eth_call', [{ to: net.allowance, data: iface.encodeFunctionData(method, args) }, block.number]));
  const [ids] = await read('accountsOfOwner', [h160]);
  const accounts = [];
  for (const id of ids.slice(0, 30)) {
    const [a] = await read('getAccount', [id]);
    if (lower(a.owner) !== lower(h160)) fail('ownership-conflict', 'Stored allowance owner differs from the resolved H160. No ownership list was accepted.');
    accounts.push({ id: id.toString(), owner: a.owner, name: a.name, asset: a.asset,
      balance: a.balance.toString(), frozen: a.frozen, expiresAt: a.rules.expiresAt.toString() });
  }
  const end = await call('eth_getBlockByNumber', [block.number, false]);
  if (end?.hash !== block.hash) fail('unverified', 'EVM snapshot changed during the read. Refresh to recheck.');
  return { accounts, total: ids.length, block: block.number, hash: block.hash, code: 'present', contract: net.allowance };
}

export function createInspector(net, iface, { createApi = options => new ApiPromise(options), rpc = readRpc } = {}) {
  return async (account, signal) => {
    // Derived from the configured Substrate WS endpoint, as supported by check.mjs.
    const endpoint = net.substrateWs.replace(/^wss:/, 'https:');
    if (!endpoint.startsWith('https:')) fail('unsupported-api', 'Configured HTTPS Substrate endpoint is unavailable.');
    const api = createApi({ provider: new ReadProvider(endpoint, signal), noInitWarn: true, throwOnConnect: true });
    const close = () => { api.disconnect().catch(() => {}); };
    signal.addEventListener('abort', close, { once: true });
    try {
      await api.isReadyOrError;
      signal.throwIfAborted();
      const block = (await api.rpc.chain.getFinalizedHead()).toHex();
      // ApiDecoration.runtimeVersion may be RuntimeVersionPartial (no transactionVersion).
      // Read the complete version at this snapshot, and reject mismatched metadata on upgrade.
      const rt = await api.rpc.state.getRuntimeVersion(block);
      const at = await api.at(block, rt);
      if (at.runtimeVersion.specName.toString() !== rt.specName.toString()
          || at.runtimeVersion.specVersion.toString() !== rt.specVersion.toString()) {
        fail('unsupported-api', 'Runtime changed at the snapshot boundary. Metadata and version do not match; refresh to recheck.');
      }
      const network = { genesis: api.genesisHash.toHex(), specName: rt.specName.toString(),
        specVersion: rt.specVersion.toString(), transactionVersion: rt.transactionVersion.toString(), block };
      verifyNetwork(network, account);
      const capabilities = verifyCapabilities(at);
      const h160 = (await at.call.reviveApi.address(account.id)).toString();
      if (!hex(h160, 20)) fail('unverified', 'Runtime returned an invalid H160.');
      const original = await at.query.revive.originalAccount(h160);
      if (typeof original.isSome !== 'boolean' || typeof original.isNone !== 'boolean' || original.isNone === original.isSome) fail('unverified', 'Unsupported reverse mapping response.');
      const mapping = mappingState(account.id, h160, original.isSome ? original.unwrap().toHex() : null);
      const snapshot = { status: mapping, mapping, h160, network, capabilities, contract: net.allowance,
        message: { confirmed: 'Reverse mapping matches the selected AccountId32. Owner writes remain unavailable.',
          unmapped: 'No reverse mapping recorded. Mapping is not performed by this dashboard.',
          conflicting: 'Reverse mapping points to a different AccountId32. Do not treat this identity as an owner.',
          unverified: 'Fallback-shaped account has no reverse entry. Native control and mapping exemption are unverified.' }[mapping] };
      try {
        const deployment = await readOwnership({ net, iface, h160, signal, rpc, checkOwner: mapping === 'confirmed' });
        snapshot.deployment = deployment;
        if (mapping === 'confirmed') {
          snapshot.ownership = deployment;
          snapshot.status = 'verified';
          snapshot.message = 'Mapping and stored owner reads verified at the displayed snapshots. This does not prove signed-write compatibility.';
        }
      } catch (e) {
        signal.throwIfAborted();
        snapshot.status = e.code || 'rpc-unavailable';
        snapshot.message = e.code ? e.message : 'EVM RPC read failed. Ownership and budgets are unavailable, not zero.';
      }
      return snapshot;
    } finally { signal.removeEventListener('abort', close); close(); }
  };
}
