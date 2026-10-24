// Shared Policy Field primitives. SVG is static; all contract-sourced text uses textContent.
function policyDiagram() {
  return `<svg class="pf-diagram" viewBox="0 0 560 330" focusable="false">
    <path class="pf-boundary" d="M95 40H265L330 105V230L265 295H95L30 230V105Z"/>
    <path class="pf-boundary-inset" d="M102 53H258L317 112V223L258 282H102L43 223V112Z"/>
    <text class="pf-diagram-label" x="180" y="77" text-anchor="middle">SPENDING POLICY</text>
    <path class="pf-path pf-path-allowed" d="M213 155H281L365 108H447"/>
    <path class="pf-path pf-path-pending" d="M213 174H275L330 228"/>
    <path class="pf-path pf-path-owner" d="M346 228H447"/>
    <path class="pf-path pf-path-blocked" d="M180 198V248"/>
    <g class="pf-agent-node"><rect x="147" y="132" width="66" height="66" rx="20"/><rect class="pf-agent-icon" x="166" y="150" width="28" height="22" rx="7"/><path d="M180 143v7m-7 9h3m8 0h3m-12 7h10"/></g>
    <text class="pf-agent-label" data-node="agent" x="180" y="119" text-anchor="middle">AI agent</text>
    <g class="pf-recipient-node"><circle cx="465" cy="108" r="18"/><path d="m458 108 5 5 9-11"/></g>
    <text class="pf-endpoint-label" x="465" y="151" text-anchor="middle">Trusted recipient</text>
    <text class="pf-sub-label" data-node="trusted" x="465" y="169" text-anchor="middle">Within the policy</text>
    <g class="pf-approval-node"><path d="m330 212 16 16-16 16-16-16Z"/><path d="M330 221v8l5 3"/></g>
    <g class="pf-owner-node"><rect x="447" y="210" width="36" height="36" rx="11"/><path d="M459 226v-5a6 6 0 0 1 12 0v5m-14 0h16v12h-16Z"/></g>
    <text class="pf-endpoint-label" x="465" y="273" text-anchor="middle">Owner decision</text>
    <text class="pf-sub-label" data-node="pending" x="465" y="291" text-anchor="middle">Request required</text>
    <g class="pf-blocked-node"><rect x="167" y="248" width="26" height="26" rx="5"/><path d="m175 256 10 10m0-10-10 10"/></g>
    <text class="pf-sub-label" data-node="blocked" x="180" y="319" text-anchor="middle">Blocked / not executed</text>
  </svg>
  <div class="pf-small-route"><span class="pf-small-agent"><span class="pf-node-mark">●</span> Agent</span><span class="pf-small-boundary">Spending policy</span><span class="pf-small-decision" data-node="smallDecision">✓ Within policy</span></div>`;
}
for (const canvas of document.querySelectorAll('[data-policy-diagram]')) canvas.innerHTML = policyDiagram();
const POLICY_SCENARIOS = {
  allowed: { title: 'Within the active policy', text: 'A payment to a trusted recipient fits both caps and the budget, so it settles on its own.', trusted: 'Paid on its own', pending: 'Nothing to decide', blocked: 'Freeze / expiry guard', endpoint: '✓ Autonomous payment' },
  pending: { title: 'A decision at the boundary', text: 'A payment is over the per-payment cap. The contract holds it as a request with the agent\'s reason, and you decide.', trusted: 'Not paid yet', pending: 'Waits for you', blocked: 'Freeze / expiry guard', endpoint: '◇ Owner approval required' },
  blocked: { title: 'The boundary holds', text: 'The agent is frozen. It can\'t pay, refuel or even ask until you unfreeze it.', trusted: 'Not paid', pending: 'No request', blocked: 'Agent frozen · blocked', endpoint: '⊘ Policy block' },
};
function selectPolicyScenario(state) {
  const root = document.querySelector('#landingField'), scenario = POLICY_SCENARIOS[state];
  root.dataset.state = state;
  root.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === state)));
  document.querySelector('#scenarioTitle').textContent = scenario.title;
  document.querySelector('#scenarioText').textContent = scenario.text;
  for (const [node, value] of Object.entries({ trusted: scenario.trusted, pending: scenario.pending, blocked: scenario.blocked, smallDecision: scenario.endpoint })) root.querySelector(`[data-node="${node}"]`).textContent = value;
}
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => selectPolicyScenario(button.dataset.scenario)));
selectPolicyScenario('allowed');

