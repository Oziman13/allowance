// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Allowance} from "../src/Allowance.sol";
import {MockERC20, FeeToken, FalseToken, Refuser} from "./mocks/MockTokens.sol";

/// Tries to re-enter Allowance when it receives a payment.
contract Reenterer {
    Allowance public al;
    uint256 public requestId;
    bool public attempted;
    bool public blocked;

    constructor(Allowance a) { al = a; }
    function arm(uint256 r) external { requestId = r; }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try al.approve(requestId, false) { blocked = false; } catch { blocked = true; }
    }
}

contract AllowanceTest is Test {
    Allowance al;
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address shop = makeAddr("shop");
    address stranger = makeAddr("stranger");

    uint128 constant PER_PAY = 1 ether;
    uint128 constant PER_PERIOD = 5 ether;
    uint64 constant DAY = 1 days;

    function setUp() public {
        al = new Allowance();
        vm.deal(owner, 1000 ether);
        vm.warp(1_700_000_000);
    }

    function _rules(bool trustedOnly) internal pure returns (Allowance.Rules memory) {
        return Allowance.Rules({perPayment: PER_PAY, perPeriod: PER_PERIOD, period: DAY, expiresAt: 0, trustedOnly: trustedOnly});
    }

    function _openNative(uint256 deposit, bool trustedOnly) internal returns (uint256 id) {
        address[] memory t = new address[](1);
        t[0] = shop;
        vm.prank(owner);
        id = al.openAccount{value: deposit + 0.1 ether}(agent, address(0), "research-bot", _rules(trustedOnly), t, deposit, 0.1 ether);
    }

    // ------------------------------------------------------------ opening & funding

    function test_open_native_depositsAndSeedsGas() public {
        uint256 id = _openNative(20 ether, false);
        (Allowance.Account memory a, uint256 left) = al.getAccount(id);
        assertEq(a.owner, owner);
        assertEq(a.agent, agent);
        assertEq(a.balance, 20 ether);
        assertEq(a.totalSpent, 0.1 ether);
        assertEq(agent.balance, 0.1 ether);
        assertEq(address(al).balance, 20 ether);
        assertEq(left, PER_PERIOD);
        assertTrue(al.isTrusted(id, shop));
        assertEq(al.accountsOfOwner(owner)[0], id);
        assertEq(al.accountsOfAgent(agent)[0], id);
    }

    function test_open_rejectsBadInput() public {
        address[] memory none;
        vm.startPrank(owner);
        vm.expectRevert(Allowance.InvalidAmount.selector);
        al.openAccount{value: 1 ether}(agent, address(0), "x", _rules(false), none, 2 ether, 0);

        Allowance.Rules memory bad = _rules(false);
        bad.perPayment = 6 ether; // > perPeriod
        vm.expectRevert(Allowance.InvalidRules.selector);
        al.openAccount(agent, address(0), "x", bad, none, 0, 0);

        bad = _rules(false);
        bad.period = 10 minutes;
        vm.expectRevert(Allowance.InvalidRules.selector);
        al.openAccount(agent, address(0), "x", bad, none, 0, 0);

        vm.expectRevert(Allowance.InvalidAddress.selector);
        al.openAccount(owner, address(0), "x", _rules(false), none, 0, 0);
        vm.stopPrank();
    }

    function test_fund_byAnyone() public {
        uint256 id = _openNative(1 ether, false);
        vm.deal(stranger, 3 ether);
        vm.prank(stranger);
        al.fund{value: 3 ether}(id, 3 ether);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 4 ether);
    }

    function test_withdraw_onlyOwner() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(stranger);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.withdraw(id, 1 ether, stranger);

        vm.prank(owner);
        al.withdraw(id, 4 ether, owner);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 6 ether);

        vm.prank(owner);
        vm.expectRevert(Allowance.InsufficientBudget.selector);
        al.withdraw(id, 7 ether, owner);
    }

    // ------------------------------------------------------------ paying

    function test_pay_withinRules_settlesInstantly() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(agent);
        (bool settled, uint256 rid) = al.pay(id, shop, 0.5 ether, "API credits");
        assertTrue(settled);
        assertEq(rid, 0);
        assertEq(shop.balance, 0.5 ether);
        (Allowance.Account memory a, uint256 left) = al.getAccount(id);
        assertEq(a.balance, 9.5 ether);
        assertEq(left, 4.5 ether);
        assertEq(a.payments, 1);
    }

    function test_pay_onlyAgent() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(stranger);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.pay(id, shop, 0.5 ether, "x");
    }

    function test_pay_overPerPayment_isHeld() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(agent);
        (bool settled, uint256 rid) = al.pay(id, shop, 2 ether, "GPU hour");
        assertFalse(settled);
        Allowance.Request memory r = al.getRequest(rid);
        assertEq(uint8(r.status), uint8(Allowance.Status.Pending));
        assertEq(uint8(r.reason), uint8(Allowance.Hold.OverPerPayment));
        assertEq(r.memo, "GPU hour");
        assertEq(shop.balance, 0);
    }

    function test_pay_overPeriod_isHeld_thenResetsNextPeriod() public {
        uint256 id = _openNative(20 ether, false);
        vm.startPrank(agent);
        for (uint256 i; i < 5; ++i) al.pay(id, shop, 1 ether, "batch");
        (bool settled, uint256 rid) = al.pay(id, shop, 1 ether, "one more");
        assertFalse(settled);
        assertEq(uint8(al.getRequest(rid).reason), uint8(Allowance.Hold.OverPeriodLimit));

        vm.warp(block.timestamp + DAY);
        (settled,) = al.pay(id, shop, 1 ether, "new day");
        assertTrue(settled);
        vm.stopPrank();
        assertEq(shop.balance, 6 ether);
    }

    function test_pay_untrustedRecipient_isHeld() public {
        uint256 id = _openNative(10 ether, true);
        vm.prank(agent);
        (bool settled, uint256 rid) = al.pay(id, stranger, 0.1 ether, "unknown site");
        assertFalse(settled);
        assertEq(uint8(al.getRequest(rid).reason), uint8(Allowance.Hold.UntrustedRecipient));

        vm.prank(agent);
        (settled,) = al.pay(id, shop, 0.1 ether, "trusted shop");
        assertTrue(settled);
    }

    function test_pay_insufficientBudget_reverts_butLargeRequestCanBeHeld() public {
        uint256 id = _openNative(0.5 ether, false);
        vm.prank(agent);
        vm.expectRevert(Allowance.InsufficientBudget.selector);
        al.pay(id, shop, 0.6 ether, "too much");

        // A held request may exceed the budget: the owner can top up and approve.
        vm.prank(agent);
        (bool settled, uint256 rid) = al.pay(id, shop, 3 ether, "big one");
        assertFalse(settled);
        vm.prank(owner);
        vm.expectRevert(Allowance.InsufficientBudget.selector);
        al.approve(rid, false);
        vm.startPrank(owner);
        al.fund{value: 3 ether}(id, 3 ether);
        al.approve(rid, false);
        vm.stopPrank();
        assertEq(shop.balance, 3 ether);
    }

    function test_preview_matchesPay() public {
        uint256 id = _openNative(10 ether, true);
        (Allowance.Hold h, uint256 left) = al.preview(id, shop, 0.5 ether);
        assertEq(uint8(h), uint8(Allowance.Hold.None));
        assertEq(left, PER_PERIOD);
        (h,) = al.preview(id, shop, 2 ether);
        assertEq(uint8(h), uint8(Allowance.Hold.OverPerPayment));
        (h,) = al.preview(id, stranger, 0.5 ether);
        assertEq(uint8(h), uint8(Allowance.Hold.UntrustedRecipient));
    }

    // ------------------------------------------------------------ approvals

    function test_approve_paysAndDoesNotUseThePeriodLimit() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 3 ether, "annual plan");
        vm.prank(owner);
        al.approve(rid, false);
        assertEq(shop.balance, 3 ether);
        (Allowance.Account memory a, uint256 left) = al.getAccount(id);
        assertEq(a.balance, 7 ether);
        assertEq(left, PER_PERIOD);
        assertEq(uint8(al.getRequest(rid).status), uint8(Allowance.Status.Approved));
    }

    function test_approveAndTrust_nextPaymentIsInstant() public {
        uint256 id = _openNative(10 ether, true);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, stranger, 0.2 ether, "new vendor");
        vm.prank(owner);
        al.approve(rid, true);
        assertTrue(al.isTrusted(id, stranger));
        vm.prank(agent);
        (bool settled,) = al.pay(id, stranger, 0.2 ether, "again");
        assertTrue(settled);
    }

    function test_resolvedRequestsAreFinal() public {
        uint256 id = _openNative(10 ether, false);
        vm.startPrank(agent);
        (, uint256 r1) = al.pay(id, shop, 2 ether, "a");
        (, uint256 r2) = al.pay(id, shop, 2 ether, "b");
        al.cancel(r2);
        vm.stopPrank();

        vm.startPrank(owner);
        al.reject(r1);
        vm.expectRevert(Allowance.NotPending.selector);
        al.approve(r1, false);
        vm.expectRevert(Allowance.NotPending.selector);
        al.approve(r2, false);
        vm.stopPrank();
        assertEq(shop.balance, 0);
    }

    function test_onlyOwnerResolves_onlyAgentCancels() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "x");
        vm.prank(agent);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.approve(rid, false);
        vm.prank(stranger);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.cancel(rid);
    }

    function test_approve_reentrancyBlocked() public {
        uint256 id = _openNative(10 ether, false);
        Reenterer evil = new Reenterer(al);
        vm.startPrank(agent);
        (, uint256 r1) = al.pay(id, address(evil), 2 ether, "first");
        (, uint256 r2) = al.pay(id, address(evil), 2 ether, "second");
        vm.stopPrank();
        evil.arm(r2);
        vm.prank(owner);
        al.approve(r1, false);
        assertTrue(evil.attempted());
        assertTrue(evil.blocked());
        assertEq(address(evil).balance, 2 ether);
        assertEq(uint8(al.getRequest(r2).status), uint8(Allowance.Status.Pending));
    }

    function test_refusingRecipient_revertsWholePayment() public {
        uint256 id = _openNative(10 ether, false);
        Refuser r = new Refuser();
        vm.prank(agent);
        vm.expectRevert(Allowance.TransferFailed.selector);
        al.pay(id, address(r), 0.5 ether, "x");
        (Allowance.Account memory a, uint256 left) = al.getAccount(id);
        assertEq(a.balance, 10 ether);
        assertEq(left, PER_PERIOD);
    }

    // ------------------------------------------------------------ safety controls

    function test_freeze_blocksEverythingTheAgentDoes() public {
        uint256 id = _openNative(10 ether, false);
        vm.prank(owner);
        al.setFrozen(id, true);
        vm.startPrank(agent);
        vm.expectRevert(Allowance.AccountFrozen.selector);
        al.pay(id, shop, 0.1 ether, "x");
        vm.expectRevert(Allowance.AccountFrozen.selector);
        al.pay(id, shop, 3 ether, "ask");
        vm.expectRevert(Allowance.AccountFrozen.selector);
        al.refuel(id, 0.1 ether);
        vm.stopPrank();

        vm.prank(owner);
        al.setFrozen(id, false);
        vm.prank(agent);
        (bool settled,) = al.pay(id, shop, 0.1 ether, "back");
        assertTrue(settled);
    }

    function test_expiry_endsTheSession() public {
        uint256 id = _openNative(10 ether, false);
        Allowance.Rules memory r = _rules(false);
        r.expiresAt = uint64(block.timestamp + 2 hours);
        vm.prank(owner);
        al.setRules(id, r);
        vm.prank(agent);
        al.pay(id, shop, 0.1 ether, "ok");
        vm.warp(block.timestamp + 2 hours);
        vm.prank(agent);
        vm.expectRevert(Allowance.AccountExpired.selector);
        al.pay(id, shop, 0.1 ether, "late");
    }

    function test_rotateAgent_oldKeyIsLockedOut() public {
        uint256 id = _openNative(10 ether, false);
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        al.rotateAgent(id, newAgent);
        vm.prank(agent);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.pay(id, shop, 0.1 ether, "old key");
        vm.prank(newAgent);
        (bool settled,) = al.pay(id, shop, 0.1 ether, "new key");
        assertTrue(settled);
    }

    function test_untrust_removesInstantAccess() public {
        uint256 id = _openNative(10 ether, true);
        address[] memory s = new address[](1);
        s[0] = shop;
        vm.prank(owner);
        al.setTrusted(id, s, false);
        vm.prank(agent);
        (bool settled,) = al.pay(id, shop, 0.1 ether, "x");
        assertFalse(settled);
    }

    // ------------------------------------------------------------ gas refuel

    function test_refuel_countsAgainstTheSameLimit() public {
        uint256 id = _openNative(20 ether, false);
        vm.startPrank(agent);
        al.refuel(id, 1 ether);
        for (uint256 i; i < 4; ++i) al.pay(id, shop, 1 ether, "x");
        vm.expectRevert(abi.encodeWithSelector(Allowance.OutsideRules.selector, Allowance.Hold.OverPeriodLimit));
        al.refuel(id, 0.5 ether);
        vm.expectRevert(abi.encodeWithSelector(Allowance.OutsideRules.selector, Allowance.Hold.OverPerPayment));
        al.refuel(id, 2 ether);
        vm.stopPrank();
        (, uint256 left) = al.getAccount(id);
        assertEq(left, 0);
        assertEq(agent.balance, 1.1 ether);
    }

    // ------------------------------------------------------------ ERC-20 accounts

    function _openToken(MockERC20 t, uint256 deposit) internal returns (uint256 id) {
        address[] memory none;
        t.mint(owner, 100e6);
        vm.startPrank(owner);
        t.approve(address(al), type(uint256).max);
        Allowance.Rules memory r =
            Allowance.Rules({perPayment: 1e6, perPeriod: 5e6, period: 30 days, expiresAt: 0, trustedOnly: false});
        id = al.openAccount(agent, address(t), "subscriptions", r, none, deposit, 0);
        vm.stopPrank();
    }

    function test_erc20_account_paysAndHolds() public {
        MockERC20 t = new MockERC20();
        uint256 id = _openToken(t, 20e6);
        vm.prank(agent);
        (bool settled,) = al.pay(id, shop, 0.99e6, "monthly SaaS");
        assertTrue(settled);
        assertEq(t.balanceOf(shop), 0.99e6);
        vm.prank(agent);
        (settled,) = al.pay(id, shop, 2e6, "upgrade");
        assertFalse(settled);
    }

    function test_erc20_rejectsNativeValueAndRefuel() public {
        MockERC20 t = new MockERC20();
        uint256 id = _openToken(t, 20e6);
        vm.prank(agent);
        vm.expectRevert(Allowance.NativeOnly.selector);
        al.refuel(id, 1);
        vm.prank(owner);
        vm.expectRevert(Allowance.NativeOnly.selector);
        al.fund{value: 1}(id, 1);
    }

    function test_erc20_feeOnTransfer_creditsWhatArrived() public {
        FeeToken t = new FeeToken();
        uint256 id = _openToken(t, 10e6);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 9.9e6);
    }

    function test_erc20_falseReturn_reverts() public {
        FalseToken t = new FalseToken();
        uint256 id = _openToken(t, 10e6);
        t.setFail(true);
        vm.prank(agent);
        vm.expectRevert(Allowance.TransferFailed.selector);
        al.pay(id, shop, 0.5e6, "x");
    }

    // ------------------------------------------------------------ the core guarantee

    /// Across random sequences of payments, refuels and time jumps, money that leaves an account
    /// without an owner approval never exceeds `perPeriod` within any single period.
    function testFuzz_instantSpendingNeverExceedsPeriodLimit(uint256 seed) public {
        uint256 id = _openNative(500 ether, false);
        uint256 periodStart = block.timestamp;
        uint256 spentThisPeriod;
        for (uint256 i; i < 40; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = (seed % 1.5 ether) + 1;
            uint256 jump = (seed >> 64) % 8 hours;
            vm.warp(block.timestamp + jump);
            uint256 before = address(al).balance;
            vm.prank(agent);
            if ((seed >> 128) % 4 == 0) {
                try al.refuel(id, amount) {} catch {}
            } else {
                try al.pay(id, shop, amount, "fuzz") {} catch {}
            }
            (Allowance.Account memory a,) = al.getAccount(id);
            if (a.periodStart != periodStart) {
                periodStart = a.periodStart;
                spentThisPeriod = 0;
            }
            spentThisPeriod += before - address(al).balance;
            assertLe(spentThisPeriod, PER_PERIOD);
        }
    }
}
