// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TripEscrow
 * @dev Handles group deposits and allows an AI Agent (SplitBot) to autonomously
 * disperse USDC to group members based on off-chain conversational logic.
 */
contract TripEscrow is Ownable, Pausable {
    IERC20 public stablecoin;
    address public splitBotAgent; // The ERC-8004 Agent's Wallet Identity
    
    mapping(address => uint256) public deposits;
    uint256 public totalPool;

    // A daily cap to prevent total drainage if the Agent's private key leaks (e.g. 500 USDC)
    uint256 public constant MAX_DAILY_SETTLE = 500 * 10**18; 
    mapping(uint256 => uint256) public dailySettleAmount;

    event Deposited(address indexed user, uint256 amount);
    event Settled(address indexed to, uint256 amount, string description);
    event AgentUpdated(address oldAgent, address newAgent);
    event Refunded(address indexed user, uint256 amount);

    constructor(address _stablecoinAddress, address _agentWallet) Ownable(msg.sender) {
        stablecoin = IERC20(_stablecoinAddress);
        splitBotAgent = _agentWallet;
    }

    modifier onlyAgentOrOwner() {
        require(msg.sender == splitBotAgent || msg.sender == owner(), "Not authorized Agent/Owner");
        _;
    }

    /**
     * Users lock USDC into the group trip pool
     */
    function deposit(uint256 amount) external whenNotPaused {
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");
        deposits[msg.sender] += amount;
        totalPool += amount;
        emit Deposited(msg.sender, amount);
    }

    /**
     * Agent calls this when someone says "Hey, I just paid $150 for the entire group's dinner"
     * Edge case: If Bob owes Alice $50 but only deposited $10, the Agent tracks the $40 shortfall off-chain
     * and only pulls $10 from Bob's mapping on-chain.
     */
    function settleExpense(address payee, uint256 amount, string calldata description) external onlyAgentOrOwner whenNotPaused {
        require(totalPool >= amount, "Insufficient funds in the Trip Escrow pool");
        
        // Anti-drain mechanism
        uint256 today = block.timestamp / 1 days;
        require(dailySettleAmount[today] + amount <= MAX_DAILY_SETTLE, "Daily Agent settle cap exceeded");
        dailySettleAmount[today] += amount;

        totalPool -= amount;
        require(stablecoin.transfer(payee, amount), "USDC reimburse transfer failed");
        
        emit Settled(payee, amount, description);
    }

    /**
     * Only the Agent or the Owner can initiate a withdrawal BEFORE the trip is over
     * This prevents bad actors from removing their money before paying for dinner.
     */
    function refundUser(address user, uint256 amount) external onlyAgentOrOwner {
        require(deposits[user] >= amount, "User does not have enough deposit left");
        deposits[user] -= amount;
        totalPool -= amount;
        
        require(stablecoin.transfer(user, amount), "Refund transfer failed");
        emit Refunded(user, amount);
    }

    /**
     * Allows organizing the replacement of a compromised agent
     */
    function updateAgent(address newAgent) external onlyOwner {
        emit AgentUpdated(splitBotAgent, newAgent);
        splitBotAgent = newAgent;
    }

    // Emergency circuit breakers
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
