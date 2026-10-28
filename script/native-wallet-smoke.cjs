// Deterministic native UI + real production-bundle failure checks. No signing or public-chain writes.
// npm ci --prefix substrate; npm ci --prefix web/sim; python3 build.py; serve docs/.
// NODE_PATH=/path/to/playwright/node_modules node script/native-wallet-smoke.cjs
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('../web/sim/node_modules/esbuild');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const evidence = process.env.UI_EVIDENCE_DIR;
const root = path.resolve(__dirname, '..');
const id = '0x' + '11'.repeat(32), other = '0x' + '22'.repeat(32);
const h160 = '0x' + '33'.repeat(20);

// Bundle the actual controller, normalization and DOM component with a clearly labeled mock backend.
// This fixture is served only by Playwright route interception, never shipped to docs/.
const fixture = esbuild.buildSync({ stdin: { resolveDir: path.join(root, 'substrate/browser'), contents: `
  import { NativeController, NativeError, GENESIS, walletSources } from './controller.mjs';
  import { normalizeAccount } from './runtime.mjs';
  import { mountPanel } from './panel.mjs';
  window.AllowanceNative = { mount(root, net) {
    root.querySelector('#nativeTitle').textContent = 'Native account · MOCKED RUNTIME';
    root.querySelector('#nativeDescription').textContent = 'DETERMINISTIC TEST FIXTURE. No live-chain evidence. Actual account controller and panel, mocked runtime reads.';
    const injected = () => window.injectedWeb3 || {};
    const controller = new NativeController({ injected, normalize: normalizeAccount,
      inspect: async (account, signal) => {
        await new Promise(resolve => setTimeout(resolve, window.__nativeDelay || 20));
        const mode = window.__nativeFixture || 'verified';
        if (['wrong-network','unsupported-api','rpc-unavailable','ownership-conflict'].includes(mode)) throw new NativeError(mode, 'MOCKED ' + mode + ': identity or ownership unavailable.');
        const owned = { code: 'present', contract: net.allowance, block: '0x10', total: 1,
          accounts: [{ id: '7', owner: '${h160}', name: '<img src=x onerror="window.unsafe=true">',
            asset: '0x'+'00'.repeat(20), balance: '1230000000000000000', frozen: false, expiresAt: '0' }] };
        return { status: mode, message: 'MOCKED ' + mode + ' · read-only fixture. No live-chain verification.',
          h160: '${h160}', mapping: mode === 'verified' ? 'confirmed' : mode,
          network: { genesis: GENESIS, specName: 'portaldot-v3', specVersion: '3002', transactionVersion: '1', block: '0x'+'ab'.repeat(32) },
          capabilities: { address: true, reverse: true, dryRun: true, mapAccount: true, call: true },
          deployment: owned, ownership: mode === 'verified' ? owned : undefined };
      } });
    return mountPanel(root, controller, () => walletSources(injected()));
  } };
` }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false }).outputFiles[0].text;

