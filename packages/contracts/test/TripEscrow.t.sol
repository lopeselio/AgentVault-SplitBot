// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TripEscrow.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract TripEscrowTest is Test {
    TripEscrow public escrow;
    MockERC20 public token;
    address agent = address(0xA11CE);
    address alice = address(0xA11);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockERC20();
        vm.prank(address(this));
        escrow = new TripEscrow(address(token), agent);
        token.mint(alice, 1000e18);
        token.mint(bob, 1000e18);
        vm.prank(alice);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(bob);
        token.approve(address(escrow), type(uint256).max);
    }

    function test_DepositIncreasesPool() public {
        vm.prank(alice);
        escrow.deposit(100e18);
        assertEq(escrow.deposits(alice), 100e18);
        assertEq(escrow.totalPool(), 100e18);
    }

    function test_AgentSettles() public {
        vm.prank(alice);
        escrow.deposit(200e18);
        vm.prank(agent);
        escrow.settleExpense(bob, 50e18, "test");
        assertEq(token.balanceOf(bob), 1000e18 + 50e18);
        assertEq(escrow.totalPool(), 150e18);
    }
}
