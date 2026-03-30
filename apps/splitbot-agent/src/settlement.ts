import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits } from 'viem';
import { celoAlfajores } from 'viem/chains';
import {
  ESCROW_ADDRESS,
  RPC_URL,
  USDC_DECIMALS,
  getAgentAccount,
  LIT_SETTLEMENT_IPFS_CID,
} from './config.js';
import type { AgentVault } from './AgentVault.js';
import { appendAgentLog } from './agentLog.js';

const escrowAbi = parseAbi([
  'function totalPool() view returns (uint256)',
  'function dailySettleAmount(uint256 day) view returns (uint256)',
  'function splitBotAgent() view returns (address)',
  'function settleExpense(address payee, uint256 amount, string description) external',
]);

const sepoliaChain = {
  ...celoAlfajores,
  id: 11142220,
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
};

export type SettlementDebt = { debtor: string; creditor: string; amount: number };

type VerifyResult =
  | { ok: false; reason: string }
  | { ok: true; amountWei: bigint; payee: `0x${string}`; description: string };

export async function verifyEscrowCanSettle(
  publicClient: ReturnType<typeof createPublicClient>,
  payee: `0x${string}`,
  amountHuman: number,
  description: string
): Promise<VerifyResult> {
  const agent = getAgentAccount();
  const onchainAgent = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'splitBotAgent',
  });
  if (onchainAgent.toLowerCase() !== agent.address.toLowerCase()) {
    return {
      ok: false,
      reason: `Escrow splitBotAgent ${onchainAgent} != operator ${agent.address}`,
    };
  }

  const amountWei = parseUnits(String(amountHuman), USDC_DECIMALS);
  const pool = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'totalPool',
  });
  if (pool < amountWei) {
    return {
      ok: false,
      reason: `Insufficient pool: have ${formatUnits(pool, USDC_DECIMALS)} need ${amountHuman}`,
    };
  }

  return { ok: true, amountWei, payee, description: description || 'SplitBot settlement' };
}

export async function executeEscrowSettlement(
  publicClient: ReturnType<typeof createPublicClient>,
  vault: InstanceType<typeof AgentVault>,
  debt: SettlementDebt,
  creditorAddress: `0x${string}`
): Promise<{ txHash: string; mode: 'wallet' | 'lit' }> {
  const v = await verifyEscrowCanSettle(publicClient, creditorAddress, debt.amount, `settle:${debt.debtor}->${debt.creditor}`);
  if (!v.ok) throw new Error('reason' in v ? String(v.reason) : 'verify failed');
  const { amountWei, description: desc } = v;

  const agent = getAgentAccount();
  const useLit = process.env.ENABLE_LIT === 'true' && LIT_SETTLEMENT_IPFS_CID;

  if (useLit) {
    const res = await vault.executeSettlementAction({
      ipfsId: LIT_SETTLEMENT_IPFS_CID,
      escrowAddress: ESCROW_ADDRESS,
      payee: creditorAddress,
      amount: amountWei.toString(),
      description: desc,
    });
    const txHash = (res as { txHash?: string }).txHash || 'lit-mock';
    appendAgentLog({
      phase: 'execute',
      action: 'settleExpense_lit_action',
      detail: JSON.stringify(debt),
      chainTx: txHash,
    });
    return { txHash, mode: 'lit' };
  }

  const walletClient = createWalletClient({
    account: agent,
    chain: sepoliaChain,
    transport: http(RPC_URL),
  });

  const txHash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'settleExpense',
    args: [creditorAddress, amountWei, desc],
    chain: sepoliaChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  appendAgentLog({
    phase: 'execute',
    action: 'settleExpense_wallet',
    detail: JSON.stringify(debt),
    chainTx: txHash,
    explorerUrl: `https://sepolia.celoscan.io/tx/${txHash}`,
  });
  return { txHash, mode: 'wallet' };
}

