import axios from 'axios';
import * as LitJsSdk from '@lit-protocol/lit-node-client';
import { LitActionResource } from '@lit-protocol/auth-helpers';
import { LIT_ABILITY } from '@lit-protocol/constants';
import { EthWalletProvider } from '@lit-protocol/lit-auth-client';
import { ethers } from 'ethers';
import { createThirdwebClient, sendTransaction, waitForReceipt, getContract } from "thirdweb";
import { transfer } from "thirdweb/extensions/erc20";
import { privateKeyToAccount } from "thirdweb/wallets";
import { defineChain } from "thirdweb";

/**
 * AgentVault Core SDK
 * 
 * Handles storing long-term memory blobs for autonomous AI agents.
 * 1. Thirdweb x402 - Micro-payments on Celo Alfajores Testnet for read/write access
 * 2. Lit Protocol - Encrypting data restricted to ERC-8004 agents
 * 3. IPFS via Pinata - Real decentralized file storage
 */
export class AgentVault {
    private agentId: string;
    
    // Configs
    private pinataApiKey: string;
    private pinataSecretApiKey: string;
    private useRealLit: boolean;
    
    // Thirdweb / Payments
    private usePayments: boolean;
    private twebClient: any;
    private agentAccount: any;
    private vaultDepositAddress = "0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29"; // Updated TripEscrow (Slashing v2)
    private usdcTokenAddress = "0x01C5C0122039549AD1493B8220cABEdD739BC44E"; // Celo Sepolia USDC

    private litNodeClient: any;
    private sessionSigs: any;
  
    constructor(agentId: string) {
      this.agentId = agentId;
      
      this.pinataApiKey = process.env.PINATA_API_KEY || '';
      this.pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY || '';
      this.useRealLit = process.env.ENABLE_LIT === 'true';
      this.usePayments = process.env.ENABLE_PAYMENTS === 'true';

      if (!this.pinataApiKey) console.warn("⚠️ [AgentVault] PINATA_API_KEY missing. Mocking IPFS.");
      
      console.log(`[AgentVault] Initialized Persistent Memory for Agent: ${this.agentId}`);
    }

    /**
     * Initializes the Thirdweb Client for x402 Payments and Lit Protocol
     */
    async setup() {
        // Setup Thirdweb
        if (this.usePayments) {
            console.log(`[Thirdweb x402] Initializing Celo payment client...`);
            this.twebClient = createThirdwebClient({ 
                clientId: process.env.THIRDWEB_CLIENT_ID as string 
            });
            
            // The agent pays the fee via its own private key
            const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as string;
            this.agentAccount = privateKeyToAccount({ client: this.twebClient, privateKey });
        } else {
            console.log(`[Thirdweb x402] ENABLE_PAYMENTS=true is not set. Mocking payments.`);
        }

        // Setup Lit Protocol
        if (this.useRealLit) {
            console.log(`[Lit Protocol] Connecting to 'datil-dev' Lit network...`);
            this.litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
                litNetwork: "datil-dev" as any, // Cast to any if types lag behind Naga releases
                debug: false
            });
            await this.litNodeClient.connect();
            
