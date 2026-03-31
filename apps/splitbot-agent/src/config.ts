import { getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const CELO_SEPOLIA_CHAIN_ID = 11142220;
export const RPC_URL =
  process.env.CELO_SEPOLIA_RPC_URL || 'https://forno.celo-sepolia.celo-testnet.org';

export const USDC_ADDRESS = (process.env.USDC_ADDRESS ||
  '0x01C5C0122039549AD1493B8220cABEdD739BC44E') as `0x${string}`;
export const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS ||
  '0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29') as `0x${string}`;

export const IDENTITY_REGISTRY = (process.env.IDENTITY_REGISTRY_ADDRESS ||
  '0x8004A818BFB912233c491871b3d84c89A494BD9e') as `0x${string}`;
export const REPUTATION_REGISTRY = (process.env.REPUTATION_REGISTRY_ADDRESS ||
  '0x8004B663056A597Dffe9eCcC1965A193B7388713') as `0x${string}`;
/** Set when Celo documents publish Sepolia validation registry; optional for local dev */
export const VALIDATION_REGISTRY = (process.env.VALIDATION_REGISTRY_ADDRESS || '') as `0x${string}`;

export const USDC_DECIMALS = 6;

export function getAgentAccount() {
  const pk = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_WALLET_PRIVATE_KEY is required');
  return privateKeyToAccount(pk as `0x${string}`);
}

export function getFeedbackAccount() {
  const pk = process.env.FEEDBACK_WALLET_PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount(pk as `0x${string}`);
}

/** For `fund-escrow` script: dedicated treasury wallet, else same as agent. */
export function getEscrowFunderAccount() {
  const pk = process.env.ESCROW_FUNDER_PRIVATE_KEY;
  if (pk) return privateKeyToAccount(pk as `0x${string}`);
  return getAgentAccount();
}

export const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE || 'escrow') as 'minipay' | 'escrow';

/**
 * Namespaces AgentVault blobs in Storacha/Pinata (`_splitbot.agentId`). Use a new value for a clean demo
 * so you do not load legacy `tripTransactions` / `userRegistry` from an old id.
 */
export const AGENT_VAULT_ID = process.env.AGENT_VAULT_ID?.trim() || 'splitbot-demo';

/** Default when unset: 2.5 Flash — 2.0-flash is often 404 for new API keys (“no longer available to new users”). */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Gemini model id (see Google AI Studio / ListModels). Older 1.5 names are remapped — Google retires them periodically.
 */
function normalizeGeminiModel(raw: string): string {
  const r = raw.trim();
  if (r === 'gemini-flash-latest' || r === 'gemini-pro-latest') {
    console.warn(
      `[config] GEMINI_MODEL "${r}" is an alias; using ${GEMINI_DEFAULT_MODEL}. Set GEMINI_MODEL explicitly if needed.`,
    );
    return GEMINI_DEFAULT_MODEL;
  }
  if (r.startsWith('gemini-1.5-')) {
    console.warn(
      `[config] GEMINI_MODEL "${r}" is deprecated or unavailable on the current API; using ${GEMINI_DEFAULT_MODEL}. See https://ai.google.dev/gemini-api/docs/models/gemini`,
    );
    return GEMINI_DEFAULT_MODEL;
  }
  if (r === 'gemini-2.0-flash' || r.startsWith('gemini-2.0-flash-')) {
    console.warn(
      `[config] GEMINI_MODEL "${r}" is not offered to new API keys; using ${GEMINI_DEFAULT_MODEL}. Set GEMINI_MODEL explicitly if you still have access.`,
    );
    return GEMINI_DEFAULT_MODEL;
  }
  return r;
}

export const GEMINI_MODEL = normalizeGeminiModel(
  process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL,
);

export const LIT_SETTLEMENT_IPFS_CID = process.env.LIT_SETTLEMENT_IPFS_CID || '';

/** Optional: pinned CID for `vaultPkpCrypto.js`; if unset, bot uses bundled file for POST /lit_action. */
export const LIT_VAULT_CRYPTO_IPFS_CID = process.env.LIT_VAULT_CRYPTO_IPFS_CID || '';

/**
 * PKP wallet address used in Lit Actions — the tx `from` when `settleTrip` runs.
 * **TripEscrow.splitBotAgent must equal this address** for Lit settlement (not the operator EOA).
 * `LIT_CHIPOTLE_PKP_ID` / `LIT_PKP_ID` are often the PKP’s 0x address; owner must `updateAgent(pkp)` on-chain if migrating from wallet-only mode.
 */
export function getLitPkpWalletAddress(): `0x${string}` | null {
  const raw = process.env.LIT_CHIPOTLE_PKP_ID?.trim() || process.env.LIT_PKP_ID?.trim();
  if (!raw) return null;
  if (!isAddress(raw)) return null;
  return getAddress(raw);
}

/** Lit v8 / Naga: only `naga-dev` and `custom` are valid. Legacy `datil-dev` maps to `naga-dev`. */
export type LitNetworkName = 'naga-dev' | 'custom';

export function getLitNetwork(): LitNetworkName {
  const raw = (process.env.LIT_NETWORK || 'naga-dev').trim().toLowerCase();
  if (raw === 'datil-dev' || raw === 'datil') {
    console.warn(
      '[config] LIT_NETWORK datil-dev is deprecated in @lit-protocol v8; using naga-dev. Set LIT_NETWORK=naga-dev.',
    );
    return 'naga-dev';
  }
  if (raw === 'custom') return 'custom';
  if (raw === 'naga-dev' || raw === '') return 'naga-dev';
  console.warn(`[config] Unknown LIT_NETWORK="${raw}"; using naga-dev`);
  return 'naga-dev';
}
