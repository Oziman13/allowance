// DOM rendering uses textContent for all extension and RPC data.
export function mountPanel(root, controller, sources) {
  const $ = selector => root.querySelector(selector);
  const show = (selector, text) => { $(selector).textContent = text; };
  const option = (value, label) => { const el = document.createElement('option'); el.value = value; el.textContent = label; return el; };
  const scan = () => {
    const list = sources();
    $('#nativeSource').replaceChildren(...list.map(name => option(name, name)));
    $('#nativeConnect').disabled = !list.length;
    if (!list.length) show('#nativeStatus', 'No supported native extension found. Install an injectedWeb3 accounts extension, then reopen this panel.');
  };
  const render = state => {
    root.dataset.state = state.status;
    root.setAttribute('aria-busy', String(['authorizing', 'checking'].includes(state.status)));
    show('#nativeStatus', state.message || 'Connect an extension to share public accounts. No signature is requested.');
    const select = $('#nativeAccount');
    select.replaceChildren(option('', 'Choose an authorized account'),
      ...state.accounts.map(a => option(a.id, `${a.name} · ${a.ss58}`)));
    select.value = state.selected;
    select.disabled = !state.accounts.length;
    $('#nativeConnect').disabled = !sources().length || state.status === 'authorizing';
    $('#nativeSource').disabled = state.status === 'authorizing';
    $('#nativeDisconnect').disabled = state.status === 'disconnected';
    $('#nativeRefresh').disabled = !state.selected || state.status === 'checking';
    const account = state.accounts.find(a => a.id === state.selected);
    const snapshot = state.snapshot;
    const network = snapshot?.network;
    show('#nativeAccountId', account?.id || 'Not selected');
    show('#nativeSS58', account?.ss58 || 'Not selected');
    show('#nativeH160', snapshot?.h160 || 'Unverified');
    show('#nativeMapping', snapshot?.mapping || 'Unverified');
    show('#nativeGenesis', network?.genesis || 'Unverified');
    show('#nativeRuntime', network ? `${network.specName} · spec ${network.specVersion} · transaction ${network.transactionVersion}` : 'Unverified');
    show('#nativeBlock', network?.block || 'Unavailable');
    const caps = snapshot?.capabilities;
    show('#nativeCapabilities', caps ? `Address read ${caps.address ? 'present' : 'absent'} · reverse read ${caps.reverse ? 'present' : 'absent'} · dry run ${caps.dryRun ? 'present' : 'absent'} · mapAccount ${caps.mapAccount ? 'advertised' : 'absent'} · call ${caps.call ? 'advertised' : 'absent'}` : 'Unverified');
    const owned = snapshot?.ownership;
    show('#nativeCode', snapshot?.deployment ? `Code present · EVM finalized block ${snapshot.deployment.block}` : 'Unverified / not checked');
    const list = $('#nativeAllowances'); list.replaceChildren();
    show('#nativeOwnership', owned ? (owned.total ? `${owned.total} stored owner match${owned.total === 1 ? '' : 'es'}${owned.total > owned.accounts.length ? ` · showing first ${owned.accounts.length}` : ''}` : 'Verified empty owner list at this snapshot.') : 'Ownership unavailable. No zero balance or ownership assumption.');
    for (const a of owned?.accounts || []) {
      const card = document.createElement('li');
      const title = document.createElement('h4'); title.textContent = `#${a.id} · ${a.name}`;
      const budget = document.createElement('p');
      const native = /^0x0{40}$/i.test(a.asset);
      // Token decimals/transfer economics are not guessed from the native currency.
      const amount = native ? formatNative(a.balance) + ' POT' : a.balance + ' raw token units';
      budget.textContent = `Recorded budget: ${amount}`;
      const status = document.createElement('p'); status.className = 'native-muted';
      status.textContent = `${a.frozen ? 'Frozen' : 'Not frozen'} · expiry ${a.expiresAt === '0' ? 'none' : 'Unix ' + a.expiresAt} · asset ${a.asset}`;
      card.append(title, budget, status); list.append(card);
    }
  };
  controller.changed = render;
  $('#nativeSource').onchange = () => controller.disconnect();
  $('#nativeConnect').onclick = () => controller.connect($('#nativeSource').value);
  $('#nativeAccount').onchange = () => controller.select($('#nativeAccount').value);
  $('#nativeRefresh').onclick = () => controller.select(controller.state.selected);
  $('#nativeDisconnect').onclick = () => controller.disconnect();
  $('#nativeClose').onclick = () => { controller.disconnect(); root.close(); };
  root.addEventListener('close', () => controller.disconnect());
  root.addEventListener('cancel', () => controller.disconnect());
  render(controller.state); scan();
  return { open() { scan(); }, disconnect() { controller.disconnect(); } };
}
function formatNative(raw) {
  const value = BigInt(raw), unit = 10n ** 18n;
  const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '');
  return (value / unit).toString() + (fraction ? '.' + fraction : '');
}
