// Browser regression checks. Requires Playwright, Chromium and built docs served locally.
// NODE_PATH=/path/to/playwright/node_modules node script/ui-smoke.cjs
// UI_BASE_URL (default http://127.0.0.1:8001), CHROMIUM_PATH, UI_EVIDENCE_DIR are optional.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const evidence = process.env.UI_EVIDENCE_DIR;
async function capture(page, name) {
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  await page.evaluate(() => document.querySelector('#toast').classList.remove('show'));
  await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true });
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    await capture(page, 'after-landing');
    await page.click('#connectBtn2');
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('No wallet found'));
    await page.evaluate(() => { window.ethereum = { request: async () => { throw Object.assign(new Error('rejected'), { code: 4001 }); } }; });
    await page.click('#connectBtn2');
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('cancelled'));
    console.log('PASS wallet absent and wallet rejection states; keyboard skip link');
    await page.evaluate(() => { delete window.ethereum; });
    await page.click('#simBtn');
    await page.waitForFunction(() => document.querySelectorAll('#inbox .req').length === 2);
    await page.waitForFunction(() => document.querySelector('#feed').textContent.includes('Paid autonomously'));
    assert.equal(await page.locator('#ringPercent').innerText(), '20%');
    assert.equal(await page.locator('#fBalance').innerText(), '19 POT');
    assert.equal(await page.locator('#dLeft').innerText(), '4POT');
    assert.match(await page.locator('#activityContext').innerText(), /Simulation/);
    await capture(page, 'after-dashboard');
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `dashboard overflow at ${width}`);
      for (const summary of await page.locator('#detail details:not(.assistant)>summary').all()) await summary.click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `form overflow at ${width}`);
      for (const summary of await page.locator('#detail details:not(.assistant)>summary').all()) await summary.click();
      await capture(page, `after-dashboard-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator('#inbox .req').first().locator('[data-a="trust"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#inbox .req').length === 1);
    assert.equal(await page.locator('#ringPercent').innerText(), '20%', 'owner approval must not consume autonomous limit');
    await page.waitForFunction(() => document.querySelector('#feed').textContent.includes('Paid after owner approval'));
    await page.locator('#inbox [data-a="reject"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#inbox .req').length === 0);
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#dLeft').textContent === '3.9POT');
    await page.click('#toStrangerBtn');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('approval'));
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelectorAll('#inbox .req').length === 1);
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#freezeBtn').textContent === 'Unfreeze');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('frozen'));
    await capture(page, 'after-frozen');
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), true);
    assert.equal(await page.evaluate(async () => {
      try { await S.al.connect(agentWallet).pay.staticCall(S.sel, S.me, 1n, 'frozen read-only check'); return false; }
      catch (e) { return friendly(e).includes('frozen'); }
    }), true, 'frozen policy enforced by contract on read-only call');
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#freezeBtn').textContent === 'Freeze agent');
    await page.click('#skipDayBtn');
    await page.waitForFunction(() => document.querySelector('#ringPercent').textContent === '0%');
    console.log('PASS real EVM: approval, trust, rejection, paid/held, freeze blocking, unfreeze and daily reset');
    await page.locator('summary', { hasText: 'Change the rules' }).click();
    await page.locator('#rulesForm [name=perPayment]').fill('0.8');
    await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#fPerPay').textContent === '0.8 POT');
    await page.locator('summary', { hasText: 'Add or withdraw budget' }).click();
    const balance = parseFloat(await page.locator('#fBalance').innerText());
    await page.locator('#fundForm [name=amount]').fill('1');
    await page.locator('#fundForm [value=fund]').click();
    await page.waitForFunction(expected => parseFloat(document.querySelector('#fBalance').textContent) === expected, balance + 1);
    await page.locator('#fundForm [name=amount]').fill('0.5');
    await page.locator('#fundForm [value=withdraw]').click();
    await page.waitForFunction(expected => parseFloat(document.querySelector('#fBalance').textContent) === expected, balance + 0.5);
    console.log('PASS real EVM: rule update, budget funding and withdrawal');
    // Regression for untrusted ERC-20 metadata. Only the test changes the display metadata.
    const payload = '<img src=x onerror="window.__unsafe=true">';
    await page.evaluate(async sym => { S.accounts[0].m.sym = sym; renderList(); await renderDetail(S.sel); }, payload);
    assert.equal(await page.locator('#acctList .asset-symbol').innerText(), payload);
    assert.ok((await page.locator('#feed').innerText()).includes(payload));
    assert.equal(await page.locator('#app img').count(), 0);
    assert.equal(await page.evaluate(() => !!window.__unsafe), false);
    console.log('PASS hostile token metadata renders as text in account list, amount and activity');
    const mobile = await context.newPage();
    for (const width of [768, 390, 320]) {
      await mobile.setViewportSize({ width, height: 900 });
      await mobile.goto(base); await mobile.evaluate(() => document.fonts.ready);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `landing overflow at ${width}`);
      await capture(mobile, `after-landing-${width}`);
    }
    const walletPage = await context.newPage();
    await walletPage.addInitScript(() => {
      window.walletCalls = [];
      window.ethereum = {
        request: async ({ method }) => {
          window.walletCalls.push(method);
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'eth_getCode') return '0x';
          throw new Error('Unexpected wallet request: ' + method);
        },
        on() {},
      };
    });
    await walletPage.goto(base);
    await walletPage.click('#connectBtn');
    await walletPage.waitForSelector('#deployBox:not(.hidden)');
    assert.match(await walletPage.locator('#connectBtn').innerText(), /0x1111/);
    assert.equal(await walletPage.evaluate(() => walletCalls.some(m => /send|sign/i.test(m))), false);
    console.log('PASS injected wallet connect/no-contract UI; no signing or transaction request');
    assert.deepEqual(errors, [], 'uncaught browser errors');
    console.log('PASS desktop/tablet/mobile layouts (1440, 768, 390, 320), expanded forms and reduced motion');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