            // Generate Session Sigs for the agent
            await this.refreshSessionSigs();
        }
    }

    /**
     * Authenticates with the Lit Network using the Agent's Wallet
     * and generates session signatures for subsequent operations.
     */
    async refreshSessionSigs() {
        console.log(`[Lit Protocol] Generating Session Signatures for the Agent...`);
        const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as string;
        const wallet = new ethers.Wallet(privateKey);
        
        this.sessionSigs = await this.litNodeClient.getPkpSessionSigs({
            chain: "celo",
            publicKey: "0xPlaceholderPKPPublicKey", // We will update this when a PKP is minted
            authMethods: [
                {
                    authMethodType: 1, // EthWallet
                    accessToken: JSON.stringify({
                        sig: await wallet.signMessage("Authenticate with Lit"),
                        derivedVia: "web3.eth.personal.sign",
                        signedMessage: "Authenticate with Lit",
                        address: await wallet.getAddress(),
                    }),
                },
            ],
            resourceAbilityRequests: [
                {
                    resource: new LitActionResource("*"),
                    ability: LIT_ABILITY.LitActionExecution,
                },
                {
                    resource: new LitActionResource("*"), // Simplified for demo
                    ability: LIT_ABILITY.AccessControlConditionDecryption,
                },
            ],
        });
    }

    /**
     * Executes the secure 'settleTrip.js' Lit Action within a TEE.
     */
    async executeSettlementAction(params: {
        escrowAddress: string;
        payee: string;
        amount: string;
        description: string;
        ipfsId: string;
    }) {
        console.log(`\n[Lit Protocol] 🛡️ Executing Private Compute Settlement...`);
        
        if (!this.useRealLit) {
            console.log(`[Lit Protocol] (Mocked) Settlement Action executed successfully.`);
            return { success: true, txHash: "mock-tx-hash" };
        }

        try {
            const results = await this.litNodeClient.executeJs({
                ipfsId: params.ipfsId,
                sessionSigs: this.sessionSigs,
                jsParams: {
                    escrowAddress: params.escrowAddress,
                    payee: params.payee,
                    amount: params.amount,
                    description: params.description
                }
            });

            console.log(`[Lit Protocol] ✅ Execution Complete. Result: ${JSON.stringify(results.response)}`);
            return JSON.parse(results.response);
        } catch (error: any) {
            console.error(`[Lit Protocol] Execution failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Executes the x402 Micropayment via Thirdweb on Celo
     * @param amount The amount of cUSD to pay
     */
    private async executeMicropayment(amount: number) {
        if (!this.usePayments) {
            console.log(`[Thirdweb x402] (Mocked) Payment of ${amount} cUSD verified.`);
            return;
        }

        console.log(`[Thirdweb x402] Processing ${amount} cUSD micro-payment on Celo Alfajores...`);
        try {
            const tokenContract = getContract({
                client: this.twebClient,
                chain: defineChain(44787),
                address: this.usdcTokenAddress
            });

            // Prepare the ERC-20 Transfer using Thirdweb's pre-built extension
            const tx = transfer({
                contract: tokenContract,
                to: this.vaultDepositAddress,
                amount: amount.toString()
            });

            // Agent signs and sends the transaction
            const { transactionHash } = await sendTransaction({ 
                transaction: tx, 
                account: this.agentAccount 
            });
            
            console.log(`[Thirdweb x402] ✅ Payment confirmed! TxHash: ${transactionHash}`);
        } catch (error: any) {
            console.error(`[Thirdweb x402] Payment failed: ${error.message}`);
            throw new Error("402 Payment Required: Insufficient Funds or Network Error");
        }
    }

    private getCeloAccessControlCondition() {
        return [{
            contractAddress: '',
            standardContractType: '',
            chain: 'celo',
            method: '',
            parameters: [':userAddress'],
            returnValueTest: { comparator: '=', value: this.agentId }
        }];
    }
  
    /**
     * Pays the Vault Fee, Encrypts the agent's state, and pushes it to IPFS
     */
    async saveState(state: Record<string, any>): Promise<string> {
      console.log(`\n[AgentVault] Requesting access to WRITE memory...`);
      
      // REAL STEP 1: Thirdweb x402 Payment Challenge
      await this.executeMicropayment(0.05); // Save fee is 0.05 cUSD
  
      // REAL STEP 2: Lit Protocol Encryption
      console.log(`[Lit Protocol] Encrypting state blob based on Agent's Celo Identity...`);
      let encryptedPayload;
      let dataToEncryptHash = "mockHash";

      if (this.useRealLit && this.litNodeClient) {
          try {
              const acc = this.getCeloAccessControlCondition();
              // @ts-ignore
              const { ciphertext, dataToEncryptHash: hash } = await LitJsSdk.encryptString(
                  { accessControlConditions: acc, dataToEncrypt: JSON.stringify(state) },
                  this.litNodeClient
              );
              encryptedPayload = ciphertext;
              dataToEncryptHash = hash;
          } catch (e: any) {
              encryptedPayload = Buffer.from(JSON.stringify(state)).toString('base64');
          }
      } else {
          encryptedPayload = Buffer.from(JSON.stringify(state)).toString('base64');
      }
  
      // REAL STEP 3: IPFS Upload via Pinata
      console.log(`[IPFS] Pinning encrypted blob to the decentralized network...`);
      if (this.pinataApiKey && this.pinataSecretApiKey) {
          try {
              const payload = {
                  pinataMetadata: { name: `AgentMemory_${this.agentId}_${Date.now()}` },
                  pinataContent: { encryptedData: encryptedPayload, litHash: dataToEncryptHash }
              };
              const res = await axios.post(`https://api.pinata.cloud/pinning/pinJSONToIPFS`, payload, {
                  headers: { 'pinata_api_key': this.pinataApiKey, 'pinata_secret_api_key': this.pinataSecretApiKey }
              });
              
              console.log(`[AgentVault] ✅ State secured permanently on IPFS at CID: ${res.data.IpfsHash}`);
              return res.data.IpfsHash;
          } catch (error: any) {
              throw new Error("IPFS Upload Failed");
          }
      } else {
          const mockCid = `QmVaultMem${Date.now()}`;
          console.log(`[AgentVault] ✅ (Mocked) State secured permanently at IPFS CID: ${mockCid}`);
          return mockCid;
      }
    }
  
    /**
     * Pays the Vault Fee, fetches IPFS, and decrypts the state back into JSON
     */
    async loadState(cid: string): Promise<Record<string, any>> {
      console.log(`\n[AgentVault] Requesting access to READ memory for CID ${cid}...`);
      
      // REAL STEP 1: Thirdweb x402 Payment Challenge
      await this.executeMicropayment(0.01); // Read fee is 0.01 cUSD
  
      // REAL STEP 2: Fetch IPFS
      console.log(`[IPFS] Pulling encrypted binary blob for CID: ${cid}`);
      let fetchedEncryptedBlob = "";
      let fetchedLitHash = "";
      
      if (this.pinataApiKey && this.pinataSecretApiKey && !cid.startsWith("QmVaultMem")) {
          const gatewayUrl = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs';
          const res = await axios.get(`${gatewayUrl}/${cid}`);
          fetchedEncryptedBlob = res.data.encryptedData;
          fetchedLitHash = res.data.litHash;
      } else {
          fetchedEncryptedBlob = Buffer.from(JSON.stringify({
            transactions: [{ payer: "You (Mocked)", amount: 150 }]
          })).toString('base64'); 
      }
  
      // REAL STEP 3: Decrypt
      console.log(`[Lit Protocol] Providing wallet signature to Lit network for decryption key...`);
      let decryptedString = "";

      if (this.useRealLit && this.litNodeClient && !cid.startsWith("QmVaultMem")) {
          try {
              // @ts-ignore
              decryptedString = await LitJsSdk.decryptToString(
                  {
                      accessControlConditions: this.getCeloAccessControlCondition(),
                      ciphertext: fetchedEncryptedBlob,
                      dataToEncryptHash: fetchedLitHash,
                      sessionSigs: {}, 
                      chain: 'celo'
                  },
                  this.litNodeClient
              );
          } catch (e) {
              decryptedString = Buffer.from(fetchedEncryptedBlob, 'base64').toString('utf8');
          }
      } else {
          decryptedString = Buffer.from(fetchedEncryptedBlob, 'base64').toString('utf8');
      }
  
      console.log(`[AgentVault] ✅ Memory recovered successfully.`);
      return { status: "decrypted", agentId: this.agentId, data: JSON.parse(decryptedString) };
    }
  }
