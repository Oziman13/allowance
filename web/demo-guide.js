// Simulation-only navigation observes existing confirmed outcomes; never submits a call.
const demoJourney = { context: null, paid: false, requestId: null, approved: false };
function demoContext() {
  const context = paymentKey();
  if (demoJourney.context !== context) Object.assign(demoJourney, { context, paid: false, requestId: null, approved: false });
  return S.sim && S.sel === 0;
}
function observeDemoOutcome(result) {
  if (demoContext() && (result.stage || 'result') === 'result' && result.receipt?.status === 1) {
    // Navigation advances only on matching events from this simulation contract/account.
    // This observes receipts; it does not change the existing payment/result handlers.
    const events = [];
    for (const log of result.receipt.logs || []) {
      if (log.address?.toLowerCase() !== S.address?.toLowerCase()) continue;
      try { const event = S.al.interface.parseLog(log); if (Number(event?.args.accountId) === S.sel) events.push(event); } catch {}
    }
    const paid = events.some(event => event.name === 'Paid');
    if (result.state === 'allowed' && paid) demoJourney.paid = true;
    const held = events.some(event => event.name === 'PaymentHeld' && Number(event.args.requestId) === result.requestId);
    if (result.state === 'pending' && held && Number.isSafeInteger(result.requestId) && result.requestId >= 0) {
      if (demoJourney.requestId !== result.requestId) demoJourney.approved = false;
      demoJourney.requestId = result.requestId;
    }
    if (result.state === 'owner' && paid && result.requestId === demoJourney.requestId
        && events.some(event => event.name === 'RequestResolved' && Number(event.args.requestId) === result.requestId && Number(event.args.status) === 2)) demoJourney.approved = true;
  }
  updateDemoGuide();
}
function updateDemoGuide() {
  const selectedDemo = demoContext();
  $('#demoGuide').classList.toggle('hidden', !selectedDemo);
  $('#simProof').classList.toggle('hidden', !S.sim);
  const review = $('#reviewHeldRequest'); review.classList.add('hidden');
  if (!selectedDemo) return;
  const entry = S.accounts.find(x => x.id === S.sel);
  const frozen = spendingSnapshotAvailable && entry?.a.frozen;
  const spending = spendingFor(entry);
  const rid = demoJourney.requestId;
  const request = rid == null ? null : document.getElementById(`request-${rid}`);
  const canReview = spendingSnapshotAvailable && request && !demoJourney.approved;
  const button = $('#demoReviewRequest');
  button.disabled = !canReview;
  button.textContent = rid == null ? '3 · Review your new request' : demoJourney.approved ? `3 · Request #${rid} approved` : `3 · Review request #${rid}`;
  if (canReview && paymentResult?.state === 'pending' && paymentResult.requestId === rid) {
    review.href = `#request-${rid}`; review.textContent = `Review request #${rid} · this confirmed held request`;
    review.classList.remove('hidden');
  }
  for (const [name, done] of Object.entries({ paid: demoJourney.paid, held: rid != null,
    approved: demoJourney.approved, frozen: !!frozen && demoJourney.approved })) {
    const step = document.querySelector(`[data-demo-step="${name}"]`);
    step.classList.toggle('done', done);
    step.firstElementChild.setAttribute('aria-label', step.firstElementChild.textContent + (done ? ' · observed in this walkthrough' : ''));
  }
  const message = !spendingSnapshotAvailable ? 'Waiting for a verified account snapshot. Navigation does not submit a transaction.'
    : frozen ? 'Frozen: new agent payments, refuels and requests are blocked. Owner actions remain available. Compare this local flow with the recorded testnet proof.'
    : spending.state === 'expired' ? 'Expired: new agent payments, refuels and requests are blocked. Owner actions remain available. Leave simulation and restart to repeat the seeded example.'
    : spending.state === 'paused' ? 'The per-payment cap is zero, so positive autonomous payments/refuels cannot execute. Owner actions remain available; use the preview for a request.'
    : demoJourney.approved ? `Request #${rid} was paid by the owner. Approval debits the budget, not autonomous period headroom. Next, use Freeze agent.`
    : canReview ? `Request #${rid} is held, not paid. Review that exact request to approve it; other cards were seeded before your walkthrough.`
    : rid != null ? `Request #${rid} is not in the displayed pending list. Check its recorded outcome or wait for the refreshed list; no other request is selected.`
    : spending.capacity === 0n ? 'No autonomous capacity is currently available. Valid out-of-policy requests may be held and owner actions remain available. Restart the simulation to repeat the seeded example.'
    : demoJourney.paid ? 'Payment confirmed locally. Under the seeded 1 POT cap, 2.5 POT creates a held request. If you changed rules/budget, follow the current preview. Held requests reserve no funds.'
    : 'With the seeded policy, use the trusted recipient for 0.1 POT, then request 2.5 POT. Rule/budget changes alter outcomes. Links only navigate; you submit each action yourself.';
  if ($('#demoGuideStatus').textContent !== message) $('#demoGuideStatus').textContent = message;
}
function focusDemoTarget(target) {
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function reviewDemoRequest(event) {
  event.preventDefault();
  if (!demoContext() || !spendingSnapshotAvailable || demoJourney.requestId == null) return;
  const target = document.getElementById(`request-${demoJourney.requestId}`);
  if (target && target.dataset.requestId === String(demoJourney.requestId)) focusDemoTarget(target);
  else $('#demoGuideStatus').textContent = 'That request is no longer pending. No other request was selected. Check the last outcome.';
}
$('#demoReviewRequest').onclick = reviewDemoRequest;
$('#reviewHeldRequest').onclick = reviewDemoRequest;
for (const link of document.querySelectorAll('[data-demo-jump]')) link.addEventListener('click', event => {
  event.preventDefault();
  if (!S.sim) return;
  if (link.dataset.demoJump === 'proof') { $('#simProof').open = true; focusDemoTarget($('#simProofTitle')); }
  else if (demoContext() && link.dataset.demoJump === 'freeze') focusDemoTarget($('#freezeBtn'));
  else if (demoContext() && !$('#agentBox').classList.contains('hidden')) focusDemoTarget($('#agentBox'));
});
