// Actual browser comparison. Uses one unchanged simulation for both layouts in each pair.
// NODE_PATH=/path/to/playwright/node_modules node script/layout-comparison.cjs
// UI_BASE_URL (8001), UI_BASELINE_URL (8012), UI_EVIDENCE_DIR and CHROMIUM_PATH are optional.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const baseline = process.env.UI_BASELINE_URL;
const evidence = process.env.UI_EVIDENCE_DIR;
const sizes = [{ width: 1440, height: 900 }, { width: 1728, height: 1117 }];
async function variant(page, wide) {
  await page.evaluate(wide => {
    const url = new URL(location.href);
    if (wide) url.searchParams.set('layout', 'wide-preview'); else url.searchParams.delete('layout');
    history.pushState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, wide);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => scrollTo(0, 0));
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
}
async function geometry(page, selectors) {
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const el = document.querySelector(selector), r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, fontSize: css.fontSize, display: css.display, gridTemplateColumns: css.gridTemplateColumns }];
  })), selectors);
}
async function state(page) {
  return page.evaluate(async () => JSON.stringify({
    account: S.sel, chain: S.chainId, address: S.address, owner: S.me,
    accounts: S.accounts.map(({ id, a, left, pending }) => ({ id, agent: a.agent, balance: String(a.balance), left: String(left), pending, frozen: a.frozen })),
    feed: document.querySelector('#feed').textContent,
    storage: await Promise.all(Object.keys(localStorage).sort().map(async key => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(localStorage.getItem(key)));
      return [key, Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')];
    })),
  }));
}
async function capture(page, name) {
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  if (await page.locator('#app:not(.hidden)').count()) assert.equal(await page.locator('details.assistant').isVisible(), false);
  await page.screenshot({ path: path.join(evidence, name + '.png') });
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const metrics = [], problems = [];
  try {
    const ctx = await browser.newContext({ viewport: sizes[0], reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); });
    page.on('requestfailed', req => problems.push(req.failure()?.errorText));
    page.on('response', response => { if (response.status() >= 400) problems.push(response.status() + ' ' + response.url()); });
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('html').getAttribute('data-layout-preview'), null);
    const reference = baseline ? await ctx.newPage() : null;
    if (reference) { await reference.goto(baseline); await reference.evaluate(() => document.fonts.ready); }
    for (const size of sizes) {
      await page.setViewportSize(size); await variant(page, false);
      if (reference) {
        await reference.setViewportSize(size);
        assert.deepEqual(await page.screenshot(), await reference.screenshot(), `default landing must match main pixel-for-pixel at ${size.width}`);
      }
      const current = await geometry(page, ['main.wrap', '.hero-copy', '.pf-landing']);
      await capture(page, 'landing-current-' + size.width);
      const oldStorage = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
      await variant(page, true);
      assert.equal(await page.locator('html').getAttribute('data-layout-preview'), 'wide');
      const wide = await geometry(page, ['main.wrap', '.hero-copy', '.pf-landing']);
      assert.equal(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))), oldStorage, 'layout must not persist a setting');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture(page, 'landing-wide-' + size.width);
      metrics.push({ view: 'landing', viewport: size, current, wide });
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1000 }); await variant(page, false);
      const original = await page.screenshot();
      await variant(page, true);
      assert.deepEqual(await page.screenshot(), original, 'mobile/tablet landing must be identical at ' + width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    console.log(reference ? 'PASS default landing pixel-identical to main; preview isolated at 320/390/768px; query opt-in has no persistence' : 'PASS preview isolated at 320/390/768px; no persistence. Main reference comparison not run: set UI_BASELINE_URL.');
    await page.setViewportSize(sizes[0]); await variant(page, false);
    await page.click('#simBtn'); await ready(page);
    assert.equal(await page.locator('#fieldBalance').innerText(), '19 POT');
    assert.equal(await page.locator('#fieldLeft').innerText(), '4 POT');
    const unchanged = await state(page);
    if (reference) {
      await reference.setViewportSize(sizes[0]); await reference.click('#simBtn'); await ready(reference);
      assert.deepEqual(await geometry(page, ['#app', '.side', '#detail', '#controlField', '.meter-block', '.layout-inbox', '.layout-controls', '.layout-activity']),
        await geometry(reference, ['#app', '.side', '#detail', '#controlField', '.meter-block', '.section:has(#inbox)', '.controls', '.section:has(#feed)']).then(g => {
          g['.layout-inbox'] = g['.section:has(#inbox)']; delete g['.section:has(#inbox)'];
          g['.layout-controls'] = g['.controls']; delete g['.controls'];
          g['.layout-activity'] = g['.section:has(#feed)']; delete g['.section:has(#feed)']; return g;
        }), 'default dashboard geometry must match main');
    }
    for (const size of sizes) {
      await page.setViewportSize(size); await variant(page, false); await ready(page);
      const selectors = ['#app', '.side', '#detail', '#controlField', '.meter-block', '.layout-inbox', '.layout-controls', '.layout-activity'];
      const current = await geometry(page, selectors);
      const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      await capture(page, 'dashboard-current-' + size.width);
      const diagram = await page.locator('#controlField svg').innerHTML();
      await variant(page, true); await ready(page);
      assert.equal(await state(page), unchanged, 'comparison must preserve exact state, addresses, hashes and storage');
      assert.equal(await page.locator('#controlField svg').innerHTML(), diagram, 'original policy geometry must be unchanged');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const wide = await geometry(page, selectors);
      const wideHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      await capture(page, 'dashboard-wide-' + size.width);
      assert.ok(wideHeight < currentHeight, 'preview should reduce total page height');
      // Wide controls and forms remain available and can expand without clipping.
      for (const summary of await page.locator('#detail details:not(.assistant)>summary').all()) await summary.click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'expanded desktop forms must not overflow');
      for (const summary of await page.locator('#detail details:not(.assistant)>summary').all()) await summary.click();
      metrics.push({ view: 'dashboard', viewport: size, current, wide, currentHeight, wideHeight });
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1000 }); await variant(page, false); await ready(page);
      const original = await page.screenshot(); await variant(page, true);
      assert.deepEqual(await page.screenshot(), original, 'mobile/tablet dashboard must be identical at ' + width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    // Exercise existing functionality through an actual preview URL, not a substitute UI.
    await page.setViewportSize(sizes[0]); await variant(page, true);
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => !paymentInFlight && document.querySelector('#decisionTitle').textContent === 'Paid autonomously');
    assert.equal(await page.locator('#fieldLeft').innerText(), '3.9 POT');
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('frozen'));
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), true);
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('Will be paid instantly'));
    const optIn = await ctx.newPage(); await optIn.goto(base + '?layout=wide-preview');
    assert.equal(await optIn.locator('html').getAttribute('data-layout-preview'), 'wide');
    assert.deepEqual(problems, [], 'console, script or missing asset errors');
    if (evidence) fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(metrics, null, 2) + '\n');
    console.log('PASS same-state screenshot pairs; original diagram; mobile pixel equality; expanded forms; actual wide-preview payment/freeze/unfreeze');
    if (reference) console.log('PASS default dashboard geometry matches main');
    console.log(JSON.stringify(metrics.map(m => ({ view: m.view, viewport: m.viewport.width, currentHeight: m.currentHeight, wideHeight: m.wideHeight })), null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
