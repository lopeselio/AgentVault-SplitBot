# Demo video storyboard (2–5 minutes)

1. **Hook (15s):** Group trip in Telegram; problem — splitting bills and trust.
2. **Register + expenses (30s):** `/register`, text/voice expenses; show AgentVault IPFS CID in logs.
3. **Dual settlement (45s):** `SETTLEMENT_MODE=minipay` — MiniPay link; switch to `escrow` — show pool check and `settleExpense` on [CeloScan Sepolia](https://sepolia.celoscan.io).
4. **ERC-8004 (30s):** `agent.json` / `agent_log.json`; optional `giveFeedback` tx (feedback wallet) and `validationRequest` (operator).
5. **Lit (20s):** Encrypted state blob; decrypt path; mention PKP / Vincent for production.
6. **Zama (15s):** Run `npm run demo` in `packages/zama-split`; explain fhEVM ledger vs public escrow.
7. **P2P + Filecoin (20s):** `ENABLE_MESH=true` gossip message; optional Storacha CID for archives.
8. **Close (10s):** Comms stake / spam resistance; link to repo and live bot.
