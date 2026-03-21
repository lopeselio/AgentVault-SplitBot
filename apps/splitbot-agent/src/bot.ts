import 'dotenv/config';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';
// @ts-ignore
import { AgentVault } from './AgentVault';

// Validations
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const elevenKey = process.env.ELEVENLABS_API_KEY;

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");
if (!geminiKey) throw new Error("GEMINI_API_KEY missing!");

// Initializations
const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(geminiKey);
const vault = new AgentVault('SplitBot_v1_Mainnet');

const ESCROW_ADDRESS = "0xF768A55F53e366b20819657dE10Da4D7Fb977aB8";
const SETTLE_LIT_ACTION_IPFS_ID = "Qmd5EedfkqnpN8WciScAjaFFPDeF6VVs7c1Y4nJAwHCSnn"; 

// PERSISTENT STATE (Synced with AgentVault/IPFS)
let tripTransactions: any[] = [];
let userRegistry: Record<string, string> = {}; // Maps Telegram ID -> Celo Wallet

/**
 * Persists the entire agent brain to the Celo AgentVault
 */
async function syncMemory() {
    return await vault.saveState({
        transactions: tripTransactions,
        registry: userRegistry,
        lastUpdated: new Date().toISOString()
    });
}

/**
 * Parses conversational text OR audio into structured JSON using Google Gemini
 */
async function parseExpenseWithGemini(user: string, inputData: { text?: string, audio?: Buffer }) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    let promptParts: any[] = [];
    if (inputData.audio) {
        promptParts.push({ inlineData: { data: inputData.audio.toString('base64'), mimeType: "audio/ogg" } });
    }

    promptParts.push(`
    You are an AI Agent managing a group trip. The user ${user} sent a message.
    ${inputData.text ? `Text: "${inputData.text}"` : "Audio memo attached."}
    
    Extract the financial expense. Return strictly raw JSON:
    { "payer": "name", "amount": numeric_amount, "description": "reason" }
    If not an expense, return {"error": "not an expense"}.
    `);
    
    const result = await model.generateContent(promptParts);
    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '');
    return JSON.parse(responseText);
}

async function calculateSettlementsWithGemini(transactions: any[]) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Transactions: ${JSON.stringify(transactions)}. Calculate optimal settlement debts. Return raw JSON array: [{"debtor": "name", "creditor": "name", "amount": numeric}]`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '');
    return JSON.parse(responseText);
}

async function generateSpeechWithElevenLabs(text: string): Promise<Buffer | null> {
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

// ----------------------------------------------------
// HANDLERS
// ----------------------------------------------------

bot.command('start', (ctx) => {
    ctx.reply("👋 Welcome to the Group Trip AI Agent!\n\n1️⃣ Use `/register <0xAddress>` to link your Celo wallet.\n2️⃣ Tell me expenses: 'Paid 50 for gas'.\n3️⃣ Type `/settle` for secure Lit Compute settlement.");
});

bot.command('register', async (ctx) => {
    const address = ctx.message.text.split(' ')[1];
    if (!address || !address.startsWith('0x') || address.length !== 42) {
        return ctx.reply("❌ Usage: `/register <Celo_Wallet_Address>`");
    }

    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name;
    userRegistry[userName.toLowerCase()] = address; // Store by name for easy matching in LLM outputs

    await ctx.reply(`✅ Wallet Linked! ${userName} is now associated with ${address.substring(0,6)}...`);
    await syncMemory();
});

bot.command('settle', async (ctx) => {
    await ctx.reply(`🧮 Agent is crunching numbers...`);
    try {
        const settlements = await calculateSettlementsWithGemini(tripTransactions);
        if (settlements.length === 0) return ctx.reply("Everyone is settled up!");

        for (const debt of settlements) {
            const creditorName = debt.creditor.toLowerCase();
            const address = userRegistry[creditorName];
            
            if (!address) {
                await ctx.reply(`⚠️ Cannot settle for ${debt.creditor} (Wallet not registered). Ask them to use /register.`);
                continue;
            }

            await ctx.reply(`🛡️ Requesting Secure Lit Action for ${debt.creditor}...`);
            await vault.executeSettlementAction({
                escrowAddress: ESCROW_ADDRESS, payee: address, amount: debt.amount.toString(),
                description: `Split: ${debt.debtor} to ${debt.creditor}`, ipfsId: SETTLE_LIT_ACTION_IPFS_ID
            });

            const minipayLink = `https://minipay.xyz/pay?address=${address}&currency=USDC&amount=${debt.amount}`;
            await ctx.reply(
                `💰 **Settlement Ready!**\n${debt.debtor} owes ${debt.creditor} ${debt.amount} USDC.\n\n➡️ [Pay via MiniPay](${minipayLink})`, 
                { parse_mode: 'Markdown' }
            );
        }
    } catch (e: any) { ctx.reply(`❌ Math Error: ${e.message}`); }
});

bot.on('voice', async (ctx) => {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await axios.get(fileLink.toString(), { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(response.data);

    await ctx.reply(`🎙️ AI Agent listening...`);
    try {
        const expense = await parseExpenseWithGemini(ctx.from.first_name, { audio: audioBuffer });
        if (expense.error) return ctx.reply("Agent: No expense detected.");

        tripTransactions.push(expense);
        const cid = await syncMemory();
        await ctx.reply(`✅ *Logged:* ${expense.payer} paid ${expense.amount}.\n🔒 Memory CID: \`${cid.substring(0,12)}\``, { parse_mode: 'Markdown' });

        const audio = await generateSpeechWithElevenLabs(`Logged ${expense.amount} for ${expense.description}.`);
        if (audio) await ctx.replyWithVoice({ source: audio });
    } catch (e: any) { ctx.reply(`❌ Voice Error: ${e.message}`); }
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await ctx.reply(`🎙️ AI Agent reading...`);
    try {
        const expense = await parseExpenseWithGemini(ctx.from.first_name, { text: ctx.message.text });
        if (expense.error) return ctx.reply("Agent: No expense detected.");

        tripTransactions.push(expense);
        const cid = await syncMemory();
        await ctx.reply(`✅ *Logged:* ${expense.payer} paid ${expense.amount}.\n🔒 Memory CID: \`${cid.substring(0,12)}\``, { parse_mode: 'Markdown' });

        const audio = await generateSpeechWithElevenLabs(`Recorded ${expense.amount} from ${expense.payer}.`);
        if (audio) await ctx.replyWithVoice({ source: audio });
    } catch (e: any) { ctx.reply(`❌ Error: ${e.message}`); }
});

async function boot() {
    await vault.setup();
    bot.launch();
    console.log('\n🤖 [Telegram] Mainnet-Ready SplitBot is LIVE!');
}
boot().catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
