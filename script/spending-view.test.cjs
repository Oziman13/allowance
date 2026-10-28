// node script/spending-view.test.cjs — node:test display checks, no chain or wallet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const view = vm.runInNewContext(readFileSync(require('node:path').join(__dirname, '../web/spending-view.js'), 'utf8') + '; SpendingView');
const unit = 10n ** 18n;
function entry(overrides = {}) {
  return { left: 4n * unit, a: { balance: 19n * unit, frozen: false,
    rules: { perPayment: unit, perPeriod: 5n * unit, expiresAt: 0n }, ...overrides } };
}
test('budget, total window capacity and one-payment ceiling are distinct', () => {
  const result = view.summarize(entry(), 100);
  assert.equal(result.budget, 19n * unit); assert.equal(result.capacity, 4n * unit); assert.equal(result.single, unit);
  assert.match(result.reason, /eligible recipients/);
});
test('freeze stops immediately spendable amounts while retaining policy headroom and budget', () => {
  const result = view.summarize(entry({ frozen: true }), 100);
  assert.equal(result.state, 'frozen'); assert.equal(result.capacity, 0n); assert.equal(result.single, 0n);
  assert.equal(result.headroom, 4n * unit); assert.equal(result.budget, 19n * unit);
  assert.match(result.reason, /Owner actions remain available/);
});
test('expiry uses the supplied chain timestamp, including the exact boundary', () => {
  const e = entry({ rules: { perPayment: unit, perPeriod: 5n * unit, expiresAt: 100n } });
  assert.equal(view.summarize(e, 99).single, unit);
  for (const now of [100, 101]) {
    const result = view.summarize(e, now);
    assert.equal(result.state, 'expired'); assert.equal(result.capacity, 0n); assert.equal(result.single, 0n);
  }
});
test('exhausted fixed-window headroom permits zero even with budget', () => {
  const e = entry(); e.left = 0n;
  const result = view.summarize(e, 100);
  assert.equal(result.capacity, 0n); assert.equal(result.single, 0n); assert.equal(result.budget, 19n * unit);
});
test('insufficient and empty budgets bound capacity independently of period headroom', () => {
  for (const balance of [unit / 5n, 0n]) {
    const result = view.summarize(entry({ balance }), 100);
    assert.equal(result.capacity, balance); assert.equal(result.single, balance);
  }
});
test('single payment is bounded by all three amounts', () => {
  const e = entry({ balance: unit / 2n }); e.left = unit / 4n;
  assert.equal(view.summarize(e, 100).single, unit / 4n);
  e.a.rules.perPayment = unit / 10n;
  assert.equal(view.summarize(e, 100).single, unit / 10n);
});
test('an owner budget debit can lower available capacity without consuming period headroom', () => {
  const e = entry({ balance: 5n * unit });
  const before = view.summarize(e, 100);
  e.a.balance -= 3n * unit;
  const after = view.summarize(e, 100);
  assert.equal(after.headroom, before.headroom); assert.equal(after.headroom, 4n * unit);
  assert.equal(before.capacity, 4n * unit); assert.equal(after.capacity, 2n * unit); assert.equal(after.single, unit);
});
test('zero per-payment cap pauses positive autonomous spending', () => {
  const e = entry(); e.a.rules.perPayment = 0n;
  assert.equal(view.summarize(e, 100).capacity, 0n); assert.equal(view.summarize(e, 100).single, 0n);
});
test('unknown chain time is unavailable, never a misleading zero or local-clock fallback', () => {
  for (const now of [null, undefined, NaN, -1, '100']) {
    const result = view.summarize(entry(), now);
    assert.equal(result.state, 'unavailable'); assert.equal(result.capacity, null); assert.equal(result.single, null);
  }
});
test('missing/malformed account reads remain unavailable', () => {
  for (const e of [null, {}, { a: {} }, { ...entry(), left: null }, { ...entry(), left: 6n * unit }]) {
    const result = view.summarize(e, 100);
    assert.equal(result.state, 'unavailable'); assert.equal(result.capacity, null); assert.equal(result.single, null);
  }
});
