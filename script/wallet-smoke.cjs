// Wallet paths a visitor can hit: no wallet (desktop and phone), several wallets (EIP-6963),
// a wallet on another network (switch / add Portaldot V3 Testnet), reconnect after a reload,
// and the "can spend now" figure when the budget is smaller than the period allowance.
// Test wallets are injected; no transaction is signed or sent.
// NODE_PATH=/path/to/playwright/node_modules node script/wallet-smoke.cjs   (serve docs/ first)
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';

// A minimal EIP-1193 wallet. chainId is the hex the wallet starts on; switching to an unknown chain
// fails with 4902 until it has been added, like real wallets. Calls are recorded in window.calls.
function fakeWallets(specs) {
  window.calls = [];
  const make = (spec) => {
    let chain = spec.chainId; const added = new Set([spec.chainId, ...(spec.known || [])]); const listeners = {};
    return {
      on(ev, fn) { (listeners[ev] ||= []).push(fn); },
      async request({ method, params }) {
        window.calls.push(spec.name + ':' + method);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return spec.accounts ?? ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return chain;
        if (method === 'net_version') return String(parseInt(chain, 16));
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'wallet_switchEthereumChain') {
          if (!added.has(params[0].chainId)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
          chain = params[0].chainId; window.switched = chain; return null;
        }
        if (method === 'wallet_addEthereumChain') { window.addedChain = params[0]; added.add(params[0].chainId); chain = params[0].chainId; return null; }
        throw new Error('unexpected ' + method);
      },
    };
  };
  const list = specs.map((s) => ({ info: { uuid: s.name, name: s.name, rdns: 'test.' + s.name.toLowerCase(), icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider: make(s) }));
  window.addEventListener('eip6963:requestProvider', () => {
    for (const d of list) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(d) }));
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [];
  const open = async (ctxOpts, specs, storage) => {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    if (storage) await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, storage);
    if (specs) await page.addInitScript(fakeWallets, specs);
    await page.goto(base);
    return { ctx, page };
  };
  try {
    // 1. Desktop, no wallet: help dialog with install link, phone QR and the demo.
    let { ctx, page } = await open({ viewport: { width: 1280, height: 900 } });
    await page.click('#connectBtn2');
    await page.waitForSelector('#walletDlg[open]');
    assert.equal(await page.locator('#walletNone').isVisible(), true);
    assert.equal(await page.locator('#walletNone .wallet-qr svg').count(), 1);
    assert.equal(await page.locator('#walletMobile').isVisible(), false);
    await page.click('#walletClose');
    await page.click('#phoneBtn');
    await page.waitForSelector('#walletDlg[open] #walletPhoneText:not(.hidden)');
    assert.equal(await page.locator('#walletNoneText').isVisible(), false);
    await page.click('#walletDemo');
    await page.waitForFunction(() => document.querySelector('#controlField')?.getAttribute('aria-busy') === 'false');
    console.log('PASS desktop without a wallet: install link, QR to open on a phone, demo from the dialog');
    await ctx.close();

    // 2. Phone browser, no wallet: open in a wallet app, with each wallet's documented link.
    ({ ctx, page } = await open({ ...devices['iPhone 13'] }));
    assert.equal(await page.locator('#phoneBtn').isVisible(), false);
    await page.click('#connectBtn2');
    await page.waitForSelector('#walletDlg[open] #walletMobile:not(.hidden)');
    const links = await page.$$eval('#walletApps a', (as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
    const url = base + '/';
    const enc = encodeURIComponent(url);
    assert.deepEqual(links, [
      ['MetaMask', 'https://link.metamask.io/dapp/' + url.replace(/^https?:\/\//, '')],
      ['Trust Wallet', 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc],
      ['Coinbase Wallet', 'https://go.cb-w.com/dapp?cb_url=' + enc],
      ['OKX Wallet', 'okx://wallet/dapp/url?dappUrl=' + enc],
    ]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dialog fits the phone');
    console.log('PASS phone without a wallet: MetaMask, Trust, Coinbase, OKX links and copy-link');
    await ctx.close();

    // 3. Two wallets installed: the visitor picks one, and only that one is asked.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, [{ name: 'Alpha', chainId: '0x7a69' }, { name: 'Beta', chainId: '0x7a69' }]));
    await page.click('#connectBtn2');
    await page.waitForSelector('#walletDlg[open] #walletPick:not(.hidden)');
    assert.deepEqual(await page.$$eval('#walletPick button', (bs) => bs.map((b) => b.textContent)), ['Alpha', 'Beta']);
    await page.click('#walletPick button:nth-child(2)');
    await page.waitForSelector('#deployBox:not(.hidden)');
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.some((c) => c.startsWith('Alpha:')), false, 'the other wallet is not asked');
    assert.equal(calls.includes('Beta:eth_requestAccounts'), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('allowance:wallet')), 'test.beta');
    console.log('PASS several wallets (EIP-6963): picker, only the chosen wallet is asked, choice remembered');
    await ctx.close();

    // 4. Reload with a remembered wallet: reconnects to that wallet without a popup.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, [{ name: 'Alpha', chainId: '0x7a69' }, { name: 'Beta', chainId: '0x7a69' }], { 'allowance:connected': '1', 'allowance:wallet': 'test.beta' }));
    await page.waitForSelector('#deployBox:not(.hidden)');
    const re = await page.evaluate(() => window.calls);
    assert.equal(re.includes('Beta:eth_accounts'), true);
    assert.equal(re.some((c) => c.startsWith('Alpha:')), false);
    assert.equal(await page.locator('#walletDlg[open]').count(), 0);
    console.log('PASS reload reconnects the remembered wallet, no dialog');
    await ctx.close();

    // 5. Wallet on another network (Ethereum mainnet), Portaldot not added yet: switch fails with 4902,
    //    the page adds Portaldot V3 Testnet, and shows the switch box meanwhile.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, [{ name: 'Alpha', chainId: '0x1' }]));
    await page.click('#connectBtn2');
    await page.waitForFunction(() => window.addedChain);
    const added = await page.evaluate(() => window.addedChain);
    assert.deepEqual(added, { chainId: '0x190f1ca9', chainName: 'Portaldot V3 Testnet', nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 18 }, rpcUrls: ['https://test-evm-rpc-v3.portaldot.dev'] });
    assert.equal(await page.locator('#netBox').isVisible(), true);
    assert.equal(await page.locator('#deployBox').isVisible(), false, 'no deploy offer on a wrong network');
    assert.equal(await page.locator('#intro').isVisible(), false);
    console.log('PASS wrong network: Portaldot V3 Testnet added with chain 0x190f1ca9, POT, official RPC; no deploy offer');
    await ctx.close();

    // 6. Network already in the wallet: a plain switch, no add.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, [{ name: 'Alpha', chainId: '0x1', known: ['0x190f1ca9'] }]));
    await page.click('#connectBtn2');
    await page.waitForFunction(() => window.switched === '0x190f1ca9');
    assert.equal(await page.evaluate(() => window.calls.includes('Alpha:wallet_addEthereumChain')), false);
    console.log('PASS network already in the wallet: plain switch, nothing added');
    await ctx.close();

    // 7. Budget smaller than what the period still allows: the headline shows what can really be spent.
    ({ ctx, page } = await open({ viewport: { width: 1280, height: 1000 } }));
    await page.click('#simBtn');
    await page.waitForFunction(() => document.querySelector('#controlField')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#fieldLeft').innerText(), '4 POT');
    await page.evaluate(async () => { await (await S.al.withdraw(S.sel, ethers.parseEther('17'), S.me)).wait(); await refresh(); });
    await page.waitForFunction(() => document.querySelector('#fBalance').textContent === '2 POT' && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#fieldLeft').innerText(), '2 POT');
    assert.equal(await page.locator('#dLeft').innerText().then((t) => t.replace(/\s/g, '')), '2POT');
    assert.match(await page.locator('#dLeftCap').innerText(), /This period's limit still has 4 POT, but the budget holds only 2 POT/);
    console.log('PASS low budget: "can spend now" = min(period allowance, budget) = 2 POT, with the reason');
    await ctx.close();

    assert.deepEqual(errors, [], 'uncaught browser errors');
    console.log('PASS no uncaught errors');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
