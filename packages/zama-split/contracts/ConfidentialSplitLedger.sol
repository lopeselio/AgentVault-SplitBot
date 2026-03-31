// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title ConfidentialSplitLedger
 * @notice Zama fhEVM contract to track encrypted credits and debts for a group trip.
 * @dev Deployed on Ethereum Sepolia. Uses FHE.add homomorphic arithmetic. 
 * Provides an asynchronous KMS public decryption flow for settlement.
 */
contract ConfidentialSplitLedger is ZamaEthereumConfig {
    
    // Mapping from tripId => (user => encrypted amount)
    mapping(bytes32 => mapping(address => euint32)) private _credits;
    mapping(bytes32 => mapping(address => euint32)) private _debts;

    mapping(bytes32 => bool) public isTripFinalized;

    event SettleDecryptionRequested(bytes32 indexed tripId, address[] users);
    event TripFinalized(bytes32 indexed tripId);

    modifier onlyActiveTrip(bytes32 tripId) {
        require(!isTripFinalized[tripId], "Trip already finalized");
        _;
    }

    /// @notice Initialize a user's balances for a trip to 0 (if not already initialized)
    function initUser(bytes32 tripId, address user) public onlyActiveTrip(tripId) {
        if (!FHE.isInitialized(_credits[tripId][user])) {
            _credits[tripId][user] = FHE.asEuint32(0);
            FHE.allowThis(_credits[tripId][user]); // allow contract to use it
        }
        if (!FHE.isInitialized(_debts[tripId][user])) {
            _debts[tripId][user] = FHE.asEuint32(0);
            FHE.allowThis(_debts[tripId][user]);
        }
    }

    /// @notice Add an encrypted credit to the user (e.g. they paid for the group's dinner)
    function addEncryptedCredit(bytes32 tripId, address user, externalEuint32 deltaCredit, bytes calldata inputProof) external onlyActiveTrip(tripId) {
        initUser(tripId, user);
        euint32 amt = FHE.fromExternal(deltaCredit, inputProof);
        _credits[tripId][user] = FHE.add(_credits[tripId][user], amt);
        FHE.allowThis(_credits[tripId][user]);
    }

    /// @notice Add an encrypted debt to the user (e.g. their split share of the dinner)
    function addEncryptedDebt(bytes32 tripId, address user, externalEuint32 deltaDebt, bytes calldata inputProof) external onlyActiveTrip(tripId) {
        initUser(tripId, user);
        euint32 amt = FHE.fromExternal(deltaDebt, inputProof);
        _debts[tripId][user] = FHE.add(_debts[tripId][user], amt);
        FHE.allowThis(_debts[tripId][user]);
    }

    /// @notice Step 1 of Decryption Flow: Make the balances publicly decryptable by Zama KMS Oracle
    function requestSettlement(bytes32 tripId, address[] calldata users) external onlyActiveTrip(tripId) {
        for (uint i = 0; i < users.length; i++) {
            // Ensure they are initialized so we don't revert on decryption
            require(FHE.isInitialized(_credits[tripId][users[i]]), "User not initialized");
            
            // Mark as globally readable by the off-chain relayer SDK
            FHE.makePubliclyDecryptable(_credits[tripId][users[i]]);
            FHE.makePubliclyDecryptable(_debts[tripId][users[i]]);
        }
        emit SettleDecryptionRequested(tripId, users);
    }

    /// @notice Step 3 of Decryption Flow: The Oracle submits the cleartext and KMS decryption proof
    function finalizeSettlement(
        bytes32 tripId,
        address[] calldata users,
        bytes memory abiEncodedCleartexts,
        bytes memory decryptionProof
    ) external onlyActiveTrip(tripId) {
        // Collect the handles in the EXACT SAME ORDER they were marked for decryption
        // Order: user0 credit, user0 debt, user1 credit, user1 debt...
        bytes32[] memory handles = new bytes32[](users.length * 2);
        for (uint i = 0; i < users.length; i++) {
            handles[i * 2] = FHE.toBytes32(_credits[tripId][users[i]]);
            handles[(i * 2) + 1] = FHE.toBytes32(_debts[tripId][users[i]]);
        }

        // Verify the KMS proof
        // Reverts if the proof is invalid, ensuring the cleartexts provided are mathematically correct!
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);

        isTripFinalized[tripId] = true;
        // Emit finalization event - observers can now trust the bot's cleartext settlement execution on Celo
        emit TripFinalized(tripId);
    }
}
