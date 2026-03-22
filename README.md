# 🌟 Celo Hackathon: AgentVault + SplitBot

### [ Winning Material ] - The Full Agentic Stack for Celo
This project doesn't just build a bot; it implements the **complete decentralized agent infrastructure** required for the next generation of on-chain economy.

- **🆔 Official Identity (ERC-8004)**: SplitBot is an officially registered Celo Agent (**Agent #222**). It owns an on-chain NFT identity, enabling discovery and trust across the global agent mesh.
- **👮 Autonomous Slashing (Enforcement)**: Unlike traditional bots, this agent can enforce its own financial logic. If a user defaults on a payment calculated by the AI, the agent can autonomously "slash" their on-chain deposit via `TripEscrow.sol`.
- **🌐 Agent Mesh (libp2p)**: Features a built-in P2P communication layer. The agent "gossips" with other nodes in a decentralized mesh, ensuring coordination even without central servers.
- **🛡️ Multimodal Enclave (Lit TEE)**: Financial settlements are signed via **Threshold Cryptography** inside a Lit Protocol Trusted Execution Environment (TEE). The agent's private key never exists in one place, making it trustless and leak-proof.

---

## 🚀 Project Overview

1.  **AgentVault (Infrastructure)**: A persistent, encrypted memory service. Uses IPFS for storage, Lit Protocol for access control, and Thirdweb x402 for micropayment barriers.
2.  **SplitBot (Application)**: A multimodal Telegram agent that manages trip expenses using **Gemini 1.5 Flash** for voice/text parsing and on-chain debt settlement.

---

## 🏗️ System Architecture

```mermaid
graph TD
    A[Human Users] -->|Deposit USDC| B(TripEscrow.sol)
    A -->|Telegram Voice/Text| C[SplitBot Agent #222]
    
    C -->|Secure Session Sigs| L[Lit Protocol TEE]
    L -->|Threshold Sign| B
    
    C -->|P2P Gossip| G[libp2p Agent Mesh]
    C -->|Encrypted Memory| D[(AgentVault IPFS)]
    
    B -->|Transfers USDC| E[Payee Wallet]
    B -.->|If Default| S[Slashing Protocol]
```

---

## 📜 Smart Contracts

The `TripEscrow.sol` contract manages group funds with integrated agent permissions.

| Contract | Network | Address / Identity |
| :--- | :--- | :--- |
| **TripEscrow** | 🟢 Celo Sepolia | [`0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29`](https://sepolia.celoscan.io/address/0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29) |
| **TripEscrow** | 🔵 Celo Mainnet | [`0xD43Bb3a001Ff360e28051d27363f8967E4a4C147`](https://celoscan.io/address/0xD43Bb3a001Ff360e28051d27363f8967E4a4C147) |
| **Agent Identity** | 🆔 [AgentScan](https://agentscan.info/agent/3549) | **Official Agent ID #3549** (ERC-8004 Mainnet) |

### 🆔 ERC-8004: Agent Trust & Reputation
SplitBot follows the **ERC-8004** standard for decentralized AI agents. This protocol enables our agent to:
- **Universal Discovery**: Using its portable NFT identity (**Agent #3549**), other agents on Celo can discover and interact with SplitBot's endpoints.
- **On-Chain Reputation**: Every successfully settled trip contributes to a verifiable "starred" reputation on the Celo blockchain, making the agent's reliability transparent to the entire ecosystem.
- **Trustless Identity**: The agent's identity is cryptographically linked to its wallet, allowing for secure threshold signing via Lit Protocol.

### Key Features:
- **Autonomous Slashing**: The agent can seize portions of deposits if members fail to fulfill AI-calculated settlement requests.
- **AI Settlement Oracle**: SplitBot acts as an off-chain oracle using secure signatures.
- **Anti-Drain Caps**: 500 USDC daily settlement limit to prevent total loss in case of logic exploits.


---

### 📜 Smart Contract Architecture

The `TripEscrow.sol` contract serves as the decentralized settlement layer for all group financial interactions. It acts as a non-custodial vault where funds are managed by the **SplitBot Agent's** verifiable logic.

```mermaid
graph TD
    User(("User"))
    Agent["SplitBot Agent"]
    Contract{{"TripEscrow.sol<br/>(Celo Sepolia)"}}
    
    subgraph "Main Functions"
        User -->|"deposit() / USDC"| D["USDC Escrow Pool"]
        Agent -->|"settleExpense()"| S["Reimburse Payee"]
        Agent -->|"slashUser()"| SL["Penalize Defaulter"]
        Agent -->|"refundUser()"| RF["Return Funds"]
    end

    subgraph "Edge Cases & Security Guards"
        D -.-> E1{"Allowance == 0?"}
        E1 -->|"No"| FAIL1["Revert: Transfer Failed"]
        
        S -.-> E2{"TotalPool < Amount?"}
        E2 -->|"Yes"| FAIL2["Revert: Insufficient Pool"]
        
        S -.-> E3{"Amount > $500?"}
        E3 -->|"Yes"| FAIL3["Revert: Daily Cap Exceeded"]
        
        SL -.-> E4{"UserDeposit < Amount?"}
        E4 -->|"Yes"| FAIL4["Revert: Insufficient Deposit"]
        
        RF -.-> E5{"UserDeposit < Amount?"}
        E5 -->|"Yes"| FAIL5["Revert: Insufficient Deposit"]
        
        Contract -.-> E6{"isPaused?"}
        E6 -->|"Yes"| FAIL6["Revert: Pausable"]
    end

    style D fill:#f9f,stroke:#333
    style FAIL1 fill:#ff9999,stroke:#b22
    style FAIL2 fill:#ff9999,stroke:#b22
    style FAIL3 fill:#ff9999,stroke:#b22
    style FAIL4 fill:#ff9999,stroke:#b22
    style FAIL5 fill:#ff9999,stroke:#b22
    style FAIL6 fill:#ff9999,stroke:#b22
```

### High-Level Logic Overview:
- **Trustless P2P Settlement**: Users deposit USDC into the vault. The agent uses AI to parse conversational debt and generates **Lit TEE session signatures** to authorize payouts directly to creditors, bypassing manual bank transfers.
- **Autonomous Slashing (Game Theory Enforcement)**: If the group agrees on a debt but a member refuses to pay, the Agent can invoke `slashUser()`. This moves the offender's deposit into the collective pool for redistribution, programmatically enforcing social contracts.
- **Safe-Stop Mechanics**:
    - **Anti-Drain Cap**: A hardcoded limit prevents the Agent from settling more than **500 USDC per day**, protecting the group from logic bugs or unauthorized drenches.
    - **Pausability**: The contract owner can instantly freeze all operations in case of a suspected emergency.
- **ERC-8004 Identity**: The contract only accepts commands from the verified **SplitBot Agent Identity (#222)**, ensuring that only the decentralized node with the correct TEE credentials can move money.

---

### ✈️ Real-World Scenario: The "Bali Trip" 🥥

Imagine three friends—**Alice, Bob, and Charlie**—on a 3-day trip to Bali.

1.  **Trustless Deposit**: Each friend deposits **100 USDC** into the `TripEscrow` at the start of the trip. The pool now contains **300 USDC**.
2.  **Conversational Logging**:
    *   Alice pays **$150** for the Airbnb and sends a voice note: *"Hey SplitBot, Airbnb was $150."*
    *   The Agent calculates that each person's share is $50. Since Alice already paid $150, the group owes her $100.
3.  **Autonomous Settlement**:
    *   Alice triggers `/settle`.
    *   The Agent, running inside a **Lit Enclave**, verifies the debts and calls `settleExpense(Alice, 100 USDC)`.
    *   **Alice is instantly reimbursed** $100 from the escrow pool. Her net spend is now exactly her fair share ($50).
4.  **The Penalty (Game Theory in Action)**:
    *   If Bob refuses to confirm his registry or "ghosts" the group, the Agent can **slash** Bob’s initial $100 deposit to cover the group's missing liquidity, ensuring the trip stays funded and fair.

---

---

---

## ⚙️ Operational Modes

SplitBot is designed to be flexible for different group trust levels. It supports two distinct settlement strategies:

1.  **Direct P2P Settlement (Demo Mode)**: 
    *   **Mechanism**: The Agent calculates the debts and generates a **MiniPay/Valora Deep Link** for each debtor. 
    *   **Flow**: Users click the link in Telegram to initiate a direct peer-to-peer USDC transfer.
    *   **Best for**: Casual groups with high social trust.

2.  **Trustless Escrow Pooling (Hardcore Mode)**:
    *   **Mechanism**: Users deposit USDC into the `TripEscrow.sol` contract upfront.
    *   **Flow**: The Agent autonomously calls `settleExpense()` via **Lit Protocol TEE** to reimburse creditors from the pool.
    *   **Best for**: Global hackathon teams or groups requiring algorithmic enforcement and **Slashing** protection.

---

## 🏆 Reputation & Credit Score

SplitBot doesn't just log numbers; it builds a **Verifiable Reputation Score** for every user. 

- **Settlement Health**: The Agent tracks the time-to-settle for every debt. Frequent on-time payers gain high reputation badges.
- **Default Protection**: If a user is **Slashed** in Escrow Mode, their reputation score is permanently downgraded in the Agent's global memory.
- **ERC-8004 Integration**: Future versions will allow users to query an Agent's reputation score before joining a group, creating a decentralized trust layer for the "Real World" economy.

---

## 🧠 Deep Dive: AgentVault Module

**AgentVault** is the "Persistent Brain" of the SplitBot. It ensures the Agent has perfect memory across restarts while maintaining absolute privacy.

### 🛠️ Tech Stack & Working:

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Privacy** | **Lit Protocol (TEE)** | Encrypts the Agent's state (Transactions/Registry) using Threshold Cryptography. Only the Agent's logic can see the plain text. |
| **Storage** | **Pinata / IPFS** | Provides a decentralized, immutable home for the encrypted memory. |
| **Economic Barrier** | **Thirdweb x402** | Implements a tiny micropayment (USDC) for every "Memory Save" to prevent spam and fund the Agent's operations. |
| **AI Processing** | **Gemini 1.5 Flash** | Interrogates the recovered memory to provide conversational responses and dynamic balance tracking. |

**The Workflow**: 
1. `Bot Saves State` $\rightarrow$ 2. `Lit Action Encrypts String` $\rightarrow$ 3. `Thirdweb x402 Micropayment` $\rightarrow$ 4. `Pinata Pins JSON` $\rightarrow$ 5. `CID Returned`.

---

## 🛠️ Tech Stack Summary

- **Multimodal AI**: [Google Gemini 1.5 Flash](https://aistudio.google.com/) (Parses text + raw audio).
- **Voice Synthesis**: [ElevenLabs](https://elevenlabs.io/) (High-fidelity Agent vocal responses).
- **Enclave Multi-Sig**: [Lit Protocol v8](https://litprotocol.com/) (TEE-based threshold signatures/encryption).
- **Economic Logic**: [Thirdweb SDK](https://thirdweb.com/) (ERC-20 transfers & x402 payments).
- **Blockchain Interface**: [Viem](https://viem.sh/) (Celo mainnet/testnet interactions).
- **P2P Mesh**: [libp2p](https://libp2p.io/) (Decentralized Agent communication).

---

## 🤖 Running the Agent

Located in `apps/splitbot-agent`.

```bash
# Register your wallet first in Telegram!
/register <YourCeloAddress>

# Talk to the Agent
"Hey SplitBot, I paid 80 for the rental car." (Text or Voice)

# View History & Dynamic Balances
/history

# Settle
/settle
```

---

### IPFS Pinata persistent storage for AI agents 
JSON Blobs pinned to Pinnata with proper CDN set up
<img width="1233" height="689" alt="image" src="https://github.com/user-attachments/assets/2fef6cd1-1bc7-448e-9276-e751676a2cdb" />

<img width="870" height="778" alt="image" src="https://github.com/user-attachments/assets/7d65a350-adbd-4e0e-b5c7-af74124be160" />


## 📖 Deployment Details
- **Deployer**: `0xaAf16AD8a1258A98ed77A5129dc6A8813924Ad3C`
- **Framework**: Foundry (Contracts) + TypeScript (Agent).
- **Active Node**: Running on Celo Sepolia and Datil-Dev (Lit).
