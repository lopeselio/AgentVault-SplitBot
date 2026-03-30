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

export const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE || 'minipay') as 'minipay' | 'escrow';

export const LIT_SETTLEMENT_IPFS_CID = process.env.LIT_SETTLEMENT_IPFS_CID || '';
