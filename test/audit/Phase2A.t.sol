// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Audit-only local reproductions. These demonstrate current behavior, not proposed fixes.
import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {Allowance} from "../../src/Allowance.sol";
import {MockERC20} from "../mocks/MockTokens.sol";

contract AuditToken is MockERC20 {
    uint256 public surcharge;
    uint256 public recipientFee;
    address public collector;
    uint8 public mode; // 1 false, 2 no data, 3 malformed data, 4 reject, 5 dishonest no-op

    function configure(uint256 s, uint256 f, address c, uint8 m) external {
        surcharge = s;
        recipientFee = f;
        collector = c;
        mode = m;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (mode == 4) revert("blacklisted");
        if (mode == 5) return true;
        balanceOf[msg.sender] -= amount + surcharge;
        balanceOf[to] += amount - recipientFee;
        balanceOf[collector] += surcharge + recipientFee;
        if (mode == 1) return false;
        if (mode == 2) assembly { return(0, 0) }
        if (mode == 3) {
            assembly {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return true;
    }
}

// Share-based mock: a global negative rebase changes every holder's actual units.
contract AuditRebasingToken {
    mapping(address => uint256) public shares;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public index = 2;

    function balanceOf(address who) external view returns (uint256) {
        return shares[who] * index;
    }

    function mint(address who, uint256 amount) external {
        shares[who] += amount / index;
    }

    function rebaseDown() external {
        index = 1;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        shares[from] -= amount / index;
        shares[to] += amount / index;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        shares[msg.sender] -= amount / index;
        shares[to] += amount / index;
        return true;
    }
}

contract AuditInputToken is MockERC20 {
    uint8 public mode;

    function setMode(uint8 m) external {
        mode = m;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (mode == 1) return false;
        if (mode == 2) assembly { return(0, 0) }
        if (mode == 3) {
            assembly {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return true;
    }
}

contract AuditCallbackToken is MockERC20 {
    Allowance public al;
    uint256 public nestedAccount;
    bool public blocked;

    function run(Allowance target, uint256 id, uint256 other, address to) external {
        al = target;
        nestedAccount = other;
        al.pay(id, to, 10, "outer token");
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        (bool ok, bytes memory ret) = address(al).call(abi.encodeCall(al.pay, (nestedAccount, to, 1, "nested")));
        blocked = !ok && keccak256(ret) == keccak256(abi.encodeWithSelector(Allowance.Reentrancy.selector));
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AuditCallback {
    Allowance public al;
    uint256 public other;
    uint256 public blocked;

    constructor(Allowance target) {
        al = target;
    }

    function run(uint256 id, uint256 otherId) external {
        other = otherId;
        al.pay(id, address(this), 1, "outer");
    }

    receive() external payable {
        bytes[] memory calls = new bytes[](6);
        calls[0] = abi.encodeCall(al.pay, (other, address(this), 1, "nested"));
        calls[1] = abi.encodeCall(al.refuel, (other, 1));
        calls[2] = abi.encodeCall(al.withdraw, (other, 1, address(this)));
        calls[3] = abi.encodeCall(al.approve, (0, false));
        calls[4] = abi.encodeCall(al.fund, (other, 1));
        address[] memory none = new address[](0);
        calls[5] = abi.encodeCall(
            al.openAccount, (address(123), address(0), "nested", Allowance.Rules(1, 5, 1 days, 0, false), none, 0, 0)
        );
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = address(al).call(calls[i]);
            require(
                !ok && keccak256(ret) == keccak256(abi.encodeWithSelector(Allowance.Reentrancy.selector)),
                "unexpected callback outcome"
            );
            blocked++;
        }
    }
}

contract Phase2AAuditTest is Test {
    Allowance al;
    address owner = makeAddr("audit owner");
    address agent = makeAddr("audit agent");
    address otherOwner = makeAddr("other owner");
    address stranger = makeAddr("stranger");
    address shop = makeAddr("audit shop");

    function setUp() public {
        al = new Allowance();
        vm.deal(owner, 100 ether);
        vm.warp(1_700_000_000);
    }

    function rules() internal pure returns (Allowance.Rules memory) {
        return Allowance.Rules(1 ether, 5 ether, 1 days, 0, false);
    }

    function nativeAccount() internal returns (uint256) {
        address[] memory none = new address[](0);
        vm.prank(owner);
        return al.openAccount{value: 10 ether}(agent, address(0), "audit", rules(), none, 10 ether, 0);
    }

    function tokenAccount(MockERC20 t, address who, uint256 amount) internal returns (uint256 id) {
        address[] memory none = new address[](0);
        t.mint(who, amount);
        vm.startPrank(who);
        t.approve(address(al), type(uint256).max);
        id = al.openAccount(agent, address(t), "audit", rules(), none, amount, 0);
        vm.stopPrank();
    }

    function test_M01_senderSurchargeConsumesAnotherAccountsBacking() public {
        AuditToken t = new AuditToken();
        uint256 victim = tokenAccount(t, owner, 100);
        uint256 attacker = tokenAccount(t, otherOwner, 10);
        t.configure(10, 0, otherOwner, 0);
        vm.prank(otherOwner);
        al.withdraw(attacker, 10, otherOwner);
        (Allowance.Account memory v,) = al.getAccount(victim);
        assertEq(v.balance, 100);
        assertEq(t.balanceOf(address(al)), 90);
        assertEq(t.balanceOf(otherOwner), 20); // nominal deposit returned + fee diverted from pool
        t.configure(0, 0, otherOwner, 0);
        vm.prank(owner);
        vm.expectRevert();
        al.withdraw(victim, 100, owner);
        assertEq(t.balanceOf(address(al)), 90);
    }

    function test_M01_negativeRebaseMakesClaimsInsolventAndFirstWithdrawerWins() public {
        AuditRebasingToken t = new AuditRebasingToken();
        address[] memory none = new address[](0);
        t.mint(owner, 100);
        t.mint(otherOwner, 100);
        vm.startPrank(owner);
        t.approve(address(al), 100);
        uint256 a = al.openAccount(agent, address(t), "a", rules(), none, 100, 0);
        vm.stopPrank();
        vm.startPrank(otherOwner);
        t.approve(address(al), 100);
        uint256 b = al.openAccount(agent, address(t), "b", rules(), none, 100, 0);
        vm.stopPrank();
        t.rebaseDown();
        assertEq(t.balanceOf(address(al)), 100);
        (Allowance.Account memory aa,) = al.getAccount(a);
        (Allowance.Account memory bb,) = al.getAccount(b);
        assertEq(uint256(aa.balance) + bb.balance, 200);
        vm.prank(otherOwner);
        al.withdraw(b, 100, otherOwner);
        vm.prank(owner);
        vm.expectRevert();
        al.withdraw(a, 100, owner);
        assertEq(t.balanceOf(address(al)), 0);
        (aa,) = al.getAccount(a);
        assertEq(aa.balance, 100);
    }

    function test_L01_lifetimeCounterOverflowBlocksPayAndApproveButOwnerCanWithdraw() public {
        MockERC20 t = new MockERC20();
        uint256 id = tokenAccount(t, owner, type(uint128).max);
        Allowance.Rules memory r = rules();
        r.perPayment = type(uint128).max;
        r.perPeriod = type(uint128).max;
        vm.prank(owner);
        al.setRules(id, r);
        vm.prank(agent);
        al.pay(id, shop, type(uint128).max, "fill counter");
        t.mint(owner, 10);
        vm.prank(owner);
        al.fund(id, 10);
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vm.expectRevert(stdError.arithmeticError);
        al.pay(id, shop, 1, "overflow");
        r.perPayment = 1;
        vm.prank(owner);
        al.setRules(id, r);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2, "hold");
        vm.prank(owner);
        vm.expectRevert(stdError.arithmeticError);
        al.approve(rid, false);
        vm.prank(owner);
        al.withdraw(id, 10, owner);
        assertEq(t.balanceOf(owner), 10);
    }

    function test_I01_staleRequestsRequireOwnerButSurviveFreezeExpiryRotationAndRules() public {
        uint256 id = nativeAccount();
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "old request");
        vm.startPrank(owner);
        al.setFrozen(id, true);
        Allowance.Rules memory r = rules();
        r.expiresAt = uint64(block.timestamp);
        r.perPayment = 1;
        r.perPeriod = 1;
        al.setRules(id, r);
        al.rotateAgent(id, stranger);
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.cancel(rid);
        vm.prank(stranger);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.approve(rid, false);
        vm.prank(owner);
        al.approve(rid, false);
        assertEq(shop.balance, 2 ether);
        vm.prank(owner);
        vm.expectRevert(Allowance.NotPending.selector);
        al.approve(rid, false);
    }

    function test_I01_currentAgentCanCancelWhileFrozenAndExpired() public {
        uint256 id = nativeAccount();
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "cancel later");
        vm.startPrank(owner);
        al.setFrozen(id, true);
        Allowance.Rules memory r = rules();
        r.expiresAt = uint64(block.timestamp);
        al.setRules(id, r);
        vm.stopPrank();
        vm.prank(agent);
        al.cancel(rid);
        assertEq(uint256(al.getRequest(rid).status), uint256(Allowance.Status.Cancelled));
        vm.prank(owner); // freeze/expiry constrain agent, not owner
        al.withdraw(id, 10 ether, owner);
    }

    function test_I02_gasRefuelCanBeSpentAtUntrustedRecipientOutsideContract() public {
        uint256 id = nativeAccount();
        Allowance.Rules memory r = rules();
        r.trustedOnly = true;
        vm.prank(owner);
        al.setRules(id, r);
        vm.prank(agent);
        (bool settled,) = al.pay(id, stranger, 1 ether, "untrusted");
        assertFalse(settled);
        vm.prank(agent);
        al.refuel(id, 1 ether);
        vm.prank(agent);
        (bool ok,) = payable(stranger).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(stranger.balance, 1 ether);
        (, uint256 left) = al.getAccount(id);
        assertEq(left, 4 ether);
    }

    function test_I03_recipientFeeMeansPaidAmountIsGrossNotNet() public {
        AuditToken t = new AuditToken();
        uint256 id = tokenAccount(t, owner, 100);
        t.configure(0, 1, stranger, 0);
        vm.prank(agent);
        al.pay(id, shop, 10, "fee");
        assertEq(t.balanceOf(shop), 9);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 90);
        assertEq(t.balanceOf(address(al)), 90); // solvent; recipient received less
    }

    function test_I03_dishonestTrueReturnCanReportPaymentWithoutTransfer() public {
        AuditToken t = new AuditToken();
        uint256 id = tokenAccount(t, owner, 100);
        t.configure(0, 0, stranger, 5);
        vm.prank(agent);
        (bool settled,) = al.pay(id, shop, 10, "lying token");
        assertTrue(settled);
        assertEq(t.balanceOf(shop), 0);
        assertEq(t.balanceOf(address(al)), 100);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 90);
    }

    function test_I04_contractPreviewIsOnlyAHoldClassifier() public {
        uint256 id = nativeAccount();
        (Allowance.Hold h,) = al.preview(id, address(0), 0);
        assertEq(uint256(h), 0);
        vm.prank(agent);
        vm.expectRevert(Allowance.InvalidAddress.selector);
        al.pay(id, address(0), 0, "x");
        vm.prank(owner);
        al.setFrozen(id, true);
        (h,) = al.preview(id, shop, 1);
        assertEq(uint256(h), 0);
        vm.prank(agent);
        vm.expectRevert(Allowance.AccountFrozen.selector);
        al.pay(id, shop, 1, "x");
    }

    function test_tokenFalseMalformedAndBlacklistRevertAtomically_noDataWorks() public {
        AuditToken t = new AuditToken();
        uint256 id = tokenAccount(t, owner, 100);
        for (uint8 mode = 1; mode <= 4; mode++) {
            t.configure(0, 0, stranger, mode);
            vm.prank(agent);
            if (mode != 2) vm.expectRevert();
            al.pay(id, shop, 10, "return data");
        }
        assertEq(t.balanceOf(shop), 10);
        assertEq(t.balanceOf(address(al)), 90);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 90);
        assertEq(a.payments, 1);
    }

    function test_callbacksBlockAllSixFundMovingEntryPointsAcrossAccounts() public {
        AuditCallback probe = new AuditCallback(al);
        address[] memory none = new address[](0);
        vm.startPrank(owner);
        uint256 a = al.openAccount{value: 10}(address(probe), address(0), "a", rules(), none, 10, 0);
        uint256 b = al.openAccount{value: 10}(address(probe), address(0), "b", rules(), none, 10, 0);
        vm.stopPrank();
        probe.run(a, b);
        assertEq(probe.blocked(), 6);
        (Allowance.Account memory bb,) = al.getAccount(b);
        assertEq(bb.balance, 10);
    }

    function test_allOwnerEntryPointsRejectStranger() public {
        uint256 id = nativeAccount();
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "held");
        address[] memory to = new address[](1);
        to[0] = stranger;
        vm.startPrank(stranger);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.withdraw(id, 1, stranger);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.setRules(id, rules());
        vm.expectRevert(Allowance.NotOwner.selector);
        al.setTrusted(id, to, true);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.setFrozen(id, true);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.rotateAgent(id, stranger);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.approve(rid, false);
        vm.expectRevert(Allowance.NotOwner.selector);
        al.reject(rid);
        vm.stopPrank();
    }

    function test_unsolicitedTokensAreUncreditedAndStandardAccountsStayIsolated() public {
        MockERC20 t = new MockERC20();
        uint256 a = tokenAccount(t, owner, 100);
        uint256 b = tokenAccount(t, otherOwner, 100);
        t.mint(address(al), 10); // unsolicited transfer equivalent, no account specified
        vm.prank(otherOwner);
        al.withdraw(b, 100, otherOwner);
        vm.prank(owner);
        al.withdraw(a, 100, owner);
        assertEq(t.balanceOf(address(al)), 10);
        (Allowance.Account memory aa,) = al.getAccount(a);
        assertEq(aa.balance, 0);
    }

    function test_nativeAccountingConservesValueAndThirdPartyFundingGrantsNoRights() public {
        uint256 id = nativeAccount();
        vm.deal(stranger, 3 ether);
        vm.prank(stranger);
        al.fund{value: 3 ether}(id, 3 ether);
        vm.prank(agent);
        al.pay(id, shop, 1 ether, "instant");
        vm.prank(agent);
        al.refuel(id, 1 ether);
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "held");
        vm.prank(owner);
        al.approve(rid, false);
        vm.prank(owner);
        al.withdraw(id, 2 ether, owner);
        (Allowance.Account memory a, uint256 left) = al.getAccount(id);
        assertEq(a.balance, 7 ether);
        assertEq(address(al).balance, 7 ether);
        assertEq(a.totalSpent, 4 ether);
        assertEq(left, 3 ether);
        assertEq(13 ether, uint256(a.balance) + a.totalSpent + 2 ether);
        vm.prank(stranger);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.pay(id, stranger, 1, "x");
    }

    function test_incomingNoReturnWorksAndFalseMalformedRollBackOpenAndFund() public {
        AuditInputToken t = new AuditInputToken();
        for (uint8 mode = 1; mode <= 3; mode += 2) {
            t.setMode(mode);
            t.mint(owner, 100);
            vm.startPrank(owner);
            t.approve(address(al), type(uint256).max);
            address[] memory none = new address[](0);
            vm.expectRevert();
            al.openAccount(agent, address(t), "bad", rules(), none, 10, 0);
            vm.stopPrank();
            assertEq(al.accountCount(), 0);
            assertEq(t.balanceOf(address(al)), 0);
        }
        t.setMode(2);
        uint256 id = tokenAccount(t, owner, 100);
        (Allowance.Account memory a,) = al.getAccount(id);
        assertEq(a.balance, 100);
        for (uint8 mode = 1; mode <= 3; mode += 2) {
            t.setMode(mode);
            vm.prank(owner);
            vm.expectRevert();
            al.fund(id, 10);
            (a,) = al.getAccount(id);
            assertEq(a.balance, 100);
            assertEq(t.balanceOf(address(al)), 100);
        }
        t.setMode(2);
        vm.prank(owner);
        al.fund(id, 10);
        (a,) = al.getAccount(id);
        assertEq(a.balance, 110);
    }

    function test_tokenCallbackCannotReenterNativeAccountEvenWhenAuthorizedAgentOfBoth() public {
        AuditCallbackToken t = new AuditCallbackToken();
        uint256 id = tokenAccount(t, owner, 100);
        vm.prank(owner);
        al.rotateAgent(id, address(t));
        address[] memory none = new address[](0);
        vm.prank(owner);
        uint256 other = al.openAccount{value: 10}(address(t), address(0), "native", rules(), none, 10, 0);
        t.run(al, id, other, shop);
        assertTrue(t.blocked());
        assertEq(t.balanceOf(shop), 10);
        (Allowance.Account memory a,) = al.getAccount(other);
        assertEq(a.balance, 10);
    }

    function test_fixedWindowsPermitTwoLimitsNearBoundaryButNotWithinOneWindow() public {
        uint256 id = nativeAccount();
        (Allowance.Account memory a,) = al.getAccount(id);
        uint256 boundary = uint256(a.periodStart) + a.rules.period;
        vm.warp(boundary - 1);
        vm.startPrank(agent);
        for (uint256 i; i < 5; ++i) {
            al.pay(id, shop, 1 ether, "before");
        }
        (bool settled,) = al.pay(id, shop, 1 ether, "over");
        assertFalse(settled);
        vm.warp(boundary);
        for (uint256 i; i < 5; ++i) {
            al.pay(id, shop, 1 ether, "after");
        }
        vm.stopPrank();
        assertEq(shop.balance, 10 ether);
    }

    function test_revokedAgentCannotPayRefuelOrCancelOldRequest_newAgentCanCancel() public {
        uint256 id = nativeAccount();
        vm.prank(agent);
        (, uint256 rid) = al.pay(id, shop, 2 ether, "old");
        vm.prank(owner);
        al.rotateAgent(id, stranger);
        vm.startPrank(agent);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.pay(id, shop, 1, "old key");
        vm.expectRevert(Allowance.NotAgent.selector);
        al.refuel(id, 1);
        vm.expectRevert(Allowance.NotAgent.selector);
        al.cancel(rid);
        vm.stopPrank();
        vm.prank(stranger);
        al.cancel(rid);
        assertEq(uint256(al.getRequest(rid).status), uint256(Allowance.Status.Cancelled));
    }

    function test_exactExpiryBlocksInstantHeldAndRefuelButOwnerKeepsControl() public {
        uint256 id = nativeAccount();
        Allowance.Rules memory r = rules();
        r.expiresAt = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        al.setRules(id, r);
        vm.warp(r.expiresAt);
        vm.startPrank(agent);
        vm.expectRevert(Allowance.AccountExpired.selector);
        al.pay(id, shop, 1, "small");
        vm.expectRevert(Allowance.AccountExpired.selector);
        al.pay(id, shop, 2 ether, "held");
        vm.expectRevert(Allowance.AccountExpired.selector);
        al.refuel(id, 1);
        vm.stopPrank();
        vm.prank(owner);
        al.withdraw(id, 10 ether, owner);
    }
}
