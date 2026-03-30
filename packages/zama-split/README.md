# Confidential split ledger (Zama fhEVM)

This folder documents the **Zama Protocol** slice for PL Genesis: encrypted balances / owed amounts on a public chain.

## Requirements

- Follow [Zama Protocol docs](https://docs.zama.org/protocol) and the [Solidity quick start](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial).
- Install the FHEVM toolchain (`@fhevm/solidity`, relayer, correct Solidity version) as specified in Zama’s current release.

## Intended design

- `ConfidentialSplitLedger.sol` (to be compiled with fhEVM): stores per-participant encrypted amounts (`euint64`) and supports homomorphic aggregation for “who owes whom” without revealing raw inputs on-chain.
- Link to Celo `TripEscrow`: public escrow holds USDC; fhEVM ledger holds **confidential** debt vectors; settlement proofs or operator attestations bridge the two.

## Demo client

See `src/demoCommit.ts` for a minimal **commitment** flow you can run without fhEVM (hash-based stand-in). Replace with Zama relayer SDK + `euint` contracts once the network is configured.

## Networks

Use the Zama test network / relayer from the official docs; do not assume Celo RPC for fhEVM execution.
