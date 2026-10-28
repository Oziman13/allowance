// Phase 2 browser tests against real contract bytecode in the wallet-free EVM.
// NODE_PATH=/path/to/playwright/node_modules node script/policy-field-smoke.cjs
// Optional: UI_EVIDENCE_DIR writes the review screenshots; UI_BASE_URL/CHROMIUM_PATH.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8001';
const evidence = process.env.UI_EVIDENCE_DIR;
async function audit(page, label) {
  if (process.env.UI_A11Y !== '1') return;
  const { default: AxeBuilder } = require('@axe-core/playwright');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], label + ' accessibility');
  console.log('PASS axe WCAG A/AA: ' + label);
}
async function capture(page, name, selector) {
  if (!evidence) return;
  fs.mkdirSync(evidence, { recursive: true });
  await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#toast').classList.remove('show'); });
  // Simulation hides the MCP config; never include credentials in evidence.
  if (await page.locator('#app:not(.hidden)').count()) assert.equal(await page.locator('details.assistant').isVisible(), false);
  const options = { path: path.join(evidence, name + '.png') };
  if (selector) await page.locator(selector).screenshot(options);
  else await page.screenshot({ ...options, fullPage: true });
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { window.__policyDiagram = document.querySelector('#landingField svg'); });
    for (const state of ['pending', 'blocked', 'allowed']) {
      await page.locator(`[data-scenario=${state}]`).focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#landingField').getAttribute('data-state'), state);
      assert.equal(await page.locator(`[data-scenario=${state}]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__policyDiagram === document.querySelector('#landingField svg')), true);
      await audit(page, 'landing ' + state);
    }
    assert.match(await page.locator('#scenarioText').innerText(), /trusted recipient/);
    await capture(page, 'landing-policy-field');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `landing ${width}px`);
      if (width === 390) await capture(page, 'mobile-policy-field');
    }
    console.log('PASS landing selector: shared geometry, keyboard, example copy, responsive fallback');
    await page.click('#simBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('Will be paid instantly'));
    assert.equal(await page.locator('#fieldBalance').innerText(), '19 POT');
    assert.equal(await page.locator('#fieldCap').innerText(), '1 POT');
    assert.equal(await page.locator('#fieldLeft').innerText(), '4 POT');
    assert.match(await page.locator('#fieldPending').textContent(), /2 waiting for your approval/);
    assert.equal(await page.locator('#fieldRecipients li').count(), 2);
    assert.equal(await page.locator('#controlField').getAttribute('data-state'), 'active');
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-stage'), 'preview');
    assert.equal(await page.locator('#decisionProof').isVisible(), false);
    await capture(page, 'dashboard-agent-control-field');
    await audit(page, 'active control field and preview');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#fieldDetails summary').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `control field ${width}px`);
      if (width === 390) await audit(page, 'mobile expanded control field');
      await page.locator('#fieldDetails summary').click();
    }
    const recipient = await page.evaluate(() => [...document.querySelectorAll('#fieldRecipients li')].map(el => el.textContent).find(address => address.toLowerCase() !== S.me.toLowerCase()));
    await page.locator('summary', { hasText: 'Trusted recipients' }).click();
    await page.locator('#trustForm [name=addr]').fill(recipient);
    await page.locator('#trustForm [value=remove]').click();
    await page.waitForFunction(() => document.querySelectorAll('#fieldRecipients li').length === 1 && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    await page.locator('#trustForm [value=add]').click();
    await page.waitForFunction(() => document.querySelectorAll('#fieldRecipients li').length === 2 && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    await page.locator('summary', { hasText: 'Trusted recipients' }).click();
    console.log('PASS control field: verified balance/caps/allowance/trust/pending and narrow-screen details');
    // Delay a real receipt, without inventing a transaction/result, to inspect the submission state.
    await page.evaluate(() => {
      const request = S.eth.request;
      window.__releaseReceipt = null;
      const receiptGate = new Promise(resolve => { window.__releaseReceipt = resolve; });
      S.eth.request = async args => { if (args.method === 'eth_getTransactionReceipt') await receiptGate; return request(args); };
    });
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#paymentDecision').dataset.stage === 'submitted');
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-state'), 'neutral');
    assert.match(await page.locator('#decisionEndpoint').innerText(), /Not confirmed/);
    await page.evaluate(() => window.__releaseReceipt());
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Paid autonomously' && !paymentInFlight);
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-state'), 'allowed');
    assert.match(await page.locator('#decisionMode').innerText(), /SIMULATION.*CONFIRMED RECEIPT/);
    assert.equal(await page.locator('#fieldLeft').innerText(), '3.9 POT');
    assert.equal(await page.locator('#decisionTitle').evaluate(el => getComputedStyle(el).color), 'rgb(81, 217, 181)');
    await capture(page, 'payment-autonomous', '#agentBox');
    await audit(page, 'payment-autonomous');
    // Preview does not create a pending request; submitted receipt must contain PaymentHeld.
    await page.locator('#payForm [name=amount]').fill('2.5');
    await page.waitForFunction(() => document.querySelector('#paymentDecision').dataset.stage === 'preview' && document.querySelector('#verdict').textContent.includes('approval'));
    assert.equal(await page.locator('#inbox .req').count(), 2);
    assert.match(await page.locator('#verdict').innerText(), /creates no request/);
    const beforeBalance = await page.locator('#fieldBalance').innerText();
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Awaiting owner approval' && !paymentInFlight);
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-state'), 'pending');
    assert.equal(await page.locator('#inbox .req').count(), 3);
    assert.equal(await page.locator('#fieldBalance').innerText(), beforeBalance);
    assert.match(await page.locator('#decisionReason').innerText(), /No funds are reserved/);
    assert.equal(await page.locator('#decisionTitle').evaluate(el => getComputedStyle(el).color), 'rgb(244, 186, 101)');
    assert.equal(await page.locator('#decisionEndpoint').innerText(), 'Request recorded');
    await capture(page, 'payment-pending', '#agentBox');
    await audit(page, 'payment-pending');
    // Refresh now clears current amounts while the authoritative snapshot is loading.
    // Capture the request/capacity atomically; never compare an approval to "Reading…".
    const beforeApproval = await page.waitForFunction(() => {
      const left = document.querySelector('#fieldLeft').textContent;
      return document.querySelector('#controlField').getAttribute('aria-busy') === 'false' && /POT$/.test(left)
        ? { rid: paymentResult.requestId, leftBeforeApproval: left } : false;
    });
    const { rid, leftBeforeApproval } = await beforeApproval.jsonValue();
    await page.locator(`#inbox [data-request-id="${rid}"] [data-a=approve]`).click();
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Paid after owner approval');
    await page.waitForFunction(() => document.querySelector('#controlField').getAttribute('aria-busy') === 'false' && document.querySelectorAll('#inbox .req').length === 2);
    assert.equal(await page.locator('#fieldLeft').innerText(), leftBeforeApproval);
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-state'), 'owner');
    await page.waitForFunction(() => document.querySelectorAll('#feed li[data-outcome=owner]').length >= 1);
    assert.equal(await page.locator('#decisionTitle').evaluate(el => getComputedStyle(el).color), 'rgb(149, 133, 255)');
    await capture(page, 'payment-owner-approved', '#agentBox');
    await audit(page, 'payment-owner-approved');
    console.log('PASS payment lifecycle: preview/submission/receipt, autonomous, pending without reservation, distinct owner payment');
    // Freeze is a blocker, never an approval request.
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').dataset.state === 'blocked' && document.querySelector('#verdict').textContent.includes('frozen'));
    assert.equal(await page.locator('#payForm [type=submit]').isDisabled(), true);
    assert.equal(await page.locator('#inbox .req').count(), 2);
    await page.click('#freezeBtn');
    await page.waitForFunction(() => document.querySelector('#controlField').dataset.state === 'active' && !document.querySelector('#freezeBtn').disabled);
    // Chain-based expiry after actual simulation time travel.
    await page.locator('summary', { hasText: 'Change the rules' }).click();
    await page.locator('#rulesForm [name=expires]').selectOption('86400');
    await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#fieldExpiry').textContent.startsWith('Expires'));
    await page.click('#skipDayBtn');
    await page.waitForFunction(() => document.querySelector('#fieldExpiry').textContent.startsWith('Expired'));
    assert.equal(await page.locator('#controlField').getAttribute('data-state'), 'blocked');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('expired'));
    await page.locator('#rulesForm [name=expires]').selectOption('0');
    await page.locator('#rulesForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#fieldExpiry').textContent === 'No expiry configured');
    // Drain only the simulated contract via the existing owner control, then attempt an inside-cap payment.
    await page.locator('summary', { hasText: 'Add or withdraw budget' }).click();
    await page.locator('#fundForm [name=amount]').fill(parseFloat(await page.locator('#fieldBalance').innerText()).toString());
    await page.locator('#fundForm [value=withdraw]').click();
    await page.waitForFunction(() => document.querySelector('#fieldBalance').textContent === '0 POT');
    await page.locator('#payForm [name=amount]').fill('0.1');
    await page.waitForFunction(() => document.querySelector('#verdict').textContent.includes('budget'));
    await page.locator('#payForm [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#decisionTitle').textContent === 'Payment not executed' && !paymentInFlight);
    assert.match(await page.locator('#decisionReason').innerText(), /budget/);
    assert.equal(await page.locator('#inbox .req').count(), 2);
    assert.equal(await page.locator('#decisionTitle').evaluate(el => getComputedStyle(el).color), 'rgb(239, 113, 134)');
    await capture(page, 'payment-blocked', '#agentBox');
    await audit(page, 'payment-blocked');
    console.log('PASS frozen, chain expiry, and insufficient-balance failure; no false approval requests');
    // Unknown transport errors must not be presented as definitive policy failures.
    assert.equal(await page.evaluate(() => isKnownPaymentFailure({ code: 'NETWORK_ERROR' })), false);
    assert.equal(await page.evaluate(() => isKnownPaymentFailure({ code: 'CALL_EXCEPTION', data: '0x12345678' })), true);
    const unavailablePreview = await page.evaluate(async () => {
      const request = S.eth.request;
      try {
        S.eth.request = args => args.method === 'eth_call' ? Promise.reject(new Error('Test RPC unavailable')) : request(args);
        paymentResult = null; await previewPay();
        return { state: document.querySelector('#paymentDecision').dataset.state, title: document.querySelector('#decisionTitle').textContent };
      } finally { S.eth.request = request; }
    });
    assert.equal(unavailablePreview.state, 'neutral');
    assert.equal(unavailablePreview.title, 'Preview unavailable');
    assert.equal(await page.locator('.pf-journey li').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none');
    await page.click('#openBtn');
    await page.locator('#openForm [name=name]').fill('Operations agent');
    await page.click('#openSubmit');
    await page.waitForFunction(() => document.querySelector('#controlField [data-node=agent]').textContent === 'Agent #1' && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#fieldBalance').innerText(), '10 POT');
    assert.equal(await page.locator('#fieldLeft').innerText(), '5 POT');
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-stage'), 'preview');
    assert.match(await page.locator('#acctList [aria-current=true]').innerText(), /Operations agent/);
    await page.locator('#acctList button', { hasText: 'Research agent' }).click();
    await page.waitForFunction(() => document.querySelector('#controlField [data-node=agent]').textContent === 'Agent #0' && document.querySelector('#controlField').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#fieldBalance').innerText(), '0 POT');
    assert.equal(await page.locator('#paymentDecision').getAttribute('data-stage'), 'preview');
    assert.equal(await page.locator('#decisionProof').isVisible(), false);
    console.log('PASS selected-agent isolation: real account creation, policy values, no stale transaction outcome');
    assert.deepEqual(errors, [], 'uncaught browser errors');
    console.log('PASS unknown transport failure classification and zero uncaught browser errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
