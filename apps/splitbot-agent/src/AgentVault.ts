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
import { ESCROW_ADDRESS } from './config.js';

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

    async setup() {
        if (this.usePayments) {
            this.twebClient = createThirdwebClient({
                clientId: process.env.THIRDWEB_CLIENT_ID as string,
            });
            const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as string;
            this.agentAccount = twPkToAccount({ client: this.twebClient, privateKey });
        }
        if (this.useRealLit) {
            console.log('🔒 [Lit] Connecting to datil-dev (Lit Protocol v8 / Naga-compatible stack)...');
            this.litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
                litNetwork: 'datil-dev' as any,
                debug: false,
            });
            await this.litNodeClient.connect();
            await this.refreshSessionSigs();
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
        try {
            const results = await this.litNodeClient.executeJs({
                ipfsId: params.ipfsId,
                sessionSigs: this.sessionSigs,
                jsParams: {
                    escrowAddress: params.escrowAddress,
                    payee: params.payee,
                    amount: params.amount,
                    description: params.description,
                },
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

    async saveState(state: Record<string, any>): Promise<string> {
        await this.executeMicropayment(0.05);

        let encryptedPayload: string;
        let dataToEncryptHash: string;

        if (this.useRealLit && this.litNodeClient) {
            console.log('🔒 [Lit] Encrypting state...');
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
            } catch (e: any) {
                console.error(`❌ [Lit] Encryption failed: ${e.message}. Falling back to Base64.`);
                encryptedPayload = Buffer.from(JSON.stringify(state)).toString('base64');
                dataToEncryptHash = 'mockHash';
            }
        } else {
            encryptedPayload = Buffer.from(JSON.stringify(state)).toString('base64');
            dataToEncryptHash = 'mockHash';
        }

        if (this.pinataApiKey && this.pinataSecretApiKey) {
            const payload = {
                pinataMetadata: { name: `AgentMemory_${this.agentId}_${Date.now()}` },
                pinataContent: { encryptedData: encryptedPayload, litHash: dataToEncryptHash },
            };
            const res = await axios.post(`https://api.pinata.cloud/pinning/pinJSONToIPFS`, payload, {
                headers: {
                    pinata_api_key: this.pinataApiKey,
                    pinata_secret_api_key: this.pinataSecretApiKey,
                },
            });
            console.log(`🌐 [IPFS] State Pinned. CID: ${res.data.IpfsHash}`);
            return res.data.IpfsHash;
        }
        return `QmMock${Date.now()}`;
    }

    async loadState(cid: string): Promise<Record<string, any>> {
        if (!this.pinataApiKey) return { status: 'no-pinata', data: {} };

        try {
            const gatewayUrl =
                process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs';
            const res = await axios.get(`${gatewayUrl}/${cid}`);
            const { encryptedData, litHash } = res.data;

            if (this.useRealLit && this.litNodeClient && litHash && litHash !== 'mockHash') {
                console.log('🔓 [Lit] Decrypting state...');
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
                } catch (decErr: any) {
                    console.warn(`[Lit] decrypt failed ${decErr.message}; trying base64`);
                }
            }

            const decrypted = Buffer.from(encryptedData, 'base64').toString();
            return JSON.parse(decrypted);
        } catch (e: any) {
            console.error(`❌ [AgentVault] Load failed: ${e.message}`);
            return { status: 'error', error: e.message };
        }
    }

    async getLatestState(): Promise<Record<string, any> | null> {
        if (!this.pinataApiKey || !this.pinataSecretApiKey) return null;
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
                console.log(`📡 [AgentVault] Found persistent memory at CID: ${latest.ipfs_pin_hash}`);
                return await this.loadState(latest.ipfs_pin_hash);
            }
        } catch {
            console.warn('⚠️ [AgentVault] Could not fetch latest state from Pinata.');
        }
        return null;
    }
}
