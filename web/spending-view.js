// Display-only derivation. No wallet, provider, transaction or local-clock dependency.
const SpendingView = {
  summarize(entry, chainTime) {
    const a = entry?.a, left = entry?.left;
    const amount = value => typeof value === 'bigint' && value >= 0n;
    const unavailable = reason => ({ state: 'unavailable', budget: amount(a?.balance) ? a.balance : null,
      headroom: null, capacity: null, single: null, reason });
    if (!a || typeof a.frozen !== 'boolean' || !amount(a.balance) || !amount(left) || !amount(a.rules?.perPayment)
        || !amount(a.rules?.perPeriod) || !amount(a.rules?.expiresAt) || left > a.rules.perPeriod) {
      return unavailable('Account data is unavailable or incomplete. No spending amount is assumed.');
    }
    if (!Number.isSafeInteger(chainTime) || chainTime < 0) {
      return unavailable('Chain time is unavailable. Current spending eligibility is unverified.');
    }
    const expired = a.rules.expiresAt !== 0n && BigInt(chainTime) >= a.rules.expiresAt;
    const state = a.frozen ? 'frozen' : expired ? 'expired' : a.rules.perPayment === 0n ? 'paused' : 'active';
    const backed = left < a.balance ? left : a.balance;
    const capacity = state === 'active' ? backed : 0n;
    const single = capacity < a.rules.perPayment ? capacity : a.rules.perPayment;
    return { state, budget: a.balance, headroom: left, capacity, single,
      reason: state === 'frozen' ? 'Frozen: no new agent payments, refuels or requests. Owner actions remain available.'
        : state === 'expired' ? 'Expired: no new agent payments, refuels or requests. Owner actions remain available.'
        : state === 'paused' ? 'The per-payment cap is zero; no positive autonomous payment or refuel can execute.'
        : 'For eligible recipients only. The payment preview checks the chosen recipient and execution conditions.' };
  },
};
