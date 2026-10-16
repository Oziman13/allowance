// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-20 surface used by Allowance. Return values are checked defensively
///      in `_send` / `_pull`, so tokens that return nothing are also supported.
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

/// @title Allowance
/// @notice Give your AI agent an allowance, not a wallet.
///         An *account* is a budget that an owner funds and an agent key spends, under rules
///         enforced here on-chain: a per-payment cap, a cap per period (daily, weekly, monthly...),
///         an optional trusted-recipients list, an optional expiry, and a freeze switch.
///         A payment outside the rules is not rejected: it is held as a request with the agent's
///         memo and the reason, and the owner approves or rejects it.
/// @dev    One contract serves any number of owners. Each account holds exactly one asset:
///         the chain's native token (POT on Portaldot, `asset == address(0)`) or an ERC-20.
///         Written for Portaldot V3 (Solidity / EVM-compatible execution); no assembly,
///         no SELFDESTRUCT, no reliance on gas stipends.
contract Allowance {
    // ---------------------------------------------------------------- types

    address public constant NATIVE = address(0);
    uint64 public constant MIN_PERIOD = 1 hours;
    uint256 public constant MAX_NAME = 64;
    uint256 public constant MAX_MEMO = 140;

    /// @notice Why a payment is held for the owner instead of settling instantly.
    enum Hold {
        None, //               within the rules: settles instantly
        OverPerPayment, //     larger than the per-payment cap
        OverPeriodLimit, //    would exceed what is left in the current period
        UntrustedRecipient //  trusted-only account and the recipient is not trusted
    }

    enum Status {
        None,
        Pending,
        Approved,
        Rejected,
        Cancelled
    }

    struct Rules {
        uint128 perPayment; //  max size of one instant payment
        uint128 perPeriod; //   max instant spending per period (payments + gas refuels)
        uint64 period; //       period length in seconds (>= MIN_PERIOD)
        uint64 expiresAt; //    0 = never; after this the agent can no longer spend or ask
        bool trustedOnly; //    instant payments only to trusted recipients
    }

    struct Account {
        address owner;
        address agent;
        address asset; //       NATIVE or an ERC-20
        bool frozen;
        uint128 balance; //     budget held by this contract for the account
        uint128 spentInPeriod;
        uint64 periodStart;
        uint64 payments; //     count of settled payments (instant + approved)
        uint128 totalSpent; //  settled payments + gas refuels, all time
        Rules rules;
        string name;
    }

    struct Request {
        uint256 accountId;
        address to;
        uint128 amount;
        uint64 createdAt;
        Status status;
        Hold reason;
        string memo;
    }

    // ---------------------------------------------------------------- storage

    Account[] private _accounts;
    Request[] private _requests;
    mapping(uint256 => mapping(address => bool)) public isTrusted;
    mapping(address => uint256[]) private _byOwner;
    mapping(address => uint256[]) private _byAgent;
    uint256 private _lock = 1;

    // ---------------------------------------------------------------- events

    event AccountOpened(uint256 indexed accountId, address indexed owner, address indexed agent, address asset, string name);
    event Funded(uint256 indexed accountId, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed accountId, address indexed to, uint256 amount);
    event RulesUpdated(uint256 indexed accountId, Rules rules);
    event TrustUpdated(uint256 indexed accountId, address indexed recipient, bool trusted);
    event FrozenSet(uint256 indexed accountId, bool frozen);
    event AgentRotated(uint256 indexed accountId, address indexed oldAgent, address indexed newAgent);
    event Paid(uint256 indexed accountId, address indexed to, uint256 amount, string memo);
    event Refueled(uint256 indexed accountId, address indexed agent, uint256 amount);
    event PaymentHeld(uint256 indexed requestId, uint256 indexed accountId, address indexed to, uint256 amount, Hold reason, string memo);
    event RequestResolved(uint256 indexed requestId, uint256 indexed accountId, Status status);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error NotAgent();
    error UnknownAccount();
    error UnknownRequest();
    error AccountFrozen();
    error AccountExpired();
    error InsufficientBudget();
    error InvalidRules();
    error InvalidAddress();
    error InvalidAmount();
    error TextTooLong();
    error NotPending();
    error NativeOnly();
    error OutsideRules(Hold reason);
    error TransferFailed();
    error Reentrancy();

    // ---------------------------------------------------------------- modifiers

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    function _account(uint256 id) private view returns (Account storage a) {
        if (id >= _accounts.length) revert UnknownAccount();
        a = _accounts[id];
    }

    function _owned(uint256 id) private view returns (Account storage a) {
        a = _account(id);
        if (msg.sender != a.owner) revert NotOwner();
    }

    function _agentOf(uint256 id) private view returns (Account storage a) {
        a = _account(id);
        if (msg.sender != a.agent) revert NotAgent();
        if (a.frozen) revert AccountFrozen();
        if (a.rules.expiresAt != 0 && block.timestamp >= a.rules.expiresAt) revert AccountExpired();
    }

    // ================================================================ owner

    /// @notice Open an account for `agent` and optionally fund it.
    /// @param deposit  budget to deposit now. Native: must equal msg.value - gasSeed. ERC-20: pulled via transferFrom.
    /// @param gasSeed  native only: POT sent straight to the agent so it can pay for its first transactions.
    ///                 Counted in `totalSpent`, not against the period limit.
    function openAccount(
        address agent,
        address asset,
        string calldata name,
        Rules calldata rules,
        address[] calldata trusted,
        uint256 deposit,
        uint256 gasSeed
    ) external payable nonReentrant returns (uint256 id) {
        if (agent == address(0) || agent == msg.sender) revert InvalidAddress();
        if (bytes(name).length > MAX_NAME) revert TextTooLong();
        _checkRules(rules);
        if (asset == NATIVE) {
            if (msg.value != deposit + gasSeed) revert InvalidAmount();
        } else {
            if (msg.value != 0 || gasSeed != 0) revert NativeOnly();
            if (asset.code.length == 0) revert InvalidAddress();
        }

        id = _accounts.length;
        Account storage a = _accounts.push();
        a.owner = msg.sender;
        a.agent = agent;
        a.asset = asset;
        a.rules = rules;
        a.periodStart = uint64(block.timestamp);
        a.name = name;
        _byOwner[msg.sender].push(id);
        _byAgent[agent].push(id);
        emit AccountOpened(id, msg.sender, agent, asset, name);
        emit RulesUpdated(id, rules);

        for (uint256 i; i < trusted.length; ++i) _setTrust(id, trusted[i], true);

        if (deposit != 0) {
            uint256 received = asset == NATIVE ? deposit : _pull(asset, msg.sender, deposit);
            a.balance = _u128(received);
            emit Funded(id, msg.sender, received);
        }
        if (gasSeed != 0) {
            a.totalSpent = _u128(gasSeed);
            emit Refueled(id, agent, gasSeed);
            _send(NATIVE, agent, gasSeed);
        }
    }

    /// @notice Add budget. Anyone may fund an account (e.g. a team treasury topping up an agent).
    function fund(uint256 id, uint256 amount) external payable nonReentrant {
        Account storage a = _account(id);
        if (amount == 0) revert InvalidAmount();
        uint256 received;
        if (a.asset == NATIVE) {
            if (msg.value != amount) revert InvalidAmount();
            received = amount;
        } else {
            if (msg.value != 0) revert NativeOnly();
            received = _pull(a.asset, msg.sender, amount);
        }
        a.balance = _u128(a.balance + received);
        emit Funded(id, msg.sender, received);
    }

    function withdraw(uint256 id, uint256 amount, address to) external nonReentrant {
        Account storage a = _owned(id);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > a.balance) revert InsufficientBudget();
        a.balance -= uint128(amount);
        emit Withdrawn(id, to, amount);
        _send(a.asset, to, amount);
    }

    function setRules(uint256 id, Rules calldata rules) external {
        Account storage a = _owned(id);
        _checkRules(rules);
        a.rules = rules;
        emit RulesUpdated(id, rules);
    }

    function setTrusted(uint256 id, address[] calldata recipients, bool trusted) external {
        _owned(id);
        for (uint256 i; i < recipients.length; ++i) _setTrust(id, recipients[i], trusted);
    }

    /// @notice Kill switch. A frozen agent cannot pay, refuel or even ask.
    function setFrozen(uint256 id, bool frozen) external {
        Account storage a = _owned(id);
        a.frozen = frozen;
        emit FrozenSet(id, frozen);
    }

    /// @notice Replace a lost or leaked agent key without moving the budget.
    function rotateAgent(uint256 id, address newAgent) external {
        Account storage a = _owned(id);
        if (newAgent == address(0) || newAgent == a.owner) revert InvalidAddress();
        address old = a.agent;
        a.agent = newAgent;
        _byAgent[newAgent].push(id);
        emit AgentRotated(id, old, newAgent);
    }

    /// @notice Approve a held payment. Owner-approved payments do not use up the period limit.
    /// @param trustRecipient also add the recipient to the trusted list, so the next payment settles instantly.
    function approve(uint256 requestId, bool trustRecipient) external nonReentrant {
        Request storage r = _request(requestId);
        Account storage a = _owned(r.accountId);
        if (r.status != Status.Pending) revert NotPending();
        if (r.amount > a.balance) revert InsufficientBudget();
        r.status = Status.Approved;
        a.balance -= r.amount;
        a.totalSpent += r.amount;
        a.payments += 1;
        if (trustRecipient) _setTrust(r.accountId, r.to, true);
        emit RequestResolved(requestId, r.accountId, Status.Approved);
        emit Paid(r.accountId, r.to, r.amount, r.memo);
        _send(a.asset, r.to, r.amount);
    }

    function reject(uint256 requestId) external {
        Request storage r = _request(requestId);
        _owned(r.accountId);
        if (r.status != Status.Pending) revert NotPending();
        r.status = Status.Rejected;
        emit RequestResolved(requestId, r.accountId, Status.Rejected);
    }

    // ================================================================ agent

    /// @notice Pay `amount` to `to`. Inside the rules it settles now; outside them it is held for the owner.
    /// @return settled   true if paid now
    /// @return requestId id of the held request when `settled` is false
    function pay(uint256 id, address to, uint256 amount, string calldata memo)
        external
        nonReentrant
        returns (bool settled, uint256 requestId)
    {
        Account storage a = _agentOf(id);
        if (to == address(0) || to == address(this)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (bytes(memo).length > MAX_MEMO) revert TextTooLong();
        if (amount > type(uint128).max) revert InvalidAmount();

        _roll(a);
        Hold reason = _hold(id, a, to, amount);
        if (reason == Hold.None) {
            // Inside the rules but not enough budget: fail loudly so the agent tells its owner.
            // (A held request may exceed the balance: the owner can top up, then approve.)
            if (amount > a.balance) revert InsufficientBudget();
            a.balance -= uint128(amount);
            a.spentInPeriod += uint128(amount);
            a.totalSpent += uint128(amount);
            a.payments += 1;
            emit Paid(id, to, amount, memo);
            _send(a.asset, to, amount);
            return (true, 0);
        }

        requestId = _requests.length;
        _requests.push(Request(id, to, uint128(amount), uint64(block.timestamp), Status.Pending, reason, memo));
        emit PaymentHeld(requestId, id, to, amount, reason, memo);
        return (false, requestId);
    }

    /// @notice Native accounts only: move budget to the agent's own address to pay for gas.
    ///         On Portaldot gas is POT, so the agent's gas comes out of the same budget,
    ///         under the same per-payment and period limits. The cap is total.
    function refuel(uint256 id, uint256 amount) external nonReentrant {
        Account storage a = _agentOf(id);
        if (a.asset != NATIVE) revert NativeOnly();
        if (amount == 0) revert InvalidAmount();
        if (amount > a.balance) revert InsufficientBudget();
        _roll(a);
        if (amount > a.rules.perPayment) revert OutsideRules(Hold.OverPerPayment);
        if (a.spentInPeriod + amount > a.rules.perPeriod) revert OutsideRules(Hold.OverPeriodLimit);
        a.balance -= uint128(amount);
        a.spentInPeriod += uint128(amount);
        a.totalSpent += uint128(amount);
        emit Refueled(id, msg.sender, amount);
        _send(NATIVE, msg.sender, amount);
    }

    /// @notice The agent withdraws its own pending request.
    function cancel(uint256 requestId) external {
        Request storage r = _request(requestId);
        Account storage a = _account(r.accountId);
        if (msg.sender != a.agent) revert NotAgent();
        if (r.status != Status.Pending) revert NotPending();
        r.status = Status.Cancelled;
        emit RequestResolved(requestId, r.accountId, Status.Cancelled);
    }

    // ================================================================ views

    /// @notice Dry run, free to call: would this payment settle now, and if not, why?
    function preview(uint256 id, address to, uint256 amount) external view returns (Hold reason, uint256 leftThisPeriod) {
        Account storage a = _account(id);
        leftThisPeriod = _left(a);
        uint256 spent = a.rules.perPeriod - leftThisPeriod;
        if (amount > a.rules.perPayment) reason = Hold.OverPerPayment;
        else if (spent + amount > a.rules.perPeriod) reason = Hold.OverPeriodLimit;
        else if (a.rules.trustedOnly && !isTrusted[id][to]) reason = Hold.UntrustedRecipient;
    }

    function getAccount(uint256 id) external view returns (Account memory account, uint256 leftThisPeriod) {
        Account storage a = _account(id);
        return (a, _left(a));
    }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        return _request(requestId);
    }

    function accountCount() external view returns (uint256) {
        return _accounts.length;
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    function accountsOfOwner(address owner) external view returns (uint256[] memory) {
        return _byOwner[owner];
    }

    /// @dev May include accounts the address used to be the agent of (after a rotation); check `agent`.
    function accountsOfAgent(address agent) external view returns (uint256[] memory) {
        return _byAgent[agent];
    }

    // ================================================================ internal

    function _request(uint256 requestId) private view returns (Request storage) {
        if (requestId >= _requests.length) revert UnknownRequest();
        return _requests[requestId];
    }

    function _checkRules(Rules calldata r) private pure {
        if (r.period < MIN_PERIOD || r.perPayment == 0 || r.perPeriod == 0 || r.perPayment > r.perPeriod) {
            revert InvalidRules();
        }
    }

    function _setTrust(uint256 id, address who, bool trusted) private {
        if (who == address(0)) revert InvalidAddress();
        isTrusted[id][who] = trusted;
        emit TrustUpdated(id, who, trusted);
    }

    /// @dev Fixed windows: a new period starts once the current one has fully elapsed.
    function _roll(Account storage a) private {
        if (block.timestamp >= uint256(a.periodStart) + a.rules.period) {
            a.periodStart = uint64(block.timestamp);
            a.spentInPeriod = 0;
        }
    }

    function _left(Account storage a) private view returns (uint256) {
        if (block.timestamp >= uint256(a.periodStart) + a.rules.period) return a.rules.perPeriod;
        return a.spentInPeriod >= a.rules.perPeriod ? 0 : a.rules.perPeriod - a.spentInPeriod;
    }

    function _hold(uint256 id, Account storage a, address to, uint256 amount) private view returns (Hold) {
        if (amount > a.rules.perPayment) return Hold.OverPerPayment;
        if (a.spentInPeriod + amount > a.rules.perPeriod) return Hold.OverPeriodLimit;
        if (a.rules.trustedOnly && !isTrusted[id][to]) return Hold.UntrustedRecipient;
        return Hold.None;
    }

    function _send(address asset, address to, uint256 amount) private {
        bool ok;
        bytes memory ret;
        if (asset == NATIVE) {
            (ok,) = to.call{value: amount}("");
        } else {
            (ok, ret) = asset.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
            ok = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        }
        if (!ok) revert TransferFailed();
    }

    /// @dev Credits what actually arrived, so fee-on-transfer tokens can't inflate a budget.
    function _pull(address asset, address from, uint256 amount) private returns (uint256 received) {
        uint256 before = IERC20(asset).balanceOf(address(this));
        (bool ok, bytes memory ret) =
            asset.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        received = IERC20(asset).balanceOf(address(this)) - before;
        if (received == 0) revert InvalidAmount();
    }

    function _u128(uint256 x) private pure returns (uint128) {
        if (x > type(uint128).max) revert InvalidAmount();
        return uint128(x);
    }
}
