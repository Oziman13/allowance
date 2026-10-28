// Scoped Phase 4B UI regressions. Local real-bytecode simulation; never a public-chain write.
// NODE_PATH=/path/to/playwright/node_modules node script/jury-experience-smoke.cjs
// UI_BASE_URL defaults to localhost:8001; UI_EVIDENCE_DIR and UI_A11Y=1 are optional.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const evidence = process.env.UI_EVIDENCE_DIR;
const metrics = [], errors = [], external = [];
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#controlField')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#fieldSingle')?.textContent !== 'Unavailable');
}
async function amounts(page, budget, capacity, single) {
  await ready(page);
  assert.equal(await page.locator('#fieldBalance').innerText(), budget);
  assert.equal(await page.locator('#fieldLeft').innerText(), capacity);
  assert.equal(await page.locator('#fieldSingle').innerText(), single);
}
async function capture(page, name, selector) {
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  const target = selector ? page.locator(selector) : page.locator('body');
  await page.evaluate(() => {
    document.querySelector('#toast')?.classList.remove('show');
    if (document.activeElement?.classList.contains('skip-link')) document.activeElement.blur();
  });
  // Annotation exists only for evidence. No amount, identity or app result is replaced.
  await target.evaluate(el => {
    const note = document.createElement('div'); note.id = 'localEvidenceNote';
    note.textContent = 'LOCAL PREVIEW · SIMULATION / MOCKED WALLET · NO LIVE-SITE VERIFICATION';
    note.style.cssText = 'padding:10px;background:#e4deff;color:#171226;font:600 10px/1.7 monospace;overflow-wrap:anywhere;position:relative;z-index:10';
    el.prepend(note);
  });
  if (selector) await target.screenshot({ path: path.join(evidence, name + '.png') });
  else await page.screenshot({ path: path.join(evidence, name + '.png') });
  await page.locator('#localEvidenceNote').evaluate(el => el.remove());
}
async function audit(page, label) {
  if (process.env.UI_A11Y !== '1') return;
  const AxeBuilder = require('@axe-core/playwright').default;
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], label);
  console.log('PASS accessibility: ' + label);
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  async function open(width = 1440, cpu = 1) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== new URL(base).origin) {
        external.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    const session = await context.newCDPSession(page);
    await session.send('Network.enable'); await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.addInitScript(() => {
      window.juryLcp = null;
      new PerformanceObserver(list => { window.juryLcp = list.getEntries().at(-1)?.startTime; })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => typeof window.AllowanceNative), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.AllowanceSim), 'undefined');
    assert.equal(await page.locator('header #nativeBtn').count(), 0, 'native inspector is secondary');
    const navigation = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd,
        firstContentfulPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        lcpMs: window.juryLcp };
    });
    return { context, page, width, cpu, navigation };
  }
  async function simulate(opened) {
    const { page, width, cpu, navigation } = opened;
    await page.evaluate(() => { window.jurySimStart = performance.now(); });
    await page.click('#simBtn'); await ready(page);
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('Will be paid instantly'));
    metrics.push({ scope: 'LOCAL cold browser context, cache disabled; no network throttling; automation overhead included',
      viewport: width, cpuThrottle: cpu, ...navigation,
      simulationReadyMs: await page.evaluate(() => performance.now() - window.jurySimStart) });
    assert.equal(await page.evaluate(() => typeof window.AllowanceNative), 'undefined', 'proof/guide must not load native SDK');
    await amounts(page, '19 POT', '4 POT', '1 POT');
  }
  try {
    const opened = await open(); let { context, page } = opened;
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    await audit(page, 'landing desktop');
    await capture(page, 'local-landing-1440');
    await simulate(opened);
    await page.evaluate(() => {
      for (const result of [
        { state: 'pending', stage: 'preview', requestId: 0, receipt: { status: 1, logs: [] } },
        { state: 'pending', stage: 'submitted', requestId: 0, receipt: { status: 1, logs: [] } },
        { state: 'pending', stage: 'result', requestId: 0 },
      ]) observeDemoOutcome(result);
      const encoded = S.al.interface.encodeEventLog(S.al.interface.getEvent('PaymentHeld'), [0, 0, S.me, 1n, 1, 'MOCKED unrelated event']);
      observeDemoOutcome({ state: 'pending', stage: 'result', requestId: 0,
        receipt: { status: 1, logs: [{ ...encoded, address: ethers.ZeroAddress }] } });
    });
    assert.equal(await page.evaluate(() => demoJourney.requestId), null, 'preview, uncertain receipt and unrelated-contract events cannot choose a request');
    await page.waitForFunction(() => document.querySelector('#demoGuide').classList.contains('hidden') === false);
    assert.match(await page.locator('#fieldSpendingNote').innerText(), /not rolling or calendar/);
    assert.equal(await page.locator('#simProof').isVisible(), true, 'historical proof remains reachable');
    const beforeNavigation = await page.evaluate(() => S.al.requestCount());
    await page.locator('[data-demo-jump=payment]').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#agentBox').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => S.al.requestCount()), beforeNavigation, 'navigation creates no request');
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => !paymentInFlight && document.querySelector('#decisionTitle').textContent === 'Paid autonomously');
    await amounts(page, '18.9 POT', '3.9 POT', '1 POT');
    await page.locator('#payForm [name=amount]').fill('2.5');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('approval'));
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => !paymentInFlight && document.querySelector('#decisionTitle').textContent === 'Awaiting owner approval');
    await amounts(page, '18.9 POT', '3.9 POT', '1 POT');
    await page.waitForSelector('#reviewHeldRequest:not(.hidden)');
    const rid = await page.evaluate(() => paymentResult.requestId);
    assert.equal(rid, 2, 'new request differs from seeded #0 with the same 2.5 POT amount');
    await page.locator('#reviewHeldRequest').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(rid => document.activeElement?.id === 'request-' + rid, rid), true);
    await page.setViewportSize({ width: 320, height: 1000 });
    await capture(page, 'local-held-request-320', '#request-' + rid);
    await page.locator(`#request-${rid} [data-a=approve]`).click();
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Paid after owner approval');
    await amounts(page, '16.4 POT', '3.9 POT', '1 POT');
    assert.equal(await page.locator('#request-0').count(), 1, 'seeded request was not approved');
    assert.equal(await page.locator('#demoReviewRequest').isDisabled(), true);
    assert.match(await page.locator('#demoGuideStatus').innerText(), /Request #2 was paid by the owner/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'reflow ' + width);
      if (width === 390) { await audit(page, 'simulation mobile'); await capture(page, 'local-capacity-390', '#controlField'); }
    }
    await page.locator('[data-demo-jump=freeze]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#freezeBtn').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#controlField').dataset.state === 'blocked');
    await amounts(page, '16.4 POT', '0 POT', '0 POT');
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), true);
    assert.match(await page.locator('#freezeText').innerText(), /owner can still withdraw or approve/);
    await capture(page, 'local-frozen-capacity-1440', '#controlField');
    await audit(page, 'frozen simulation desktop');
    // Owner exception remains real: approve the old seed while the agent is frozen.
    await page.locator('#request-0 [data-a=approve]').click();
    await page.waitForFunction(() => document.querySelector('#fieldBalance').textContent === '13.9 POT');
    await amounts(page, '13.9 POT', '0 POT', '0 POT');
    await page.locator('[data-demo-jump=proof]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#simProof').evaluate(el => el.open), true);
    assert.equal(await page.locator('#simProofTitle').evaluate(el => el === document.activeElement), true);
    assert.match(await page.locator('#simProof').innerText(), /refusal produced no new transaction/);
    assert.match(await page.locator('#simProof a').first().getAttribute('href'), /PROOF.md#a-real-ai-assistant-on-chain-2026-10-23$/);
    await page.setViewportSize({ width: 768, height: 1100 });
    await capture(page, 'local-recorded-proof-768', '#simProof');
    // CSS layout zoom is explicit, not a claim of a physical-device/browser-chrome audit.
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth), true, '200% CSS layout zoom');
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    await context.close();
    console.log('PASS exact guided lifecycle, matching request/focus, frozen owner exception, proof labels, four widths and 200% layout zoom');

    const financial = await open(390); ({ context, page } = financial); await simulate(financial);
    await page.locator('summary', { hasText: 'Change the rules' }).click();
    await page.locator('#rulesForm [name=perPeriod]').fill('1'); await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#fieldLeft').textContent === '0 POT');
    await amounts(page, '19 POT', '0 POT', '0 POT');
    await page.locator('#rulesForm [name=perPeriod]').fill('5'); await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#fieldLeft').textContent === '4 POT');
    await page.locator('summary', { hasText: 'Add or withdraw budget' }).click();
    await page.locator('#fundForm [name=amount]').fill('18.8'); await page.locator('#fundForm [value=withdraw]').click();
    await page.waitForFunction(() => document.querySelector('#fieldBalance').textContent === '0.2 POT');
    await amounts(page, '0.2 POT', '0.2 POT', '0.2 POT');
    await page.locator('#rulesForm [name=expires]').selectOption('86400'); await page.locator('#rulesForm [type=submit]').click();
    await ready(page); await page.click('#skipDayBtn');
    await page.waitForFunction(() => document.querySelector('#accountStatus').textContent.includes('Expired'));
    await amounts(page, '0.2 POT', '0 POT', '0 POT');
    assert.match(await page.locator('#demoGuideStatus').innerText(), /Expired: new agent/);
    await page.locator('#rulesForm [name=expires]').selectOption('0'); await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#accountStatus').textContent.includes('Active'));
    await page.locator('#fundForm [name=amount]').fill('3'); await page.locator('#fundForm [value=fund]').click();
    await page.waitForFunction(() => document.querySelector('#fieldBalance').textContent === '3.2 POT');
    await page.locator('#request-0 [data-a=approve]').click();
    await page.waitForFunction(() => document.querySelector('#fieldBalance').textContent === '0.7 POT');
    await amounts(page, '0.7 POT', '0.7 POT', '0.7 POT');
    assert.equal(await page.evaluate(async () => (await S.al.getAccount(0))[1].toString()), '5000000000000000000', 'owner approval reduces budget-backed capacity, not period headroom');
    await page.click('#toStrangerBtn');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('approval'));
    assert.match(await page.locator('#controlField').innerText(), /eligible recipients/);
    for (const failure of ['clock', 'changed-head', 'account']) {
      await page.evaluate(async failure => {
        const original = S.provider.getBlock.bind(S.provider), request = S.eth.request; let reads = 0;
        if (failure === 'account') {
          const selector = S.al.interface.encodeFunctionData('getAccount', [0]).slice(0, 10);
          S.eth.request = args => {
            if (args.method === 'eth_call' && args.params[0].data.startsWith(selector)) throw new Error('MOCKED account read failure');
            return request(args);
          };
        }
        S.provider.getBlock = async (...args) => {
          if (failure === 'clock') throw new Error('MOCKED RPC unavailable');
          const block = await original(...args);
          return failure === 'changed-head' && ++reads === 2 ? { ...block, hash: '0x' + 'ff'.repeat(32) } : block;
        };
        await refresh(); S.provider.getBlock = original; S.eth.request = request;
      }, failure);
      assert.equal(await page.locator('#fieldLeft').innerText(), 'Unavailable');
      assert.equal(await page.locator('#fieldSingle').innerText(), 'Unavailable');
      assert.equal(await page.locator('#fieldBalance').innerText(), 'Unavailable');
      await page.evaluate(() => refresh()); await ready(page);
    }
    await context.close();
    console.log('PASS exhausted/budget-limited/expired/recipient-restricted states and clock/account/changed-head failures without false zeros');

    // Independent cold starts: actual local app, normal CPU and emulated slower mobile CPU.
    for (const [width, cpu] of [[1440, 1], [390, 4]]) {
      const cold = await open(width, cpu); await simulate(cold); await cold.context.close();
    }
    assert.deepEqual(external, [], 'wallet-free flow makes no public requests');
    assert.deepEqual(errors, [], 'uncaught browser errors');
    const report = { context: 'Local Chromium lab; no live Pages or real-device performance claim', samples: metrics };
    if (evidence) fs.writeFileSync(path.join(evidence, 'local-performance.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('METRICS ' + JSON.stringify(report));
    console.log('PASS no automatic transaction route, public RPC request, native SDK eager load or uncaught browser error');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
