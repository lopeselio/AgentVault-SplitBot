// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TripEscrow.sol";

contract Deploy is Script {
    function run() external {
        // Forge natively reads from .env
        uint256 deployerPrivateKey = vm.envUint("AGENT_WALLET_PRIVATE_KEY");
        address agentAddress = vm.addr(deployerPrivateKey);
        
        vm.startBroadcast(deployerPrivateKey);

        // 1st arg: Celo Sepolia USDC
        // 2nd arg: SplitBot Agent Identity
        TripEscrow escrow = new TripEscrow(0x01C5C0122039549AD1493B8220cABEdD739BC44E, agentAddress);

        vm.stopBroadcast();
        
        console.log(unicode"✅ TripEscrow officially deployed to Celo Sepolia at:");
        console.logAddress(address(escrow));
    }
}
