import { createWalletClient, createPublicClient, http, parseAbi, keccak256, stringToBytes } from 'viem';
import { celoAlfajores } from 'viem/chains';
import {
  RPC_URL,
  REPUTATION_REGISTRY,
  VALIDATION_REGISTRY,
  IDENTITY_REGISTRY,
  getAgentAccount,
  getFeedbackAccount,
} from './config.js';
import { appendAgentLog } from './agentLog.js';

const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external',
]);

const validationAbi = parseAbi([
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external',
]);

const identityAbi = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);

const sepoliaChain = {
  ...celoAlfajores,
  id: 11142220,
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
};

/** Reputation feedback must be sent from a wallet that is NOT the agent operator (self-feedback forbidden). */
export async function submitReputationAfterSettle(params: {
  agentId: bigint;
  score: number;
  detailUri: string;
  endpoint: string;
}) {
  const feedback = getFeedbackAccount();
  if (!feedback) {
    console.warn('[ERC8004] FEEDBACK_WALLET_PRIVATE_KEY not set; skipping giveFeedback');
    return null;
  }
  const agent = getAgentAccount();
  if (feedback.address.toLowerCase() === agent.address.toLowerCase()) {
    console.warn('[ERC8004] Feedback wallet must differ from agent wallet');
    return null;
  }

  const walletClient = createWalletClient({
    account: feedback,
    chain: sepoliaChain,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({ chain: sepoliaChain, transport: http(RPC_URL) });

  const feedbackHash = keccak256(stringToBytes(`settle:${params.agentId}:${Date.now()}`));
  const txHash = await walletClient.writeContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: 'giveFeedback',
    args: [
      params.agentId,
      BigInt(params.score),
      0,
      'successRate',
      'trip-settle',
      params.endpoint,
      params.detailUri,
      feedbackHash,
    ],
    chain: sepoliaChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  appendAgentLog({
    phase: 'execute',
    action: 'reputation_giveFeedback',
    detail: `agentId=${params.agentId}`,
    chainTx: txHash,
    explorerUrl: `https://sepolia.celoscan.io/tx/${txHash}`,
  });
  return receipt;
}

/** Called by agent operator (owner of identity NFT) to request validation from a validator node. */
export async function submitValidationRequest(params: {
  agentId: bigint;
  validatorAddress: `0x${string}`;
  requestUri: string;
}) {
  if (!VALIDATION_REGISTRY || VALIDATION_REGISTRY === '0x0000000000000000000000000000000000000000') {
    console.warn('[ERC8004] VALIDATION_REGISTRY_ADDRESS not configured; skipping validationRequest');
    return null;
  }

  const agent = getAgentAccount();
  const walletClient = createWalletClient({
    account: agent,
    chain: sepoliaChain,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({ chain: sepoliaChain, transport: http(RPC_URL) });

  const requestHash = keccak256(stringToBytes(`${params.requestUri}:${params.agentId}`));

  const txHash = await walletClient.writeContract({
    address: VALIDATION_REGISTRY,
    abi: validationAbi,
    functionName: 'validationRequest',
    args: [params.validatorAddress, params.agentId, params.requestUri, requestHash],
    chain: sepoliaChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  appendAgentLog({
    phase: 'verify',
    action: 'validation_request',
    detail: params.requestUri,
    chainTx: txHash,
    explorerUrl: `https://sepolia.celoscan.io/tx/${txHash}`,
  });
  return txHash;
}

export async function readAgentOwner(agentId: bigint): Promise<`0x${string}` | null> {
  const publicClient = createPublicClient({ chain: sepoliaChain, transport: http() });
  try {
    return await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'ownerOf',
      args: [agentId],
    });
  } catch {
    return null;
  }
}
