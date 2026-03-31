import axios from 'axios';
import * as LitJsSdk from '@lit-protocol/lit-node-client';
import { LitActionResource } from '@lit-protocol/auth-helpers';
import { LIT_ABILITY } from '@lit-protocol/constants';
import { ethers } from 'ethers';
import { privateKeyToAccount } from 'viem/accounts';
import { createThirdwebClient, sendTransaction, getContract } from 'thirdweb';
import { transfer } from 'thirdweb/extensions/erc20';
import { privateKeyToAccount as twPkToAccount } from 'thirdweb/wallets';
import { defineChain } from 'thirdweb';
import { ESCROW_ADDRESS, getLitNetwork, getLitPkpWalletAddress } from './config.js';
import { resolveLitActionCode, runLitAction } from './chipotleClient.js';
import {
    LIT_VAULT_LIT_ACTION_HASH,
    resolveVaultCryptoLitActionCode,
} from './vaultLitAction.js';
import {
    getStorachaClient,
    AGENT_MEMORY_FILENAME,
    storachaAgentMemoryUrl,
} from './filecoinArchive.js';

export class AgentVault {
    private agentId: string;
    private pinataApiKey: string;
    private pinataSecretApiKey: string;
    private useRealLit: boolean;
    private usePayments: boolean;
    private twebClient: any;
    private agentAccount: any;
    private vaultDepositAddress: `0x${string}`;
    private usdcTokenAddress: `0x${string}`;
    private escrowAddress: `0x${string}`;

    private litNodeClient: any;
    private sessionSigs: any;
    /** True only after `LitNodeClient.connect()` + session sigs succeeded. */
    private litNodeReady = false;

    constructor(agentId: string) {
        this.agentId = agentId;
        this.pinataApiKey = process.env.PINATA_API_KEY || '';
        this.pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY || '';
        this.useRealLit = process.env.ENABLE_LIT === 'true';
        this.usePayments = process.env.ENABLE_PAYMENTS === 'true';
        this.vaultDepositAddress = (process.env.ESCROW_ADDRESS ||
            '0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29') as `0x${string}`;
        this.usdcTokenAddress = (process.env.USDC_ADDRESS ||
            '0x01C5C0122039549AD1493B8220cABEdD739BC44E') as `0x${string}`;
        this.escrowAddress = ESCROW_ADDRESS;
        console.log(`[AgentVault] Initialized Persistent Memory for Agent: ${this.agentId}`);
    }

    /** After `setup()`, logs whether Storacha env is present and the client can start (Pinata remains fallback). */
    async logPersistenceDiagnostics(): Promise<void> {
        const has =
            !!(process.env.STORACHA_AGENT_KEY?.trim() && process.env.STORACHA_PROOF?.trim());
        if (!has) {
            console.log(
                '📦 [AgentVault] Storacha: not configured — set STORACHA_AGENT_KEY + STORACHA_PROOF for sponsor path. Memory load/save uses Pinata when those keys exist.'
            );
            return;
        }
        try {
            await getStorachaClient();
            console.log(
                '📦 [AgentVault] Storacha: client OK — uploads go here first; latest load uses Storacha when a matching memory blob exists, else Pinata.'
            );
        } catch (e: unknown) {
            const m = e instanceof Error ? e.message : String(e);
            console.warn(`📦 [AgentVault] Storacha: failed to start — ${m}`);
        }
    }