async function renderControlField(entry, held, now) {
  const root = $('#controlField'), { id, a, left, m } = entry;
  if (S.sel !== id) return;
  root.setAttribute('aria-busy', 'true');
  const pending = held.filter(x => Number(x.r.status) === 1).length;
  const expired = Number(a.rules.expiresAt) && now >= Number(a.rules.expiresAt);
  root.dataset.state = a.frozen || expired ? 'blocked' : 'active';
  $('#fieldMode').textContent = S.sim ? 'BROWSER SIMULATION' : net().name;
  $('#fieldBalance').textContent = `${fmt(a.balance, m.dec)} ${m.sym}`;
  $('#fieldCap').textContent = `${fmt(a.rules.perPayment, m.dec)} ${m.sym}`;
  $('#fieldLimit').textContent = `${fmt(a.rules.perPeriod, m.dec)} ${m.sym} / ${PERIOD_NAME[Number(a.rules.period)] || fmtDur(Number(a.rules.period))}`;
  $('#fieldLeft').textContent = `${fmt(spendNow(left, a), m.dec)} ${m.sym}`;
  $('#fieldAgent').textContent = a.agent;
  $('#fieldTrust').textContent = a.rules.trustedOnly ? 'Only trusted recipients may qualify for autonomous payment.' : 'Any recipient may qualify, subject to all other policy checks.';
  $('#fieldExpiry').textContent = Number(a.rules.expiresAt) ? `${expired ? 'Expired' : 'Expires'} ${new Date(Number(a.rules.expiresAt) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}` : 'No expiry configured';
  $('#fieldPending').textContent = `${pending} waiting for your approval`;
  root.querySelector('[data-node="agent"]').textContent = 'Agent #' + id;
  root.querySelector('[data-node="pending"]').textContent = `${pending} pending ${pending === 1 ? 'request' : 'requests'}`;
  root.querySelector('[data-node="blocked"]').textContent = a.frozen ? 'Frozen · spending blocked' : expired ? 'Expired · spending blocked' : 'Freeze / expiry guard';
  root.querySelector('[data-node="smallDecision"]').textContent = a.frozen ? '⊘ Frozen' : expired ? '⊘ Expired' : '◇ ' + pending + ' pending requests';
  $('#fieldSummary').textContent = a.frozen ? 'Frozen. This agent cannot pay, refuel or create approval requests.' : expired ? 'Expired. This agent cannot pay or create approval requests until its access is extended.' : 'Active. A payment goes through on its own when it fits both caps, the recipient rule and the budget. Anything else waits for you.';
  $('#fieldRecipients').replaceChildren();
  $('#fieldTrustNote').textContent = 'Verifying recipients against the contract…';
  root.querySelector('[data-node="trusted"]').textContent = 'Verifying recipients…';
  try {
    // Enumerate candidates from available events, then verify each against the actual mapping.
    // Never claim completeness: the configured start block or RPC history may omit events.
    const latest = await S.provider.getBlockNumber();
    const events = await S.al.queryFilter(S.al.filters.TrustUpdated(id), S.fromBlock, latest);
    const candidates = [...new Set(events.map(ev => ev.args.recipient))];
    const verified = (await Promise.all(candidates.map(async recipient => ({ recipient, trusted: await S.al.isTrusted(id, recipient) })))).filter(x => x.trusted);
    if (S.sel !== id) return;
    for (const { recipient } of verified) { const li = document.createElement('li'); li.textContent = recipient; $('#fieldRecipients').append(li); }
    root.querySelector('[data-node="trusted"]').textContent = `${verified.length} trusted`;
    $('#fieldTrustNote').textContent = verified.length ? 'Trusted recipients, each one confirmed by reading the contract.' : 'No trusted recipients yet.';
  } catch {
    if (S.sel !== id) return;
    root.querySelector('[data-node="trusted"]').textContent = 'Verification unavailable';
    $('#fieldTrustNote').textContent = 'Couldn\'t read trusted recipients right now. The payment preview still checks with the contract.';
  } finally { if (S.sel === id) root.setAttribute('aria-busy', 'false'); }
}
function isKnownPaymentFailure(error) {
  // A transport/provider failure is not proof of a policy rejection or nonexecution.
  return ['ACTION_REJECTED', 'INVALID_ARGUMENT', 'NUMERIC_FAULT'].includes(error?.code) || error?.code === 4001 || error?.receipt?.status === 0
    || (error?.code === 'CALL_EXCEPTION' && (typeof error?.data === 'string' || !!error?.revert?.name));
}
function paymentKey() { return `${S.chainId}:${S.address}:${S.sel}`; }
function recordPaymentResult(result) {
  paymentResult = { ...result, stage: 'result' };
  showPaymentDecision(paymentResult);
}
function showPaymentDecision(result) {
  const root = $('#paymentDecision'), stage = result.stage || 'result';
  root.dataset.state = result.state; root.dataset.stage = stage;
  root.querySelector('.pf-heading .eyebrow').textContent = stage === 'result' ? 'LAST PAYMENT OUTCOME' : stage === 'preview' ? 'PAYMENT PREVIEW' : 'PAYMENT IN PROGRESS';
  $('#decisionTitle').textContent = result.title; $('#decisionReason').textContent = result.reason;
  $('#decisionMode').textContent = (S.sim ? 'SIMULATION · ' : '') + ({ preview: 'PREVIEW ONLY', submitting: 'SUBMISSION IN PROGRESS', submitted: 'AWAITING CONFIRMATION', result: result.receipt ? 'CONFIRMED RECEIPT' : 'NO CONFIRMED PAYMENT' }[stage]);
  const steps = root.querySelectorAll('.pf-journey li');
  steps[0].lastElementChild.textContent = stage === 'preview' ? 'Payment input' : 'Payment requested';
  steps[1].lastElementChild.textContent = stage === 'preview' ? 'Contract dry run' : 'Policy evaluation';
  $('#decisionEndpoint').textContent = stage === 'preview' ? 'Predicted outcome' : stage === 'submitting' || stage === 'submitted' ? 'Not confirmed' : result.state === 'pending' ? 'Request recorded' : result.state === 'allowed' || result.state === 'owner' ? 'Payment completed' : result.state === 'blocked' ? 'Not executed' : 'Outcome unknown';
  const proof = $('#decisionProof'); proof.replaceChildren();
  if (result.receipt || result.hash) {
    const hash = result.receipt?.hash || result.hash;
    const label = document.createElement('span'); label.textContent = result.requestId != null ? `Request #${result.requestId} · ` : '';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'pf-proof-copy';
    copy.textContent = `${S.sim ? 'Simulation tx' : 'Transaction'} ${short(hash)}`; copy.title = S.sim ? 'Copy local simulation hash, not a testnet transaction' : 'Copy transaction hash';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(hash); toast('Transaction hash copied'); } catch { toast('Could not copy the transaction hash.', true); } };
    proof.append(label, copy);
  }
  proof.classList.toggle('hidden', !proof.childNodes.length);
}

// Full contract dry runs temporarily checkpoint the in-browser EVM. Queue RPC
// operations so another request cannot observe that temporary state. Real wallet
// transports and the simulation's contract/results remain unchanged.
function serializedSimulationTransport(sim) {
  let queue = Promise.resolve();
  const run = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  return { ...sim, request: args => run(() => sim.request(args)), advance: seconds => run(() => sim.advance(seconds)) };
}
