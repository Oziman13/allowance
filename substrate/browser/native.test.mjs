import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface } from 'ethers';
import { GENESIS, NativeController, walletSources } from './controller.mjs';
import { normalizeAccount, verifyNetwork, mappingState, readOwnership, readRpc,
  SUBSTRATE_READS, EVM_READS, createInspector, verifyCapabilities } from './runtime.mjs';

const id = '0x' + '11'.repeat(32), other = '0x' + '22'.repeat(32);
const h160 = '0x' + '33'.repeat(20), contract = '0x' + '44'.repeat(20);
const account = normalizeAccount({ address: id, type: 'sr25519', name: 'Shared account' });
const net = { substrateWs: 'wss://test-node-v3.portaldot.dev', rpc: 'https://test-evm-rpc-v3.portaldot.dev', allowance: contract };
const network = { genesis: GENESIS, specName: 'portaldot-v3', specVersion: '3002', transactionVersion: '1' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function extension(list = [{ address: id }], options = {}) {
  let callback, stopped = 0, permissions = 0;
  const api = { accounts: { get: async () => list, subscribe(cb) { callback = cb; return () => { stopped++; }; } } };
  Object.defineProperty(api, 'signer', { get() { throw new Error('SIGNER MUST NEVER BE ACCESSED'); } });
  Object.defineProperty(api, 'provider', { get() { throw new Error('WALLET PROVIDER MUST NEVER BE ACCESSED'); } });
  const injected = { reviewed: { async enable() { permissions++; if (options.reject) throw new Error('Rejected'); return api; } } };
  return { injected, api, update: accounts => callback(accounts), counts: () => ({ permissions, stopped }) };
}
function controller(ext, inspect = async () => ({ status: 'verified', message: 'Mock', mapping: 'confirmed' }), options = {}) {
  return new NativeController({ injected: () => ext.injected, normalize: normalizeAccount, inspect, ...options });
}
test('no permission on construction/discovery; unavailable wallet fails safely', async () => {
  const e = extension(), c = controller(e);
  assert.deepEqual(walletSources(e.injected), ['reviewed']); assert.equal(e.counts().permissions, 0);
  await c.connect('missing'); assert.equal(c.state.status, 'unsupported'); assert.equal(c.state.snapshot, null);
});
test('user rejects account authorization', async () => {
  const c = controller(extension([], { reject: true })); await c.connect('reviewed');
  assert.equal(c.state.status, 'authorization-failed'); assert.deepEqual(c.state.accounts, []);
});
test('unsupported provider rejected; signing support is unnecessary and never accessed', async () => {
  const e = extension(); delete e.api.accounts.subscribe;
  const c = controller(e); await c.connect('reviewed'); assert.equal(c.state.status, 'unsupported');
  const supported = controller(extension()); await supported.connect('reviewed'); await tick();
  assert.equal(supported.state.status, 'verified'); supported.disconnect();
});
test('multiple accounts require selection; account changes immediately invalidate, late RPC cannot restore', async () => {
  const e = extension([{ address: id }, { address: other }]), old = deferred();
  const c = controller(e, () => old.promise);
  await c.connect('reviewed'); assert.equal(c.state.status, 'choose-account'); assert.equal(c.state.selected, '');
  const pending = c.select(id); assert.equal(c.state.status, 'checking');
  e.update([{ address: other }, { address: id }]);
  assert.equal(c.state.selected, ''); assert.equal(c.state.snapshot, null);
  old.resolve({ status: 'verified', h160 }); await pending;
  assert.equal(c.state.status, 'choose-account'); assert.equal(c.state.snapshot, null); c.disconnect();
});
test('disconnect unsubscribes, clears identity and ignores late authorization/subscription', async () => {
  const e = extension(), c = controller(e); await c.connect('reviewed'); await tick();
  c.disconnect(); e.update([{ address: other }]);
  assert.equal(c.state.status, 'disconnected'); assert.equal(c.state.selected, '');
  assert.equal(e.counts().stopped, 1);
  const auth = deferred(); const late = controller({ injected: { reviewed: { enable: () => auth.promise } } });
  const pending = late.connect('reviewed'); late.disconnect(); auth.resolve(e.api); await pending;
  assert.equal(late.state.status, 'disconnected');
});
test('synchronous subscription beats stale initial account response', async () => {
  const e = extension([{ address: id }]);
  e.api.accounts.subscribe = cb => { cb([{ address: other }]); return () => {}; };
  const c = controller(e); await c.connect('reviewed'); await tick();
  assert.equal(c.state.selected, other); c.disconnect();
});
test('RPC deadline fails closed without zero balances even when backend ignores cancellation', async () => {
  const c = controller(extension(), () => new Promise(() => {}), { timeout: 10 });
  await c.connect('reviewed'); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(c.state.status, 'rpc-unavailable'); assert.equal(c.state.snapshot, null); c.disconnect();
});
test('only authorized AccountId32 identities accepted; SS58 reencoding preserves bytes', () => {
  assert.equal(normalizeAccount({ address: account.ss58 }).id, id);
  for (const a of [{ address: h160 }, { address: 'invalid' }, { address: id, type: 'ethereum' }, { address: id, genesisHash: other }]) {
    assert.throws(() => normalizeAccount(a));
  }
});
test('network genesis/runtime and versions must verify', () => {
  verifyNetwork(network, account);
  for (const values of [{ genesis: other }, { specName: 'other-chain' }]) {
    assert.throws(() => verifyNetwork({ ...network, ...values }, account), { code: 'wrong-network' });
  }
  assert.throws(() => verifyNetwork({ ...network, transactionVersion: 'unknown' }, account), { code: 'unverified' });
});
test('mapping absent, conflicting and fallback-shaped cases remain distinct', () => {
  assert.equal(mappingState(id, h160, id), 'confirmed');
  assert.equal(mappingState(id, h160, null), 'unmapped');
  assert.equal(mappingState(id, h160, other), 'conflicting');
  assert.equal(mappingState(h160 + 'ee'.repeat(12), h160, null), 'unverified');
  assert.throws(() => mappingState(id, h160, 'malformed'), { code: 'unverified' });
});

const iface = new Interface(JSON.parse(readFileSync(new URL('../../docs/abi.json', import.meta.url))));
const block = { number: '0x10', hash: '0x' + 'aa'.repeat(32) };
function evmRpc({ owner = h160, empty = false, fail = false, chainId = '0x190f1ca9', code = '0x1234', reorg = false } = {}) {
  const calls = [];
  const rpc = async (_, method, params) => {
    calls.push([method, params]); if (fail) throw new Error('RPC failure');
    if (method === 'eth_chainId') return chainId;
    if (method === 'eth_getBlockByNumber') return reorg && params[0] !== 'finalized' ? { ...block, hash: other } : block;
    if (method === 'eth_getCode') return code;
    assert.equal(method, 'eth_call'); assert.equal(params[0].to, contract); assert.equal(params[1], block.number);
    const call = iface.parseTransaction({ data: params[0].data });
    if (call.name === 'accountsOfOwner') return iface.encodeFunctionResult(call.name, [empty ? [] : [7n]]);
    assert.equal(call.name, 'getAccount');
    return iface.encodeFunctionResult(call.name, [{ owner, agent: owner, asset: '0x' + '00'.repeat(20), frozen: false,
      balance: 1230000000000000000n, spentInPeriod: 0, periodStart: 1, payments: 0, totalSpent: 0,
      rules: { perPayment: 1, perPeriod: 2, period: 86400, expiresAt: 0, trustedOnly: false }, name: 'Mock allowance' }, 0]);
  };
  return { rpc, calls };
}
function apiMock({ reverse = id, genesis = GENESIS, missing = false, failure = false } = {}) {
  let closed = 0;
  const at = { registry: { metadata: { pallets: [{ name: 'Revive', calls: { isSome: true, unwrap: () => ({ type: 1 }) } }] },
    lookup: { getSiType: () => ({ def: { asVariant: { variants: [{ name: 'call' }, { name: 'map_account' }] } } }) } },
    runtimeVersion: { specName: network.specName, specVersion: network.specVersion }, call: { reviveApi: { address: async value => {
      assert.equal(value, id); return h160;
    }, call() { throw new Error('No dry run needed'); } } },
    query: { revive: { originalAccount: async () => {
      if (failure) throw new Error('Read failed');
      return { isSome: reverse !== null, isNone: reverse === null, unwrap: () => ({ toHex: () => reverse }) };
    } } } };
  Object.defineProperty(at, 'tx', { get() { throw new Error('TRANSACTIONS MUST NEVER BE ACCESSED'); } });
  if (missing) delete at.call.reviveApi.address;
  return { at, createApi: options => {
    assert.equal(options.throwOnConnect, true);
    return { isReadyOrError: Promise.resolve(), genesisHash: { toHex: () => genesis },
      rpc: { chain: { getFinalizedHead: async () => ({ toHex: () => block.hash }) },
        state: { getRuntimeVersion: async hash => { assert.equal(hash, block.hash); return network; } } },
      at: async (hash, version) => { assert.equal(hash, block.hash); assert.equal(version, network); return at; }, disconnect: async () => { closed++; } };
  }, closed: () => closed };
}
test('runtime inspection uses finalized metadata/read API and checks exact reverse identity', async () => {
  for (const [reverse, expected] of [[id, 'verified'], [null, 'unmapped'], [other, 'conflicting']]) {
    const mock = apiMock({ reverse }), evm = evmRpc();
    const snapshot = await createInspector(net, iface, { createApi: mock.createApi, rpc: evm.rpc })(account, new AbortController().signal);
    assert.equal(snapshot.status, expected); assert.equal(snapshot.network.genesis, GENESIS);
    assert.equal(snapshot.capabilities.mapAccount, true); assert.equal(mock.closed(), 1);
    if (expected !== 'verified') assert.equal(evm.calls.some(([method]) => method === 'eth_call'), false);
  }
});
test('wrong genesis, missing read API and reverse RPC failure never become unmapped', async () => {
  for (const [options, expected] of [[{ genesis: other }, 'wrong-network'], [{ missing: true }, 'unsupported-api'], [{ failure: true }, undefined]]) {
    const mock = apiMock(options);
    await assert.rejects(createInspector(net, iface, { createApi: mock.createApi })(account, new AbortController().signal),
      error => expected ? error.code === expected : error.message === 'Read failed');
    assert.equal(mock.closed(), 1);
  }
  assert.throws(() => verifyCapabilities(apiMock({ missing: true }).at), { code: 'unsupported-api' });
});
test('partial decorated version is supported; mismatched upgrade metadata fails closed', async () => {
  const mock = apiMock();
  assert.equal(mock.at.runtimeVersion.transactionVersion, undefined);
  const result = await createInspector(net, iface, { createApi: mock.createApi, rpc: evmRpc().rpc })(account, new AbortController().signal);
  assert.equal(result.network.transactionVersion, '1');
  mock.at.runtimeVersion.specVersion = 'different';
  await assert.rejects(createInspector(net, iface, { createApi: mock.createApi })(account, new AbortController().signal), { code: 'unsupported-api' });
});
test('real pinned SDK initializes through read firewall with official generic metadata (not Portaldot evidence)', async () => {
  const { default: metadata } = await import('../node_modules/@polkadot/types-support/metadata/v15/substrate-hex.js');
  const { default: version } = await import('../node_modules/@polkadot/types-support/metadata/v15/substrate-ver.js');
  const { TypeRegistry } = await import('../node_modules/@polkadot/types/create/index.js');
  // The v15 SDK fixture is already encoded as Option<OpaqueMetadata>.
  const rawMetadata = new TypeRegistry().createType('Option<OpaqueMetadata>', metadata).unwrap().toHex();
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const { method, params } = JSON.parse(options.body); calls.push([method, params]);
    assert.ok(SUBSTRATE_READS.has(method), method);
    let result;
    if (method === 'rpc_methods') result = { methods: [...SUBSTRATE_READS] };
    else if (method === 'system_chain') result = 'Generic SDK fixture';
    else if (method === 'system_properties') result = { ss58Format: 42, tokenDecimals: 18, tokenSymbol: 'UNIT' };
    else if (method === 'chain_getBlockHash') result = GENESIS;
    else if (method === 'chain_getFinalizedHead') result = block.hash;
    else if (method === 'chain_getHeader') result = { parentHash: other, number: '0x10', stateRoot: other, extrinsicsRoot: other, digest: { logs: [] } };
    else if (method === 'state_getRuntimeVersion') result = { ...version, specName: 'portaldot-v3' };
    else if (method === 'state_getMetadata') result = rawMetadata;
    else if (method === 'state_call' && params[0] === 'Metadata_metadata_versions') result = '0x040f000000';
    else if (method === 'state_call' && params[0] === 'Metadata_metadata_at_version') result = metadata;
    else throw new Error('Unexpected mock SDK request ' + method);
    return { ok: true, json: async () => ({ id: 1, result }) };
  };
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    // Generic fixture has no required ReviveApi.address: distinguish metadata incompatibility from RPC failure.
    await assert.rejects(createInspector(net, iface)(account, abort.signal), { code: 'unsupported-api' });
    assert.ok(calls.some(([method, params]) => method === 'state_getRuntimeVersion' && params[0] === block.hash));
    assert.ok(calls.some(([method]) => method === 'chain_getFinalizedHead'));
  } finally { clearTimeout(timer); globalThis.fetch = original; }
});
test('ownership verifies actual stored owner, chain, deployed code and stable finalized snapshot', async () => {
  const signal = new AbortController().signal;
  const good = await readOwnership({ net, iface, h160, signal, rpc: evmRpc().rpc });
  assert.equal(good.accounts[0].owner.toLowerCase(), h160); assert.equal(good.accounts[0].balance, '1230000000000000000');
  assert.equal((await readOwnership({ net, iface, h160, signal, rpc: evmRpc({ empty: true }).rpc })).total, 0);
  for (const [options, code] of [[{ owner: contract }, 'ownership-conflict'], [{ chainId: '0x1' }, 'wrong-network'],
    [{ code: '0x' }, 'unverified'], [{ reorg: true }, 'unverified']]) {
    await assert.rejects(readOwnership({ net, iface, h160, signal, rpc: evmRpc(options).rpc }), { code });
  }
});
test('EVM read failures preserve confirmed mapping but never present empty ownership or budgets', async () => {
  const mock = apiMock();
  const snapshot = await createInspector(net, iface, { createApi: mock.createApi, rpc: evmRpc({ fail: true }).rpc })(account, new AbortController().signal);
  assert.equal(snapshot.status, 'rpc-unavailable'); assert.equal(snapshot.mapping, 'confirmed'); assert.equal(snapshot.ownership, undefined);
});
test('positive RPC boundary rejects all submission/signing/mapping methods before fetch', async () => {
  let reads = 0;
  const fetcher = async () => { reads++; return { ok: true, json: async () => ({ id: 1, result: 'ok' }) }; };
  for (const allow of [SUBSTRATE_READS, EVM_READS]) {
    for (const method of ['author_submitExtrinsic', 'author_submitAndWatchExtrinsic', 'eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'revive_mapAccount']) {
      await assert.rejects(readRpc('unused', method, [], undefined, allow, fetcher), { code: 'unsupported' });
    }
  }
  assert.equal(reads, 0);
  assert.equal(await readRpc('unused', 'eth_call', [], undefined, EVM_READS, fetcher), 'ok');
  assert.equal(reads, 1);
  await assert.rejects(readRpc('unused', 'eth_call', [], undefined, EVM_READS, async () => ({ ok: true, json: async () => ({ id: 1, error: 'failed' }) })));
});
