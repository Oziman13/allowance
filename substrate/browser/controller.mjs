// Accounts-only injectedWeb3 adapter. No signer, wallet provider, or EVM application state.
export const GENESIS = '0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd';
export class NativeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function walletSources(injected = {}) {
  return Object.keys(injected).filter(key => typeof injected[key]?.enable === 'function');
}
export class NativeController {
  constructor({ injected, normalize, inspect, changed = () => {}, timeout = 20000 }) {
    Object.assign(this, { injected, normalize, inspect, changed, timeout });
    this.generation = 0;
    this.state = { status: 'disconnected', accounts: [], selected: '', snapshot: null };
  }
  emit(update) { Object.assign(this.state, update); this.changed(this.state); }
  invalidate() {
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.emit({ snapshot: null });
  }
  disconnect() {
    this.session = null;
    this.invalidate();
    try { this.unsubscribe?.(); } catch { /* Local invalidation still takes effect. */ }
    this.unsubscribe = null;
    this.emit({ status: 'disconnected', message: 'Disconnected locally. Revoke site access in your extension if needed.',
      accounts: [], selected: '', source: '' });
  }
  async connect(source) {
    this.disconnect();
    const generation = this.generation;
    const provider = this.injected()?.[source];
    if (typeof provider?.enable !== 'function') {
      this.emit({ status: 'unsupported', message: 'No supported native extension found. Use an injectedWeb3 accounts extension.' });
      return;
    }
    this.emit({ status: 'authorizing', source, message: 'Approve account access in your extension. No signature is requested.' });
    try {
      const extension = await provider.enable('Allowance · read-only native accounts');
      if (generation !== this.generation) return;
      const accounts = extension?.accounts;
      if (typeof accounts?.get !== 'function' || typeof accounts?.subscribe !== 'function') {
        throw new NativeError('unsupported', 'Extension must support accounts.get and accounts.subscribe. No signing support is needed.');
      }
      // Subscribe before the initial read. A newer subscription event wins over a late get().
      let events = 0;
      const accept = list => {
        if (generation !== this.session) return;
        events++;
        this.accept(list);
      };
      this.session = generation;
      const unsubscribe = accounts.subscribe(accept);
      if (typeof unsubscribe !== 'function') throw new NativeError('unsupported', 'Extension does not provide account-change cleanup.');
      this.unsubscribe = unsubscribe;
      const initial = await accounts.get();
      if (generation !== this.session || !this.unsubscribe) return;
      if (events === 0) this.accept(initial);
    } catch (e) {
      if (generation !== this.session && generation !== this.generation) return;
      try { this.unsubscribe?.(); } catch { /* Ignore extension cleanup errors. */ }
      this.unsubscribe = null;
      this.session = null;
      this.invalidate();
      this.emit({ accounts: [], selected: '', status: e?.code === 'unsupported' ? 'unsupported' : 'authorization-failed',
        message: e?.code === 'unsupported' ? e.message : 'Account access was rejected or unavailable. You can try connecting again.' });
    }
  }
  accept(list) {
    this.invalidate();
    let accounts = [];
    try {
      if (!Array.isArray(list)) throw new Error('Invalid account list');
      const seen = new Set();
      accounts = list.map(account => this.normalize(account)).filter(account => {
        if (seen.has(account.id)) return false;
        seen.add(account.id); return true;
      });
    } catch {
      this.emit({ accounts: [], selected: '', status: 'unsupported', message: 'Only valid AccountId32 native accounts are supported. No identity was inferred.' });
      return;
    }
    this.emit({ accounts, selected: '', status: accounts.length ? 'choose-account' : 'no-accounts',
      message: accounts.length ? 'Select an authorized native account to inspect.' : 'No accounts shared. Check extension permissions.' });
    // Never silently choose among multiple authorized identities, even after an update.
    if (accounts.length === 1) this.select(accounts[0].id);
  }
  async select(id) {
    this.invalidate();
    const account = this.state.accounts.find(a => a.id === id);
    this.emit({ selected: account?.id || '', status: account ? 'checking' : 'choose-account',
      message: account ? 'Checking finalized chain identity, mapping and contract reads…' : 'Select an authorized native account to inspect.' });
    if (!account) return;
    const generation = this.generation;
    const abort = this.abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeout);
    try {
      // Race even when an injected/mock backend ignores AbortSignal.
      const cancelled = new Promise((_, reject) => abort.signal.addEventListener('abort', () =>
        reject(new NativeError('rpc-unavailable', 'Read timed out or was cancelled. No mapping or balance was assumed.')), { once: true }));
      const snapshot = await Promise.race([this.inspect(account, abort.signal), cancelled]);
      if (generation !== this.generation) return;
      this.emit({ status: snapshot.status, message: snapshot.message, snapshot });
    } catch (e) {
      if (generation !== this.generation) return;
      this.emit({ status: e?.code || 'rpc-unavailable', message: e?.code ? e.message : 'RPC unavailable or incompatible. Identity and balances remain unverified.', snapshot: null });
    } finally { clearTimeout(timer); }
  }
}
