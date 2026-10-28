// Fresh-session check-in rehearsal. No mocked assets, wallets, receipts or application state.
// NODE_PATH=/path/to/playwright/node_modules node script/checkin-smoke.cjs
// UI_EVIDENCE_DIR writes screenshots; UI_BASE_URL and CHROMIUM_PATH are optional.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const evidence = process.env.UI_EVIDENCE_DIR;
async function capture(page, name, selector) {
  if (!evidence) return;
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
  if (await page.locator('#app:not(.hidden)').count()) {
    assert.equal(await page.locator('details.assistant').isVisible(), false, 'MCP configuration must stay hidden in evidence');
    assert.equal(await page.locator('#simBar').isVisible(), true);
  }
  fs.mkdirSync(evidence, { recursive: true });
  const options = { path: path.join(evidence, name + '.png') };
  if (selector) await page.locator(selector).screenshot(options);
  else { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot(options); }
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(), problems = [], external = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); });
    page.on('requestfailed', req => problems.push(req.url() + ': ' + req.failure()?.errorText));
    page.on('response', res => { if (res.status() >= 400) problems.push(res.status() + ' ' + res.url()); });
    page.on('request', req => { if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== new URL(base).origin) external.push(req.url()); });
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'must start with empty browser storage');
    assert.equal(await page.evaluate(() => typeof window.ethereum), 'undefined', 'no wallet extension');
    assert.equal(await page.evaluate(() => ethers.version), '6.13.4');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    assert.notEqual(await page.locator('.skip-link').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.locator('h1').click();
    await capture(page, 'landing');
    for (const state of ['allowed', 'pending', 'blocked']) {
      await page.locator(`[data-scenario=${state}]`).focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator(`[data-scenario=${state}]`).getAttribute('aria-pressed'), 'true');
      await capture(page, 'policy-' + state, '#landingField');
    }
    await page.locator('[data-scenario=allowed]').click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 1500 : 1200 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'landing overflow ' + width);
      if (width === 390) await capture(page, 'mobile-landing');
    }
    await page.click('#simBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('Will be paid instantly'));
    assert.equal(await page.locator('#fieldBalance').innerText(), '19 POT');
    assert.equal(await page.locator('#fieldCap').innerText(), '1 POT');
    assert.equal(await page.locator('#fieldLeft').innerText(), '4 POT');
    assert.equal(await page.locator('#fieldLimit').innerText(), '5 POT / 24 hours');
    assert.match(await page.locator('#fieldPending').textContent(), /2 waiting for your approval/);
    assert.equal(await page.locator('#inbox .req').count(), 2);
    assert.match(await page.locator('#netName').innerText(), /Simulation/);
    await capture(page, 'dashboard');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 1700 : 1200 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dashboard overflow ' + width);
      if (width === 390) await capture(page, 'mobile-dashboard');
    }
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => !paymentInFlight && document.querySelector('#decisionTitle').textContent === 'Paid autonomously');
    assert.equal(await page.locator('#fieldLeft').innerText(), '3.9 POT');
    assert.equal(await page.locator('#fieldBalance').innerText(), '18.9 POT');
    assert.match(await page.locator('#decisionMode').innerText(), /SIMULATION.*CONFIRMED RECEIPT/);
    await capture(page, 'autonomous-payment', '#agentBox');
    await page.locator('#payForm [name=amount]').fill('2.5');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('approval'));
    assert.equal(await page.locator('#inbox .req').count(), 2, 'preview cannot record request');
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => !paymentInFlight && document.querySelector('#decisionTitle').textContent === 'Awaiting owner approval');
    assert.equal(await page.locator('#fieldBalance').innerText(), '18.9 POT');
    assert.equal(await page.locator('#fieldLeft').innerText(), '3.9 POT');
    assert.equal(await page.locator('#inbox .req').count(), 3);
    await capture(page, 'pending-request', '#agentBox');
    const requestId = await page.evaluate(() => paymentResult.requestId);
    await page.locator(`#inbox [data-request-id="${requestId}"] [data-a=approve]`).click();
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Paid after owner approval' && document.querySelector('#fieldBalance').textContent === '16.4 POT' && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#fieldLeft').innerText(), '3.9 POT', 'owner authorization does not consume autonomous allowance');
    assert.equal(await page.locator('#inbox .req').count(), 2);
    await capture(page, 'owner-approval', '#agentBox');
    await page.locator('#payForm [name=amount]').fill('0.1');
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').dataset.state === 'blocked' && document.querySelector('#verdict').textContent.includes('frozen'));
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), true);
    assert.match(await page.locator('#accountStatus').innerText(), /Frozen/);
    const blocked = await page.evaluate(async () => {
      const before = await S.provider.getBlockNumber();
      try { await S.al.connect(agentWallet).pay.staticCall(S.sel, S.me, ethers.parseEther('0.1'), 'Read-only frozen demo check'); return { blocked: false }; }
      catch (error) { return { blocked: friendly(error).includes('frozen'), noTransaction: before === await S.provider.getBlockNumber() }; }
    });
    assert.deepEqual(blocked, { blocked: true, noTransaction: true });
    assert.equal(await page.locator('#inbox .req').count(), 2);
    await capture(page, 'frozen-agent');
    await capture(page, 'frozen-payment', '#agentBox');
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').dataset.state === 'active' && document.querySelector('#verdict').textContent.includes('Will be paid instantly'));
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), false);
    assert.match(await page.locator('#accountStatus').innerText(), /Active/);
    // The shipped page must load using only same-origin assets.
    assert.deepEqual(external, [], 'unexpected third-party asset request');
    assert.deepEqual(problems, [], 'browser console, script or asset errors');
    console.log('PASS fresh browser: landing → policy explanation → simulation → rules/allowance → paid → held → approved → frozen/blocked → unfrozen');
    console.log('PASS real contract semantics, desktop/tablet/mobile, keyboard focus, no missing assets or console errors, no external asset requests');
    const fresh = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const again = await fresh.newPage();
    await fresh.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await again.goto(base); assert.equal(await again.evaluate(() => localStorage.length), 0);
    await again.click('#simBtn');
    await again.waitForFunction(() => document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    assert.equal(await again.locator('#fieldBalance').innerText(), '19 POT');
    assert.equal(await again.locator('#fieldLeft').innerText(), '4 POT');
    assert.equal(await again.locator('#inbox .req').count(), 2);
    assert.equal(await again.locator('#accountStatus').textContent(), 'Active · policy enforced');
    await fresh.close();
    console.log('PASS independent fresh mobile session: repeatable seed; external traffic blocked without replacing assets or results');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
