// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CommsStake
 * @dev Minimal stake for fee-gated agent mesh relay (Filecoin / P2P bounty prototype).
 * Peers must hold stakeWei > 0 to be trusted for gossip (checked off-chain by SplitBot).
 */
contract CommsStake {
    mapping(address => uint256) public stakeWei;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    function stake() external payable {
        stakeWei[msg.sender] += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(stakeWei[msg.sender] >= amount, "insufficient stake");
        stakeWei[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
