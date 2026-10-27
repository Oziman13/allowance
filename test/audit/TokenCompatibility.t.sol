// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Allowance} from "../../src/Allowance.sol";
import {MockERC20, FeeToken} from "../mocks/MockTokens.sol";
import {AuditToken, AuditInputToken, AuditCallbackToken} from "./Phase2A.t.sol";

// Honest state transitions with empty return data on BOTH transfer directions.
contract MatrixNoReturnToken is MockERC20 {
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        assembly { return(0, 0) }
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        assembly { return(0, 0) }
    }
}

// Shares are observable, index changes are global; all test amounts are exactly divisible.
contract MatrixPositiveRebaseToken {
    mapping(address => uint256) public shares;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public index = 1;
    bool public duringDeposit;

    function balanceOf(address who) external view returns (uint256) {
        return shares[who] * index;
    }

    function mint(address who, uint256 amount) external {
        shares[who] += amount / index;
    }

    function rebaseUp() external {
        index *= 2;
    }

    function setDuringDeposit(bool value) external {
        duringDeposit = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        shares[from] -= amount / index;
        shares[to] += amount / index;
        if (duringDeposit) index *= 2;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(amount % index == 0, "fractional share");
        shares[msg.sender] -= amount / index;
        shares[to] += amount / index;
        return true;
    }
}

