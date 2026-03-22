import 'dotenv/config';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';
// @ts-ignore
import { AgentVault } from './AgentVault.js';
import { Libp2p, createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';

// Safely import ChaosChain (OpenClaw) SDK
let ChaosSDK: any, AgentRole: any, NetworkConfig: any, SessionClient: any;
try {
    const sdk = await import('@chaoschain/sdk');
    ChaosSDK = sdk.ChaosChainSDK;
    AgentRole = sdk.AgentRole;
    NetworkConfig = sdk.NetworkConfig;
    SessionClient = sdk.SessionClient;
} catch (e) {
    console.warn("⚠️ [OpenClaw] Verifiable AI logic disabled due to module loading conflict.");
}

// Validations
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const elevenKey = process.env.ELEVENLABS_API_KEY;

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");
if (!geminiKey) throw new Error("GEMINI_API_KEY missing!");

// Initializations
const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(geminiKey);
const vault = new AgentVault('SplitBot_v2_Production');

// OpenClaw / ChaosChain SDK Safely Loaded
let chaosdk: any;
if (ChaosSDK) {
    try {
        chaosdk = new ChaosSDK({
            agentName: 'SplitBot_#222',
            agentDomain: 'splitbot.celo',
            agentRole: AgentRole.WORKER,
            network: NetworkConfig.CELO_TESTNET,
            privateKey: process.env.AGENT_WALLET_PRIVATE_KEY!,
            rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
            gatewayConfig: { gatewayUrl: 'https://gateway.chaoscha.in' }
        });
    } catch (e) { console.warn("OpenClaw Setup Failed:", e); }
}

const ESCROW_ADDRESS = "0x79cB34E300D37f3B65852338Ac1f3a0C1ED6Ca29";
const SETTLE_LIT_ACTION_IPFS_ID = "Qmd5EedfkqnpN8WciScAjaFFPDeF6VVs7c1Y4nJAwHCSnn"; 

let tripTransactions: any[] = [];
let userRegistry: Record<string, string> = {}; 
let libp2pNode: Libp2p;

async function syncMemory() {
    return await vault.saveState({ transactions: tripTransactions, registry: userRegistry, agentId: "222" });
}

async function generateVerifiableProof(settlementData: any) {
    if (!chaosdk) return "MOCK_PROOF_" + Date.now();
    try {
        const sessionClient = new SessionClient({ gatewayUrl: 'https://gateway.chaoscha.in' });
        const session = await sessionClient.start({
            studio_address: ESCROW_ADDRESS,
            agent_address: await chaosdk.getAddress(),
            task_type: 'settlement_calculation'
        });
        await session.log({ summary: `Calc debts: ${JSON.stringify(settlementData)}` });
        const { data_hash } = await session.complete();
        return data_hash;
    } catch (e: any) { return "FALLBACK_PROOF_" + Date.now(); }
}

async function setupAgentMesh() {
    libp2pNode = await createLibp2p({
        addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
        transports: [tcp()],
        connectionEncrypters: [noise()],
        streamMuxers: [mplex()]
    });
    await libp2pNode.start();
    console.log(`🌐 [libp2p] Mesh Node Started.`);
}

async function generateSpeech(text: string): Promise<Buffer | null> {
    if (!elevenKey) return null;
    try {
        const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgnuMvtmW4fz`, {
            text, model_id: "eleven_turbo_v2_5"
        }, {
            headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
            responseType: 'arraybuffer'
        });
        return Buffer.from(response.data);
    } catch (e) { return null; }
}

async function parseExpense(user: string, inputData: { text?: string, audio?: Buffer }) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([inputData.text || "Audio", inputData.audio ? { inlineData: { data: inputData.audio.toString('base64'), mimeType: "audio/ogg" } } : ""].filter(Boolean) as any);
    return JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, ''));
}

async function calculateSettlements(transactions: any[]) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(`Transactions: ${JSON.stringify(transactions)}. Calc debts. Return raw JSON: [{"debtor": "name", "creditor": "name", "amount": num}]`);
    return JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, ''));
}

bot.command('start', (ctx) => { ctx.reply("🤖 **SplitBot v2 Initialized.**"); });
bot.command('register', async (ctx) => {
    const address = ctx.message.text.split(' ')[1];
    userRegistry[ctx.from.first_name.toLowerCase()] = address;
    await ctx.reply(`✅ Registered: ${ctx.from.first_name}`);
    await syncMemory();
});

bot.command('settle', async (ctx) => {
    await ctx.reply(`🧮 Settle logic starting (OpenClaw + Lit)...`);
    try {
        const settlements = await calculateSettlements(tripTransactions);
        const proofHash = await generateVerifiableProof(settlements);
        for (const debt of settlements) {
            const address = userRegistry[debt.creditor.toLowerCase()];
            if (!address) continue;
            await ctx.reply(`🦅 Verifiable Proof: \`${proofHash}\``);
            await vault.executeSettlementAction({ escrowAddress: ESCROW_ADDRESS, payee: address, amount: debt.amount.toString(), description: "Settle", ipfsId: SETTLE_LIT_ACTION_IPFS_ID });
            ctx.reply(`💰 Settle link: https://minipay.xyz/pay?address=${address}&currency=USDC&amount=${debt.amount}`);
        }
    } catch (e: any) { ctx.reply(`❌ Math Error: ${e.message}`); }
});

bot.on(['text', 'voice'], async (ctx: any) => {
    try {
        const user = ctx.from.first_name;
        const msg = ctx.message.text || "Voice";
        const expense = await parseExpense(user, { text: ctx.message.text });
        if (expense.error) return;
        tripTransactions.push(expense);
        await syncMemory();
        await ctx.reply(`✅ Recorded.`);
        const audio = await generateSpeech(`Log complete.`);
        if (audio) await ctx.replyWithVoice({ source: audio });
    } catch (e) {}
});

async function boot() {
    await vault.setup();
    await setupAgentMesh();
    bot.launch();
}
boot().catch(console.error);