    /** After `setup()`, when `ENABLE_LIT=true`, logs which Lit settlement path is configured (core API vs `executeJs`). */
    logLitIntegrationDiagnostics(): void {
        if (!this.useRealLit) {
            console.log(
                '[Lit] ENABLE_LIT=false — TripEscrow settlements use the agent EOA in settlement.ts (wallet path).'
            );
            return;
        }
        const chipotle = !!process.env.LIT_CHIPOTLE_API_KEY?.trim();
        const cid = process.env.LIT_SETTLEMENT_IPFS_CID?.trim();
        console.log(
            `[Lit] Settlement: ${chipotle ? 'Core API POST /lit_action (LIT_CHIPOTLE_API_KEY)' : 'lit-node-client executeJs + session sigs'}`,
        );
        const pkpAddr = getLitPkpWalletAddress();
        if (chipotle && pkpAddr) {
            console.log(
                `[Lit] PKP ${pkpAddr} → js_params.pkpId; TripEscrow.splitBotAgent must match this address (else settleExpense reverts).`,
            );
            console.log(
                '[Lit] Vault memory: Lit.Actions.Encrypt/Decrypt (Chipotle) via POST /lit_action (bundled vaultPkpCrypto.js or LIT_VAULT_CRYPTO_IPFS_CID).',
            );
        } else if (chipotle) {
            console.warn('[Lit] Set LIT_CHIPOTLE_PKP_ID to PKP wallet 0x… for Lit settlement.');
        }
        if (!cid) {
            console.warn(
                '[Lit] LIT_SETTLEMENT_IPFS_CID unset — pin via Storacha: npx tsx scripts/pin-lit-action.ts (requires STORACHA_AGENT_KEY + STORACHA_PROOF)',
            );
        } else {
            console.log(`[Lit] LIT_SETTLEMENT_IPFS_CID=${cid.slice(0, 16)}…`);
        }
        if (chipotle && !this.litNodeReady) {
            console.warn(
                '[Lit] Validator handshake unavailable — POST /lit_action settlement and Chipotle vault Encrypt/Decrypt still work; BLS encryptString/decryptToString need a connected node.',
            );
        }
        if (this.litNodeReady) {
            console.log('[Lit] Node client: connected — Lit encrypt/decrypt and executeJs available.');
        }
        console.log(
            '[Lit] Docs: https://developer.litprotocol.com/management/api_direct#7-run-lit-action · Actions: https://developer.litprotocol.com/lit-actions/examples',
        );
    }