contract TokenCompatibilityTest is Test {
    Allowance al;
    address owner = address(0x5101);
    address second = address(0x5102);
    address agent = address(0x5201);
    address recipient = address(0x5301);

    function setUp() public {
        al = new Allowance();
        vm.warp(1_700_000_000);
    }

    function _rules() internal pure returns (Allowance.Rules memory) {
        return Allowance.Rules(50, 200, 1 days, 0, false);
    }

    function _open(MockERC20 t, uint256 amount) internal returns (uint256 id) {
        t.mint(owner, 1000);
        vm.startPrank(owner);
        t.approve(address(al), type(uint256).max);
        address[] memory none = new address[](0);
        id = al.openAccount(agent, address(t), "matrix", _rules(), none, amount, 0);
        vm.stopPrank();
    }

    function _budget(uint256 id) internal view returns (uint256) {
        (Allowance.Account memory a,) = al.getAccount(id);
        return a.balance;
    }

    function _roundTrip(MockERC20 t) internal {
        uint256 id = _open(t, 100);
        vm.prank(owner);
        al.fund(id, 20);
        assertEq(_budget(id), 120);
        assertEq(t.balanceOf(address(al)), 120);
        vm.prank(agent);
        (bool settled,) = al.pay(id, recipient, 10, "matrix");
        assertTrue(settled);
        assertEq(t.balanceOf(recipient), 10);
        assertEq(_budget(id), 110);
        uint256 before = t.balanceOf(owner);
        vm.prank(owner);
        al.withdraw(id, 110, owner);
        assertEq(t.balanceOf(owner) - before, 110);
        assertEq(_budget(id), 0);
        assertEq(t.balanceOf(address(al)), 0);
    }

    function test_standardTokenDepositFundPayWithdraw() public {
        _roundTrip(new MockERC20());
    }

    function test_honestNoReturnOnBothDirectionsDepositFundPayWithdraw() public {
        _roundTrip(new MatrixNoReturnToken());
    }

    function test_inboundRecipientFeeCreditsDeltaAndAllowsFullCreditedWithdrawal() public {
        FeeToken t = new FeeToken();
        uint256 id = _open(t, 100);
        assertEq(_budget(id), 99);
        vm.prank(owner);
        al.fund(id, 100);
        assertEq(_budget(id), 198);
        assertEq(t.balanceOf(address(al)), 198);
        vm.prank(agent);
        al.pay(id, recipient, 10, "fee");
        assertEq(t.balanceOf(recipient), 10);
        uint256 before = t.balanceOf(owner);
        vm.prank(owner);
        al.withdraw(id, 188, owner);
        assertEq(t.balanceOf(owner) - before, 188);
        assertEq(t.balanceOf(address(al)), 0);
        assertEq(_budget(id), 0); // this particular mock charges ONLY transferFrom, not all fee tokens
    }

    function test_outboundRecipientFeeKeepsBackingButReducesPaymentAndWithdrawalReceipt() public {
        AuditToken t = new AuditToken();
        uint256 id = _open(t, 100);
        t.configure(0, 1, second, 0);
        vm.prank(agent);
        al.pay(id, recipient, 10, "gross ten");
        assertEq(t.balanceOf(recipient), 9);
        assertEq(_budget(id), 90);
        assertEq(t.balanceOf(address(al)), 90);
        uint256 before = t.balanceOf(owner);
        vm.prank(owner);
        al.withdraw(id, 90, owner);
        assertEq(t.balanceOf(owner) - before, 89);
        assertEq(_budget(id), 0);
        assertEq(t.balanceOf(address(al)), 0);
    }

    function _badReturns(uint8 mode) internal {
        AuditInputToken input = new AuditInputToken();
        uint256 inputId = _open(input, 100);
        input.setMode(mode);
        vm.prank(owner);
        vm.expectRevert();
        al.fund(inputId, 10);
        assertEq(_budget(inputId), 100);
        assertEq(input.balanceOf(address(al)), 100);
        AuditToken output = new AuditToken();
        uint256 outputId = _open(output, 100);
        output.configure(0, 0, second, mode);
        vm.prank(owner);
        vm.expectRevert();
        al.withdraw(outputId, 100, owner);
        assertEq(_budget(outputId), 100);
        assertEq(output.balanceOf(address(al)), 100);
        output.configure(0, 0, second, 0);
        vm.prank(owner);
        al.withdraw(outputId, 100, owner);
        assertEq(_budget(outputId), 0);
    }

    function test_falseReturnsDoNotCreditDepositsOrDebitFailedWithdrawals() public {
        _badReturns(1);
    }

    function test_malformedReturnsDoNotCreditDepositsOrDebitFailedWithdrawals() public {
        _badReturns(3);
    }

    function test_blacklistRevertsPayApprovalAndWithdrawalWithoutAccountingLoss() public {
        AuditToken t = new AuditToken();
        uint256 id = _open(t, 100);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, recipient, 60, "held");
        t.configure(0, 0, second, 4);
        vm.prank(agent);
        vm.expectRevert();
        al.pay(id, recipient, 10, "blocked");
        vm.prank(owner);
        vm.expectRevert();
        al.approve(rid, false);
        assertEq(uint256(al.getRequest(rid).status), uint256(Allowance.Status.Pending));
        vm.prank(owner);
        vm.expectRevert();
        al.withdraw(id, 100, owner);
        assertEq(_budget(id), 100);
        assertEq(t.balanceOf(address(al)), 100);
        assertEq(t.balanceOf(recipient), 0);
        t.configure(0, 0, second, 0);
        vm.prank(owner);
        al.withdraw(id, 100, owner);
        assertEq(_budget(id), 0);
    }

    function test_callbackTokenWithdrawalSucceedsWithoutReenteringOtherAsset() public {
        AuditCallbackToken t = new AuditCallbackToken();
        uint256 id = _open(t, 100);
        vm.prank(owner);
        al.rotateAgent(id, address(t));
        address[] memory none = new address[](0);
        vm.deal(owner, 10);
        vm.prank(owner);
        uint256 nativeId = al.openAccount{value: 10}(address(t), address(0), "callback", _rules(), none, 10, 0);
        t.run(al, id, nativeId, recipient);
        assertTrue(t.blocked());
        uint256 before = t.balanceOf(owner);
        vm.prank(owner);
        al.withdraw(id, 90, owner);
        assertTrue(t.blocked());
        assertEq(t.balanceOf(owner) - before, 90);
        assertEq(_budget(id), 0);
        assertEq(_budget(nativeId), 10);
        assertEq(address(al).balance, 10);
    }

    function _openRebase(MatrixPositiveRebaseToken t, address who, uint256 amount) internal returns (uint256 id) {
        t.mint(who, amount);
        address[] memory none = new address[](0);
        vm.startPrank(who);
        t.approve(address(al), type(uint256).max);
        id = al.openAccount(agent, address(t), "rebase", _rules(), none, amount, 0);
        vm.stopPrank();
    }

    function test_positiveRebaseOutsideFundingLeavesUnallocatedSurplus() public {
        MatrixPositiveRebaseToken t = new MatrixPositiveRebaseToken();
        uint256 a = _openRebase(t, owner, 100);
        uint256 b = _openRebase(t, second, 100);
        t.rebaseUp();
        assertEq(t.balanceOf(address(al)), 400);
        assertEq(_budget(a) + _budget(b), 200);
        vm.prank(owner);
        al.withdraw(a, 100, owner);
        vm.prank(second);
        al.withdraw(b, 100, second);
        assertEq(t.balanceOf(address(al)), 200);
        assertEq(_budget(a) + _budget(b), 0);
    }

    function test_positiveRebaseInsideFundingCreditsOtherAccountsYieldToFunder() public {
        MatrixPositiveRebaseToken t = new MatrixPositiveRebaseToken();
        uint256 victim = _openRebase(t, owner, 100);
        uint256 funder = _openRebase(t, second, 0);
        t.mint(second, 1);
        t.setDuringDeposit(true);
        vm.prank(second);
        al.fund(funder, 1);
        assertEq(t.balanceOf(address(al)), 202);
        assertEq(_budget(victim), 100);
        assertEq(_budget(funder), 102);
        // Deposit one unit; funding receives the 100-unit pool yield plus its rebased two units.
        vm.prank(second);
        al.withdraw(funder, 102, second);
        assertEq(t.balanceOf(second), 102);
        assertEq(t.balanceOf(address(al)), 100);
        assertEq(_budget(victim), 100); // nominal victim principal still backed; yield attribution was lost
    }
}