function inject(spec) {
  window.nativePermissions = 0; window.nativeStops = 0; window.nativeSigns = 0;
  window.__nativeFixture = spec.mode; window.__nativeDelay = spec.delay;
  const accounts = { get: async () => spec.accounts, subscribe(cb) {
    window.updateNativeAccounts = cb; return () => { window.nativeStops++; };
  } };
  if (spec.unsupported) delete accounts.subscribe;
  const authorized = { accounts };
  for (const name of ['signer', 'provider']) Object.defineProperty(authorized, name, { get() { window.nativeSigns++; throw new Error('Forbidden signing/provider access'); } });
  window.injectedWeb3 = { 'Fixture extension': { async enable() {
    window.nativePermissions++; if (spec.reject) throw new Error('Rejected'); return authorized;
  } } };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [], writes = [];
  async function open(spec, mocked = true) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) {
        const body = request.postData() || '';
        if (/submitExtrinsic|submitAndWatch|sendTransaction|sendRawTransaction|personal_sign|signPayload|mapAccount/.test(body)) writes.push(body);
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"deliberately unavailable in browser test"}' });
      }
      if (mocked && url.pathname.endsWith('/native-wallet.js')) return route.fulfill({ contentType: 'application/javascript', body: fixture });
      return route.continue();
    });
    if (spec) await page.addInitScript(inject, spec);
    await page.goto(base);
    assert.equal(await page.locator('script[src="native-wallet.js"]').count(), 0, 'SDK not loaded on page load');
    assert.equal(await page.evaluate(() => window.nativePermissions || 0), 0, 'no automatic authorization');
    await page.click('#nativeBtn');
    await page.waitForFunction(() => window.AllowanceNative && document.querySelector('#nativeWalletDlg').dataset.state);
    return { context, page };
  }
  async function capture(page, name) {
    if (!evidence) return;
    fs.mkdirSync(evidence, { recursive: true });
    await page.locator('#nativeWalletDlg').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(evidence, name + '.png') });
  }
  try {
    let { context, page } = await open(null, false);
    assert.equal(await page.locator('#nativeConnect').isDisabled(), true);
    assert.match(await page.locator('#nativeStatus').innerText(), /No supported native extension/);
    assert.equal(await page.locator('#deployBox').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nativeWalletDlg').evaluate(el => el.open), false);
    assert.equal(await page.locator('#nativeBtn').evaluate(el => el === document.activeElement), true, 'focus restored');
    await context.close();
    console.log('PASS production lazy bundle: absent extension, no auto permission, Escape/focus restoration');

    for (const [spec, state] of [[{ reject: true }, 'authorization-failed'], [{ unsupported: true }, 'unsupported']]) {
      ({ context, page } = await open({ accounts: [{ address: id }], ...spec }, false));
      await page.click('#nativeConnect');
      await page.waitForFunction(state => document.querySelector('#nativeWalletDlg').dataset.state === state, state);
      assert.equal(await page.evaluate(() => nativeSigns), 0); await context.close();
    }
    console.log('PASS production bundle: rejected permission and unsupported extension');

    ({ context, page } = await open({ accounts: [{ address: id }] }, false));
    await page.click('#nativeConnect');
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'rpc-unavailable');
    assert.match(await page.locator('#nativeMapping').innerText(), /Unverified/);
    assert.match(await page.locator('#nativeOwnership').innerText(), /unavailable/);
    assert.equal(await page.locator('#deployBox').isVisible(), false);
    assert.equal(await page.evaluate(() => nativeSigns), 0);
    assert.equal(await page.evaluate(() => S.me), null);
    await context.close();
    console.log('PASS production bundle: mocked RPC 503 stays unverified, no EVM deployment fallback or state mutation');

    ({ context, page } = await open({ accounts: [{ address: id, name: 'Public fixture Alpha' }, { address: other, name: 'Public fixture Beta' }] }));
    await page.click('#nativeConnect');
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'choose-account');
    assert.equal(await page.locator('#nativeAccount').inputValue(), '');
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified');
    await page.selectOption('#nativeAccount', id);
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'verified');
    assert.equal(await page.locator('#nativeH160').innerText(), h160);
    assert.match(await page.locator('#nativeAllowances').innerText(), /1.23 POT/);
    assert.equal(await page.locator('#nativeAllowances img').count(), 0, 'untrusted names rendered as text');
    assert.equal(await page.evaluate(() => !!window.unsafe), false);
    assert.equal(await page.evaluate(() => S.me), null);
    assert.equal(await page.evaluate(() => nativeSigns), 0);
    const buttons = await page.locator('#nativeWalletDlg button').allTextContents();
    assert.deepEqual(buttons, ['Close', 'Connect native accounts', 'Refresh reads', 'Disconnect']);
    const a11y = await new AxeBuilder({ page }).include('#nativeWalletDlg').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(a11y.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(',')}`), [], 'native panel accessibility');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page fits ' + width);
      assert.equal(await page.locator('#nativeWalletDlg').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'panel fits ' + width);
      if (width === 320) {
        const mobileA11y = await new AxeBuilder({ page }).include('#nativeWalletDlg').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(mobileA11y.violations.map(v => v.id), [], 'mobile native panel accessibility');
      }
      await capture(page, 'native-mocked-verified-' + width);
    }
    await page.evaluate(([id, other]) => updateNativeAccounts([{ address: other }, { address: id }]), [id, other]);
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified');
    assert.equal(await page.locator('#nativeAllowances li').count(), 0);
    await page.selectOption('#nativeAccount', other);
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'verified');
    await page.click('#nativeDisconnect');
    assert.equal(await page.locator('#nativeAccount').isDisabled(), true);
    assert.equal(await page.evaluate(() => nativeStops), 1);
    await context.close();
    console.log('PASS mocked positive UI: selection/switch/disconnect, SS58 bytes, safe names, 1440/768/390/320, axe WCAG A/AA');

    for (const state of ['unmapped', 'conflicting', 'wrong-network', 'unsupported-api', 'rpc-unavailable', 'ownership-conflict']) {
      ({ context, page } = await open({ accounts: [{ address: id }], mode: state }));
      await page.click('#nativeConnect');
      await page.waitForFunction(state => document.querySelector('#nativeWalletDlg').dataset.state === state, state);
      assert.equal(await page.locator('#nativeAllowances li').count(), 0);
      assert.match(await page.locator('#nativeOwnership').innerText(), /unavailable/);
      assert.equal(await page.locator('#deployBox').isVisible(), false);
      assert.equal(await page.evaluate(() => nativeSigns), 0);
      await context.close();
    }
    console.log('PASS mocked UI failure states: unmapped/conflicting/wrong network/missing API/RPC failure/owner mismatch');

    ({ context, page } = await open({ accounts: [{ address: id }], delay: 500 }));
    await page.click('#nativeConnect'); await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'checking');
    await page.click('#nativeClose');
    await page.waitForTimeout(550);
    await page.click('#nativeBtn');
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified');
    await page.click('#nativeClose');
    await page.click('#simBtn');
    await page.waitForFunction(() => document.querySelector('#controlField')?.getAttribute('aria-busy') === 'false');
    const before = await page.evaluate(() => ({ me: S.me, selected: String(S.sel), chain: S.chainId, simulated: S.sim }));
    await page.click('#nativeBtn'); await page.click('#nativeConnect');
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'verified');
    assert.deepEqual(await page.evaluate(() => ({ me: S.me, selected: String(S.sel), chain: S.chainId, simulated: S.sim })), before, 'simulation identity unchanged');
    await page.click('#nativeClose');
    assert.equal(await page.locator('#nativeWalletDlg').getAttribute('data-state'), 'disconnected');
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified');
    await context.close();
    console.log('PASS stale response after close discarded; simulation identity retained and native state cleared');

    ({ context, page } = await open({ accounts: [{ address: id }] }));
    await page.click('#nativeClose');
    await page.evaluate(() => {
      window.evmRequests = [];
      window.ethereum = { on() {}, async request({ method }) {
        evmRequests.push(method);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x5555555555555555555555555555555555555555'];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'eth_getCode') return '0x';
        throw new Error('Unexpected EVM request ' + method);
      } };
    });
    await page.click('#connectBtn'); await page.waitForSelector('#deployBox:not(.hidden)');
    await page.evaluate(() => { window.expectedEvm = { signer: S.signer, provider: S.provider, me: S.me }; });
    await page.click('#nativeBtn'); await page.click('#nativeConnect');
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'verified');
    assert.equal(await page.evaluate(() => S.me === expectedEvm.me && S.signer === expectedEvm.signer && S.provider === expectedEvm.provider), true);
    await page.locator('#nativeSource').dispatchEvent('change');
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified', 'changing extension clears identity');
    await page.click('#nativeConnect');
    await page.waitForFunction(() => document.querySelector('#nativeWalletDlg').dataset.state === 'verified');
    await page.evaluate(() => document.querySelector('#connectBtn').click());
    assert.equal(await page.locator('#nativeWalletDlg').evaluate(el => el.open), false);
    assert.equal(await page.locator('#nativeH160').innerText(), 'Unverified');
    assert.equal(await page.evaluate(() => evmRequests.some(method => /send|sign/i.test(method))), false);
    await context.close();
    console.log('PASS MetaMask-style signer/provider/account retained; EVM mode entry clears native results without EVM submission');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.deepEqual(writes, [], 'no native signing or public-chain submission requests');
    console.log('PASS no signing/provider access, native/public-chain write requests, or uncaught errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