    async setup() {
        if (this.usePayments) {
            this.twebClient = createThirdwebClient({
                clientId: process.env.THIRDWEB_CLIENT_ID as string,
            });
            const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as string;
            this.agentAccount = twPkToAccount({ client: this.twebClient, privateKey });
        }
        if (this.useRealLit) {
            const litNetwork = getLitNetwork();
            const chipotleKey = !!process.env.LIT_CHIPOTLE_API_KEY?.trim();
            console.log(`🔒 [Lit] Connecting to ${litNetwork} (@lit-protocol v8 / Naga)...`);
            try {
                this.litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
                    litNetwork,
                    debug: false,
                });
                await this.litNodeClient.connect();
                await this.refreshSessionSigs();
                this.litNodeReady = true;
                console.log('🔒 [Lit] Node client ready — session sigs + encrypt/decrypt paths active.');
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                if (chipotleKey) {
                    this.litNodeClient = undefined;
                    this.sessionSigs = undefined;
                    this.litNodeReady = false;
                    console.warn(
                        `[Lit] Validator handshake failed (${msg}). ` +
                            'Continuing: Core API settlement and Chipotle vault Encrypt/Decrypt do not require node TCP. ' +
                            'BLS memory (encryptString) falls back to base64 until validators are reachable.',
                    );
                } else {
                    throw new Error(
                        `[Lit] ENABLE_LIT=true without LIT_CHIPOTLE_API_KEY needs Lit nodes for executeJs/session sigs. Connection failed: ${msg}. ` +
                            'Add LIT_CHIPOTLE_API_KEY for POST /lit_action-only mode, or fix network/VPN/firewall, or set ENABLE_LIT=false for escrow-only.',
                    );
                }
            }
        }
    }

    public async getAgentAddress(): Promise<string> {
        const pk = process.env.AGENT_WALLET_PRIVATE_KEY;
        if (!pk) throw new Error('AGENT_WALLET_PRIVATE_KEY required for operator address');
        return privateKeyToAccount(pk as `0x${string}`).address;
    }

    async refreshSessionSigs() {
        const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as string;
        const wallet = new ethers.Wallet(privateKey);
        const pkp = process.env.PKP_PUBLIC_KEY;
        if (!pkp || pkp === '0xPlaceholder') {
            console.warn(
                '[Lit] PKP_PUBLIC_KEY not set; session sigs may fail. Lit bounty: use @lit-protocol/* (Naga) or Vincent API for production PKP/wallet policy.'
            );
        }
        this.sessionSigs = await this.litNodeClient.getPkpSessionSigs({
            chain: 'celo',
            publicKey: pkp || '0x',
            authMethods: [
                {
                    authMethodType: 1,
                    accessToken: JSON.stringify({
                        sig: await wallet.signMessage('Authenticate with Lit'),
                        derivedVia: 'web3.eth.personal.sign',
                        signedMessage: 'Authenticate with Lit',
                        address: await wallet.getAddress(),
                    }),
                },
            ],
            resourceAbilityRequests: [
                { resource: new LitActionResource('*'), ability: LIT_ABILITY.LitActionExecution },
                {
                    resource: new LitActionResource('*'),
                    ability: LIT_ABILITY.AccessControlConditionDecryption,
                },
            ],
        });
    }

    async executeSettlementAction(params: {
        ipfsId: string;
        escrowAddress: string;
        payee: string;
        amount: string;
        description: string;
    }) {
        if (!this.useRealLit) {
            return { success: true, txHash: 'lit-disabled-mock' };
        }
        const chipotleKey = process.env.LIT_CHIPOTLE_API_KEY;
        const jsParams: Record<string, unknown> = {
            escrowAddress: params.escrowAddress,
            payee: params.payee,
            amount: params.amount,
            description: params.description,
        };
        const pkpId =
            process.env.LIT_CHIPOTLE_PKP_ID?.trim() || process.env.LIT_PKP_ID?.trim();
        if (pkpId) jsParams.pkpId = pkpId;

        try {
            if (chipotleKey) {
                const code = await resolveLitActionCode(params.ipfsId);
                const out = await runLitAction(chipotleKey, {
                    code,
                    js_params: jsParams,
                });
                const r = out.response;
                return typeof r === 'string' ? JSON.parse(r) : r;
            }
            if (!this.litNodeClient) {
                throw new Error(
                    '[Lit] executeJs requires a connected Lit node client. Handshake failed at startup; set LIT_CHIPOTLE_API_KEY for Core API settlement or restore network access to validators.',
                );
            }
            const results = await this.litNodeClient.executeJs({
                ipfsId: params.ipfsId,
                sessionSigs: this.sessionSigs,
                jsParams: jsParams,
            });
            return JSON.parse(results.response as string);
        } catch (error: any) {
            throw error;
        }
    }

    private async executeMicropayment(amount: number) {
        if (!this.usePayments) return;
        try {
            const tokenContract = getContract({
                client: this.twebClient,
                chain: defineChain(11142220),
                address: this.usdcTokenAddress,
            });
            const tx = transfer({
                contract: tokenContract,
                to: this.vaultDepositAddress,
                amount: amount.toString(),
            });
            await sendTransaction({ transaction: tx, account: this.agentAccount });
        } catch (error: any) {
            console.warn(`⚠️ [Thirdweb x402] Payment failed: ${error.message || error}. Proceeding for Demo.`);
        }
    }

    /** Only the TripEscrow-designated agent wallet may decrypt (matches on-chain splitBotAgent). */
    private getLitAccessConditions() {
        return [
            {
                contractAddress: this.escrowAddress,
                chain: 'celo',
                standardContractType: 'Contract',
                method: 'splitBotAgent',
                parameters: [],
                returnValueTest: { comparator: '=', value: ':userAddress' },
            },
        ];
    }

    private chipotleApiKey(): string | undefined {
        return process.env.LIT_CHIPOTLE_API_KEY?.trim();
    }

    private pkpIdForLit(): string | undefined {
        return process.env.LIT_CHIPOTLE_PKP_ID?.trim() || process.env.LIT_PKP_ID?.trim();
    }

    private parseLitActionResponse(response: unknown): Record<string, unknown> {
        if (typeof response === 'string') {
            try {
                return JSON.parse(response) as Record<string, unknown>;
            } catch {
                return {};
            }
        }
        if (response && typeof response === 'object') return response as Record<string, unknown>;
        return {};
    }

    /** HTTPS-only: Chipotle `Lit.Actions.Encrypt` inside Lit Action (see packages/agent-vault/.../vaultPkpCrypto.js). */
    private async encryptStateViaLitAction(state: Record<string, any>): Promise<{
        encryptedData: string;
        litHash: string;
    }> {
        const key = this.chipotleApiKey();
        const pkpId = this.pkpIdForLit();
        if (!key || !pkpId) throw new Error('LIT_CHIPOTLE_API_KEY and LIT_CHIPOTLE_PKP_ID required');
        const code = await resolveVaultCryptoLitActionCode();
        const out = await runLitAction(key, {
            code,
            js_params: {
                pkpId,
                mode: 'encrypt',
                payload: JSON.stringify(state),
            },
        });
        const r = this.parseLitActionResponse(out.response);
        const ct = r.ciphertext;
        if (typeof ct !== 'string' || !ct.length) {
            throw new Error('Lit vault action: missing ciphertext in response');
        }
        return { encryptedData: ct, litHash: LIT_VAULT_LIT_ACTION_HASH };
    }

    private async decryptStateViaLitAction(ciphertext: string): Promise<string> {
        const key = this.chipotleApiKey();
        const pkpId = this.pkpIdForLit();
        if (!key || !pkpId) throw new Error('LIT_CHIPOTLE_API_KEY and LIT_CHIPOTLE_PKP_ID required');
        const code = await resolveVaultCryptoLitActionCode();
        const out = await runLitAction(key, {
            code,
            js_params: {
                pkpId,
                mode: 'decrypt',
                payload: ciphertext,
            },
        });
        const r = this.parseLitActionResponse(out.response);
        const pt = r.plaintext;
        if (typeof pt !== 'string') {
            throw new Error('Lit vault action: missing plaintext in response');
        }
        return pt;
    }

    async saveState(state: Record<string, any>): Promise<string> {
        await this.executeMicropayment(0.05);

        let encryptedPayload!: string;
        let dataToEncryptHash!: string;

        let done = false;
        if (this.useRealLit) {
            const ck = this.chipotleApiKey();
            const pid = this.pkpIdForLit();
            if (ck && pid) {
                try {
                    console.log('🔒 [Lit] Encrypting state (Lit Action: Lit.Actions.Encrypt, POST /lit_action)...');
                    const enc = await this.encryptStateViaLitAction(state);
                    encryptedPayload = enc.encryptedData;
                    dataToEncryptHash = enc.litHash;
                    done = true;
                } catch (e: unknown) {
                    const m = e instanceof Error ? e.message : String(e);
                    console.warn(`⚠️ [Lit] Lit Action vault encrypt failed: ${m}. Trying node client or base64.`);
                }
            }
            if (!done && this.litNodeClient) {
                console.log('🔒 [Lit] Encrypting state (node client encryptString + ACC)...');
                try {
                    // @ts-expect-error encryptString
                    const { ciphertext, dataToEncryptHash: hash } = await LitJsSdk.encryptString(
                        {
                            accessControlConditions: this.getLitAccessConditions(),
                            dataToEncrypt: JSON.stringify(state),
                        },
                        this.litNodeClient
                    );
                    encryptedPayload = ciphertext;
                    dataToEncryptHash = hash;
                    done = true;
                } catch (e: any) {
                    console.error(`❌ [Lit] Encryption failed: ${e.message}. Falling back to Base64.`);
                }
            }
        }
        if (!done) {
            encryptedPayload = Buffer.from(JSON.stringify(state)).toString('base64');
            dataToEncryptHash = 'mockHash';
        }

        const memoryBody = {
            encryptedData: encryptedPayload,
            litHash: dataToEncryptHash,
            _splitbot: { agentId: this.agentId, savedAt: Date.now() },
        };

        try {
            const client = await getStorachaClient();
            if (client) {
                const json = JSON.stringify(memoryBody);
                const file = new File([json], AGENT_MEMORY_FILENAME, { type: 'application/json' });
                const root = await client.uploadFile(file);
                const cid = root.toString();
                console.log(`🌐 [Storacha] State uploaded. CID: ${cid}`);
                return cid;
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`⚠️ [Storacha] Upload failed, falling back to Pinata: ${msg}`);
        }

        if (this.pinataApiKey && this.pinataSecretApiKey) {
            const payload = {
                pinataMetadata: { name: `AgentMemory_${this.agentId}_${Date.now()}` },
                pinataContent: memoryBody,
            };
            const res = await axios.post(`https://api.pinata.cloud/pinning/pinJSONToIPFS`, payload, {
                headers: {
                    pinata_api_key: this.pinataApiKey,
                    pinata_secret_api_key: this.pinataSecretApiKey,
                },
            });
            console.log(`🌐 [Pinata] State pinned. CID: ${res.data.IpfsHash}`);
            return res.data.IpfsHash;
        }
        return `QmMock${Date.now()}`;
    }

    private ipfsGatewayBase(): string {
        const g = process.env.PINATA_GATEWAY_URL?.trim();
        return (g || 'https://gateway.pinata.cloud/ipfs').replace(/\/$/, '');
    }

    /** Fetch encrypted memory JSON from Storacha / public IPFS gateways (Pinata-pinned JSON is at CID root). */
    private async fetchMemoryJsonFromGateways(cid: string): Promise<{
        encryptedData: string;
        litHash: string;
        _splitbot?: { agentId: string; savedAt?: number };
    }> {
        // Prefer w3s first: works for both Pinata (JSON at CID root) and Storacha file roots; subdomain + filename is a fallback.
        const urls = [
            `https://w3s.link/ipfs/${cid}`,
            `${this.ipfsGatewayBase()}/${cid}`,
            storachaAgentMemoryUrl(cid),
        ];
        let lastErr = '';
        for (const url of urls) {
            try {
                const res = await axios.get(url, { timeout: 25000, validateStatus: () => true });
                if (res.status !== 200) {
                    lastErr = `${url}: HTTP ${res.status}`;
                    continue;
                }
                const d = res.data;
                if (d && typeof d === 'object' && typeof d.encryptedData === 'string') {
                    return d;
                }
                lastErr = 'response is not agent memory JSON';
                break;
            } catch (e: unknown) {
                lastErr = e instanceof Error ? e.message : String(e);
            }
        }
        throw new Error(lastErr || 'fetch failed for all gateways');
    }

    private async decryptMemoryPayload(encryptedData: string, litHash: string): Promise<Record<string, any>> {
        if (litHash === LIT_VAULT_LIT_ACTION_HASH) {
            const ck = this.chipotleApiKey();
            const pid = this.pkpIdForLit();
            if (ck && pid) {
                console.log('🔓 [Lit] Decrypting state (Lit Action: Lit.Actions.Decrypt, POST /lit_action)...');
                try {
                    const plain = await this.decryptStateViaLitAction(encryptedData);
                    return JSON.parse(plain);
                } catch (decErr: unknown) {
                    const m = decErr instanceof Error ? decErr.message : String(decErr);
                    console.warn(`[Lit] Lit Action vault decrypt failed ${m}; trying base64`);
                }
            }
        }
        if (
            this.useRealLit &&
            this.litNodeClient &&
            litHash &&
            litHash !== 'mockHash' &&
            litHash !== LIT_VAULT_LIT_ACTION_HASH
        ) {
            console.log('🔓 [Lit] Decrypting state (node client + session sigs)...');
            try {
                // @ts-expect-error decrypt
                const decryptedString = await LitJsSdk.decryptToString(
                    {
                        accessControlConditions: this.getLitAccessConditions(),
                        ciphertext: encryptedData,
                        dataToEncryptHash: litHash,
                        sessionSigs: this.sessionSigs || {},
                        chain: 'celo',
                    },
                    this.litNodeClient
                );
                return JSON.parse(decryptedString);
            } catch (decErr: unknown) {
                const m = decErr instanceof Error ? decErr.message : String(decErr);
                console.warn(`[Lit] decrypt failed ${m}; trying base64`);
            }
        }
        const decrypted = Buffer.from(encryptedData, 'base64').toString();
        return JSON.parse(decrypted);
    }

    async loadState(cid: string): Promise<Record<string, any>> {
        try {
            const { encryptedData, litHash } = await this.fetchMemoryJsonFromGateways(cid);
            return await this.decryptMemoryPayload(encryptedData, litHash);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`❌ [AgentVault] Load failed: ${msg}`);
            return { status: 'error', error: msg };
        }
    }

    async getLatestState(): Promise<Record<string, any> | null> {
        let storachaTried = false;
        let storachaUploadCount = 0;
        try {
            const client = await getStorachaClient();
            if (client) {
                storachaTried = true;
                const page = await client.capability.upload.list({ size: 100 });
                const rows = [...(page.results ?? [])].sort(
                    (a, b) =>
                        new Date(b.insertedAt).getTime() - new Date(a.insertedAt).getTime()
                );
                storachaUploadCount = rows.length;
                for (const item of rows) {
                    const cid = item.root.toString();
                    try {
                        const raw = await this.fetchMemoryJsonFromGateways(cid);
                        if (raw._splitbot?.agentId === this.agentId) {
                            console.log(`📡 [AgentVault] Found persistent memory (Storacha) at CID: ${cid}`);
                            return await this.decryptMemoryPayload(raw.encryptedData, raw.litHash);
                        }
                    } catch {
                        /* not this upload or fetch error */
                    }
                }
                if (storachaUploadCount === 0) {
                    console.log(
                        '📦 [AgentVault] Storacha is configured but this space has no uploads yet — loading latest from Pinata if present (trigger any save to create a Storacha memory blob).'
                    );
                } else {
                    console.log(
                        `📦 [AgentVault] Storacha has ${storachaUploadCount} upload(s) for this space, but none are agent memory for "${this.agentId}" (e.g. another AGENT_VAULT_ID or settlement archive) — checking Pinata…`
                    );
                }
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`⚠️ [AgentVault] Storacha latest state failed: ${msg}`);
        }

        if (!this.pinataApiKey || !this.pinataSecretApiKey) {
            console.log(
                `📦 [AgentVault] No ledger snapshot for "${this.agentId}" — starting empty (no Pinata API keys to fall back).`
            );
            return null;
        }
        try {
            const res = await axios.get(
                `https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=AgentMemory_${this.agentId}_&pageLimit=1&sort=DESC`,
                {
                    headers: {
                        pinata_api_key: this.pinataApiKey,
                        pinata_secret_api_key: this.pinataSecretApiKey,
                    },
                }
            );
            if (res.data.rows?.length > 0) {
                const latest = res.data.rows[0];
                const h = latest.ipfs_pin_hash as string;
                console.log(
                    `📡 [AgentVault] Found persistent memory (Pinata) at CID: ${h}${storachaTried ? ' — Storacha did not have a newer matching blob; Qm* = Pinata JSON pin.' : ''}`
                );
                return await this.loadState(h);
            }
        } catch {
            console.warn('⚠️ [AgentVault] Could not fetch latest state from Pinata.');
        }
        console.log(
            `📦 [AgentVault] No ledger snapshot for "${this.agentId}" — starting empty (expected with a new AGENT_VAULT_ID until you /register and log expenses or run storacha:ping).`
        );
        return null;
    }
}
