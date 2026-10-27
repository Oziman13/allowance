// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Vm} from "forge-std/Vm.sol";
import {Allowance} from "../../src/Allowance.sol";
import {MockERC20} from "../mocks/MockTokens.sol";

// Local reference model. No production getter is used to choose expected effects or permissions.
contract AllowanceHandler is Test {
    struct AccountModel {
        address owner;
        address agent;
        address revoked;
        uint256 asset; // 0 native, 1 and 2 independent standard-token pools
        uint256 balance;
        uint256 spent;
        uint256 start;
        uint256 total;
        uint256 payments;
        uint256 funded;
        uint256 withdrawn;
        uint256 autonomous;
        uint256 approved;
        uint256 seed;
        bool frozen;
        Allowance.Rules rules;
    }

    struct RequestModel {
        uint256 account;
        address to;
        uint256 amount;
        Allowance.Status status;
        Allowance.Hold reason;
        uint256 settlements;
    }
    Allowance public immutable al;
    MockERC20[2] public tokens;
    address[3] public owners = [address(0x1101), address(0x1102), address(0x1103)];
    address[3] public agents = [address(0x2101), address(0x2102), address(0x2103)];
    address[3] public recipients = [address(0x4101), address(0x4102), address(0x4103)];
    address constant OUTSIDER = address(0x3101);
    AccountModel[] internal model;
    RequestModel[] internal requests;
    mapping(uint256 => mapping(address => bool)) internal trusted;
    uint256[3] internal surplus;
    uint256 public instantCount;
    uint256 public heldCount;
    uint256 public approvedCount;
    uint256 public cancelledCount;
    uint256 public refuelCount;
    uint256 public withdrawnCount;
    uint256 public deniedCount;
    uint256 public rotatedCount;
    uint256 public expiredDeniedCount;

    constructor(Allowance target) {
        al = target;
        tokens[0] = new MockERC20();
        tokens[1] = new MockERC20();
        for (uint256 i; i < 7; ++i) {
            address who = i < 3 ? owners[i] : i < 6 ? agents[i - 3] : OUTSIDER;
            for (uint256 t; t < 2; ++t) {
                vm.prank(who);
                tokens[t].approve(address(al), type(uint256).max);
            }
        }
        for (uint256 i; i < 9; ++i) {
            _open(i % 3, i / 3, i % 3, 1000, 2);
        }
    }

    function _open(uint256 o, uint256 asset, uint256 ag, uint256 deposit, uint256 seed) internal {
        uint256 id = model.length;
        address[] memory initialTrust = new address[](1);
        initialTrust[0] = recipients[0];
        Allowance.Rules memory r = Allowance.Rules(50, 150, 1 hours, 0, true);
        if (asset == 0) vm.deal(owners[o], owners[o].balance + deposit + seed);
        else tokens[asset - 1].mint(owners[o], deposit);
        vm.prank(owners[o]);
        uint256 actual = al.openAccount{value: asset == 0 ? deposit + seed : 0}(
            agents[ag],
            asset == 0 ? address(0) : address(tokens[asset - 1]),
            "stateful",
            r,
            initialTrust,
            deposit,
            asset == 0 ? seed : 0
        );
        assertEq(actual, id);
        model.push();
        AccountModel storage m = model[id];
        m.owner = owners[o];
        m.agent = agents[ag];
        m.asset = asset;
        m.balance = deposit;
        m.start = block.timestamp;
        m.funded = deposit;
        m.seed = asset == 0 ? seed : 0;
        m.total = m.seed;
        m.rules = r;
        trusted[id][recipients[0]] = true;
    }

    function open(uint256 seed) external {
        if (model.length >= 18) return; // bounded state size, not a constraint on production
        _open(seed % 3, (seed / 3) % 3, (seed / 9) % 3, 100 + (seed / 27) % 1000, seed % 4);
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return seed % model.length;
    }

    function _actor(AccountModel storage m, uint256 seed, bool ownerOperation) internal view returns (address) {
        if (seed % 4 == 0) return ownerOperation ? m.owner : m.agent;
        if (seed % 4 == 1) return OUTSIDER;
        if (seed % 4 == 2 && m.revoked != address(0) && m.revoked != m.agent) return m.revoked;
        // Another account's real owner/agent, not just a generic stranger.
        return
            ownerOperation ? owners[(uint160(m.owner) - 0x1101 + 1) % 3] : agents[(uint160(m.agent) - 0x2101 + 1) % 3];
    }

    function _error(bytes4 selector) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(selector);
    }

    function _liveError(AccountModel storage m, address actor) internal view returns (bytes memory) {
        if (actor != m.agent) return _error(Allowance.NotAgent.selector);
        if (m.frozen) return _error(Allowance.AccountFrozen.selector);
        if (m.rules.expiresAt != 0 && block.timestamp >= m.rules.expiresAt) {
            return _error(Allowance.AccountExpired.selector);
        }
        return "";
    }

    function _effectiveSpent(AccountModel storage m) internal view returns (uint256) {
        return block.timestamp >= m.start + m.rules.period ? 0 : m.spent;
    }

    function _roll(AccountModel storage m) internal {
        if (block.timestamp >= m.start + m.rules.period) {
            m.start = block.timestamp;
            m.spent = 0;
        }
    }

    function _balance(uint256 asset, address who) internal view returns (uint256) {
        return asset == 0 ? who.balance : tokens[asset - 1].balanceOf(who);
    }

    function _call(address actor, uint256 value, bytes memory data, bytes memory expected)
        internal
        returns (bytes memory out)
    {
        vm.prank(actor);
        (bool ok, bytes memory ret) = address(al).call{value: value}(data);
        if (expected.length == 0) {
            assertTrue(ok, "unexpected production revert");
        } else {
            assertFalse(ok, "forbidden operation succeeded");
            assertEq(ret, expected, "wrong revert");
            deniedCount++;
            if (keccak256(expected) == keccak256(_error(Allowance.AccountExpired.selector))) expiredDeniedCount++;
        }
        return ret;
    }

    function _paidEvent(Vm.Log[] memory logs, uint256 id, address to, uint256 amount, bool paid, bool resolved)
        internal
        view
    {
        uint256 paidLogs;
        uint256 resolvedLogs;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(al) || logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == keccak256("Paid(uint256,address,uint256,string)")) {
                paidLogs++;
                assertEq(uint256(logs[i].topics[1]), id);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), to);
                assertEq(logs[i].data, abi.encode(amount, "invariant"));
            }
            if (logs[i].topics[0] == keccak256("RequestResolved(uint256,uint256,uint8)")) resolvedLogs++;
        }
        assertEq(paidLogs, paid ? 1 : 0);
        assertEq(resolvedLogs, resolved ? 1 : 0, "approval and autonomous paths indistinguishable");
    }

    function fund(uint256 idSeed, uint256 whoSeed, uint256 amountSeed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address who = whoSeed % 2 == 0 ? OUTSIDER : m.owner;
        uint256 amount = amountSeed % 201;
        if (m.asset == 0) vm.deal(who, who.balance + amount);
        else tokens[m.asset - 1].mint(who, amount);
        _call(
            who,
            m.asset == 0 ? amount : 0,
            abi.encodeCall(al.fund, (id, amount)),
            amount == 0 ? _error(Allowance.InvalidAmount.selector) : bytes("")
        );
        if (amount != 0) {
            m.balance += amount;
            m.funded += amount;
        }
    }

    function pay(uint256 idSeed, uint256 actorSeed, uint256 amountSeed, uint256 toSeed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, false);
        address to = recipients[toSeed % 3];
        uint256 amount = amountSeed % 201;
        bytes memory err = _liveError(m, actor);
        if (err.length == 0 && amount == 0) err = _error(Allowance.InvalidAmount.selector);
        Allowance.Hold hold;
        if (amount > m.rules.perPayment) hold = Allowance.Hold.OverPerPayment;
        else if (_effectiveSpent(m) + amount > m.rules.perPeriod) hold = Allowance.Hold.OverPeriodLimit;
        else if (m.rules.trustedOnly && !trusted[id][to]) hold = Allowance.Hold.UntrustedRecipient;
        if (err.length == 0 && hold == Allowance.Hold.None && amount > m.balance) {
            err = _error(Allowance.InsufficientBudget.selector);
        }
        uint256 before = _balance(m.asset, to);
        vm.recordLogs();
        bytes memory out = _call(actor, 0, abi.encodeCall(al.pay, (id, to, amount, "invariant")), err);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool settles = err.length == 0 && hold == Allowance.Hold.None;
        _paidEvent(logs, id, to, amount, settles, false);
        assertEq(_balance(m.asset, to) - before, settles ? amount : 0);
        if (err.length != 0) return;
        _roll(m);
        (bool actualSettled, uint256 rid) = abi.decode(out, (bool, uint256));
        assertEq(actualSettled, settles);
        if (settles) {
            m.balance -= amount;
            m.spent += amount;
            m.total += amount;
            m.payments++;
            m.autonomous += amount;
            instantCount++;
        } else {
            assertEq(rid, requests.length);
            requests.push(RequestModel(id, to, amount, Allowance.Status.Pending, hold, 0));
            heldCount++;
        }
    }

    function refuel(uint256 idSeed, uint256 actorSeed, uint256 amountSeed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, false);
        uint256 amount = amountSeed % 201;
        bytes memory err = _liveError(m, actor);
        if (err.length == 0) {
            if (m.asset != 0) {
                err = _error(Allowance.NativeOnly.selector);
            } else if (amount == 0) {
                err = _error(Allowance.InvalidAmount.selector);
            } else if (amount > m.balance) {
                err = _error(Allowance.InsufficientBudget.selector);
            } else if (amount > m.rules.perPayment) {
                err = abi.encodeWithSelector(Allowance.OutsideRules.selector, Allowance.Hold.OverPerPayment);
            } else if (_effectiveSpent(m) + amount > m.rules.perPeriod) {
                err = abi.encodeWithSelector(Allowance.OutsideRules.selector, Allowance.Hold.OverPeriodLimit);
            }
        }
        uint256 before = actor.balance;
        _call(actor, 0, abi.encodeCall(al.refuel, (id, amount)), err);
        assertEq(actor.balance - before, err.length == 0 ? amount : 0);
        if (err.length != 0) return;
        _roll(m);
        m.balance -= amount;
        m.spent += amount;
        m.total += amount;
        m.autonomous += amount;
        refuelCount++;
    }

    function withdraw(uint256 idSeed, uint256 actorSeed, uint256 amountSeed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, true);
        uint256 amount = amountSeed % 201;
        bytes memory err;
        if (actor != m.owner) err = _error(Allowance.NotOwner.selector);
        else if (amount == 0) err = _error(Allowance.InvalidAmount.selector);
        else if (amount > m.balance) err = _error(Allowance.InsufficientBudget.selector);
        uint256 before = _balance(m.asset, recipients[2]);
        _call(actor, 0, abi.encodeCall(al.withdraw, (id, amount, recipients[2])), err);
        assertEq(_balance(m.asset, recipients[2]) - before, err.length == 0 ? amount : 0);
        if (err.length == 0) {
            m.balance -= amount;
            m.withdrawn += amount;
            withdrawnCount++;
        }
    }

    // decision 0 approve, 1 reject, 2 cancel; intentionally samples resolved requests too.
    function resolve(uint256 reqSeed, uint256 actorSeed, uint256 decisionSeed) external {
        if (requests.length == 0) return;
        uint256 rid = reqSeed % requests.length;
        RequestModel storage r = requests[rid];
        AccountModel storage m = model[r.account];
        uint256 decision = decisionSeed % 3;
        address actor = _actor(m, actorSeed, decision != 2);
        bytes memory err;
        if (actor != (decision == 2 ? m.agent : m.owner)) {
            err = _error(decision == 2 ? Allowance.NotAgent.selector : Allowance.NotOwner.selector);
        } else if (r.status != Allowance.Status.Pending) {
            err = _error(Allowance.NotPending.selector);
        } else if (decision == 0 && r.amount > m.balance) {
            err = _error(Allowance.InsufficientBudget.selector);
        }
        bytes memory data = decision == 0
            ? abi.encodeCall(al.approve, (rid, true))
            : decision == 1 ? abi.encodeCall(al.reject, (rid)) : abi.encodeCall(al.cancel, (rid));
        uint256 before = _balance(m.asset, r.to);
        vm.recordLogs();
        _call(actor, 0, data, err);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool pays = err.length == 0 && decision == 0;
        _paidEvent(logs, r.account, r.to, r.amount, pays, err.length == 0);
        assertEq(_balance(m.asset, r.to) - before, pays ? r.amount : 0);
        if (err.length != 0) return;
        if (decision == 0) {
            r.status = Allowance.Status.Approved;
            r.settlements++;
            m.balance -= r.amount;
            m.total += r.amount;
            m.payments++;
            m.approved += r.amount;
            trusted[r.account][r.to] = true;
            approvedCount++;
        } else if (decision == 1) {
            r.status = Allowance.Status.Rejected;
        } else {
            r.status = Allowance.Status.Cancelled;
            cancelledCount++;
        }
        // Owner approval deliberately does not roll or debit autonomous window usage.
    }

    function policy(uint256 idSeed, uint256 actorSeed, uint256 seed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, true);
        uint128 cap = uint128(10 + seed % 91);
        uint256 expiryMode = (seed / 91) % 4;
        uint64 expiry = expiryMode == 0
            ? 0
            : expiryMode == 1 ? uint64(block.timestamp) : uint64(block.timestamp + expiryMode * 3600);
        Allowance.Rules memory r = Allowance.Rules(
            cap, cap * uint128(1 + (seed / 364) % 4), uint64(3600 * (1 + (seed / 1456) % 3)), expiry, seed % 2 == 0
        );
        _call(
            actor,
            0,
            abi.encodeCall(al.setRules, (id, r)),
            actor == m.owner ? bytes("") : _error(Allowance.NotOwner.selector)
        );
        if (actor == m.owner) m.rules = r;
    }

    function trust(uint256 idSeed, uint256 actorSeed, uint256 toSeed, bool value) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, true);
        address[] memory list = new address[](1);
        list[0] = recipients[toSeed % 3];
        _call(
            actor,
            0,
            abi.encodeCall(al.setTrusted, (id, list, value)),
            actor == m.owner ? bytes("") : _error(Allowance.NotOwner.selector)
        );
        if (actor == m.owner) trusted[id][list[0]] = value;
    }

    function freeze(uint256 idSeed, uint256 actorSeed, bool value) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, true);
        _call(
            actor,
            0,
            abi.encodeCall(al.setFrozen, (id, value)),
            actor == m.owner ? bytes("") : _error(Allowance.NotOwner.selector)
        );
        if (actor == m.owner) m.frozen = value;
    }

    function rotate(uint256 idSeed, uint256 actorSeed, uint256 agentSeed) external {
        uint256 id = _id(idSeed);
        AccountModel storage m = model[id];
        address actor = _actor(m, actorSeed, true);
        address next = agents[agentSeed % 3];
        if (next == m.agent) next = agents[(agentSeed % 3 + 1) % 3];
        _call(
            actor,
            0,
            abi.encodeCall(al.rotateAgent, (id, next)),
            actor == m.owner ? bytes("") : _error(Allowance.NotOwner.selector)
        );
        if (actor == m.owner) {
            m.revoked = m.agent;
            m.agent = next;
            rotatedCount++;
        }
    }

    function advance(uint256 seed) external {
        vm.warp(block.timestamp + seed % (6 hours + 1));
    }

    function donate(uint256 assetSeed, uint256 amountSeed) external {
        uint256 asset = assetSeed % 3;
        uint256 amount = amountSeed % 31;
        // Forced native donation modeled without changing any attributed account ledger.
        if (asset == 0) vm.deal(address(al), address(al).balance + amount);
        else tokens[asset - 1].mint(address(al), amount);
        surplus[asset] += amount;
    }

    function assertState() external view {
        assertEq(al.accountCount(), model.length);
        uint256[3] memory backing;
        for (uint256 id; id < model.length; ++id) {
            AccountModel storage m = model[id];
            (Allowance.Account memory a, uint256 left) = al.getAccount(id);
            assertEq(a.owner, m.owner);
            assertEq(a.agent, m.agent);
            assertEq(a.frozen, m.frozen);
            assertEq(a.asset, m.asset == 0 ? address(0) : address(tokens[m.asset - 1]));
            assertEq(a.balance, m.balance);
            assertEq(a.spentInPeriod, m.spent);
            assertEq(a.periodStart, m.start);
            assertEq(a.totalSpent, m.total);
            assertEq(a.payments, m.payments);
            assertEq(keccak256(abi.encode(a.rules)), keccak256(abi.encode(m.rules)));
            uint256 used = _effectiveSpent(m);
            assertEq(left, used >= m.rules.perPeriod ? 0 : m.rules.perPeriod - used);
            assertEq(m.funded, m.balance + m.withdrawn + m.autonomous + m.approved, "reference conservation");
            assertEq(m.total, m.seed + m.autonomous + m.approved, "approval/auto attribution");
            for (uint256 j; j < 3; ++j) {
                assertEq(al.isTrusted(id, recipients[j]), trusted[id][recipients[j]]);
            }
            backing[m.asset] += m.balance;
        }
        for (uint256 asset; asset < 3; ++asset) {
            assertEq(_balance(asset, address(al)), backing[asset] + surplus[asset], "actual backing mismatch");
        }
        assertEq(al.requestCount(), requests.length);
        for (uint256 rid; rid < requests.length; ++rid) {
            RequestModel storage r = requests[rid];
            Allowance.Request memory actual = al.getRequest(rid);
            assertEq(actual.accountId, r.account);
            assertEq(actual.to, r.to);
            assertEq(actual.amount, r.amount);
            assertEq(uint256(actual.status), uint256(r.status));
            assertEq(uint256(actual.reason), uint256(r.reason));
            assertEq(actual.memo, "invariant");
            assertLe(r.settlements, 1);
        }
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 128
/// forge-config: default.invariant.fail-on-revert = true
contract AllowanceStatefulTest is StdInvariant, Test {
    AllowanceHandler handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        Allowance al = new Allowance();
        handler = new AllowanceHandler(al);
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = handler.open.selector;
        selectors[1] = handler.fund.selector;
        selectors[2] = handler.pay.selector;
        selectors[3] = handler.refuel.selector;
        selectors[4] = handler.withdraw.selector;
        selectors[5] = handler.resolve.selector;
        selectors[6] = handler.policy.selector;
        selectors[7] = handler.trust.selector;
        selectors[8] = handler.freeze.selector;
        selectors[9] = handler.rotate.selector;
        selectors[10] = handler.advance.selector;
        selectors[11] = handler.donate.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_referenceLedgerPermissionsAndBacking() public view {
        handler.assertState();
    }

    // Ensures the campaign is not relying on handlers that can only reject/no-op.
    function test_handlerScriptExercisesSuccessesDenialsAndOldRequests() public {
        handler.pay(0, 0, 10, 0);
        handler.refuel(0, 0, 10);
        handler.pay(3, 0, 10, 0);
        handler.pay(6, 0, 10, 0);
        handler.pay(0, 0, 60, 1); // request 0, over per-payment cap
        handler.freeze(0, 0, true);
        handler.pay(0, 0, 10, 0);
        handler.refuel(0, 0, 10);
        handler.rotate(0, 0, 1);
        handler.resolve(0, 2, 2); // revoked key cannot cancel its own old request
        handler.pay(0, 2, 10, 0);
        handler.refuel(0, 2, 10);
        handler.resolve(0, 0, 0); // owner approval despite freeze, then replay denial
        handler.resolve(0, 0, 0);
        handler.freeze(0, 0, false);
        handler.pay(0, 0, 60, 1); // current key cancels
        handler.resolve(1, 0, 2);
        handler.pay(0, 0, 60, 1); // owner rejects
        handler.resolve(2, 0, 1);
        handler.policy(0, 0, 91); // expiry at current time
        handler.pay(0, 0, 10, 0);
        handler.refuel(0, 0, 10);
        handler.policy(0, 0, 0);
        handler.trust(0, 0, 2, true);
        handler.advance(7200);
        handler.pay(0, 0, 10, 2);
        handler.withdraw(0, 0, 10);
        handler.withdraw(3, 1, 10);
        handler.fund(0, 0, 10);
        handler.fund(3, 0, 10);
        handler.open(12);
        handler.donate(0, 1);
        handler.donate(1, 1);
        handler.donate(2, 1);
        handler.assertState();
        assertGt(handler.instantCount(), 0);
        assertGt(handler.refuelCount(), 0);
        assertGt(handler.heldCount(), 0);
        assertGt(handler.approvedCount(), 0);
        assertGt(handler.cancelledCount(), 0);
        assertGt(handler.withdrawnCount(), 0);
        assertGt(handler.deniedCount(), 0);
        assertGt(handler.expiredDeniedCount(), 0);
        assertGt(handler.rotatedCount(), 0);
    }
}
