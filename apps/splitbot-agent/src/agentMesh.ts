import { ethers } from 'ethers';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import type { Libp2p } from 'libp2p';
import { appendAgentLog } from './agentLog.js';

const TOPIC = 'splitbot-agents-v1';

export type MeshMessage = {
  v: 1;
  agentWallet: string;
  payload: string;
  ts: number;
  sig: string;
};

/**
 * libp2p gossipsub mesh for signed agent coordination messages (settlement proposals, heartbeats).
 * Enable with ENABLE_MESH=true. Optional COMMS_STAKE_ADDRESS: verify peers staked before trusting (see onchain module).
 */
export async function startAgentMesh(handlers: {
  onMessage: (msg: MeshMessage) => void;
  getSigner: () => ethers.Wallet;
}): Promise<Libp2p | null> {
  if (process.env.ENABLE_MESH !== 'true') {
    console.log('[mesh] disabled (set ENABLE_MESH=true)');
    return null;
  }

  const listen = process.env.LIBP2P_LISTEN || '/ip4/0.0.0.0/tcp/9090';

  // Gossipsub + libp2p duplicate @libp2p/interface versions in the tree; cast for interoperability.
  const node = await createLibp2p({
    addresses: { listen: [listen] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    services: {
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) as any,
    },
  } as any);

  await node.start();
  console.log(`[mesh] listening ${node.getMultiaddrs().map((m) => m.toString()).join(', ')}`);

  const pubsub = node.services.pubsub as any;
  await pubsub.subscribe(TOPIC);
  pubsub.addEventListener('message', (evt: any) => {
    try {
      const raw = new TextDecoder().decode(evt.detail.data);
      const parsed = JSON.parse(raw) as MeshMessage;
      const body = JSON.stringify({
        v: parsed.v,
        agentWallet: parsed.agentWallet,
        payload: parsed.payload,
        ts: parsed.ts,
      });
      const recovered = ethers.utils.verifyMessage(body, parsed.sig);
      if (recovered.toLowerCase() !== parsed.agentWallet.toLowerCase()) {
        console.warn('[mesh] bad signature, drop');
        return;
      }
      handlers.onMessage(parsed);
    } catch (e) {
      console.warn('[mesh] message error', e);
    }
  });

  appendAgentLog({
    phase: 'bootstrap',
    action: 'libp2p_started',
    detail: listen,
    chainTx: null,
  });

  return node;
}

export async function publishMeshMessage(node: Libp2p, wallet: ethers.Wallet, payload: string) {
  const body: Omit<MeshMessage, 'sig'> = {
    v: 1,
    agentWallet: wallet.address,
    payload,
    ts: Date.now(),
  };
  const signPayload = JSON.stringify({
    v: body.v,
    agentWallet: body.agentWallet,
    payload: body.payload,
    ts: body.ts,
  });
  const sig = await wallet.signMessage(signPayload);
  const full: MeshMessage = { ...body, sig };
  const pubsub = node.services.pubsub as any;
  await pubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(full)));
}
