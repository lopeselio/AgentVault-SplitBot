import 'dotenv/config';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ethers } from 'ethers';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createPublicClient, http, formatEther, formatUnits, parseAbi } from 'viem';
import { celoAlfajores } from 'viem/chains';
import { AgentVault } from './AgentVault.js';
import { validateProdEnv } from './env.js';
import {
    USDC_ADDRESS,
    RPC_URL,
    SETTLEMENT_MODE,
    getAgentAccount,
} from './config.js';
import { executeEscrowSettlement, type SettlementDebt } from './settlement.js';
import { submitReputationAfterSettle, submitValidationRequest } from './erc8004.js';
import { archiveJsonToFilecoinBacked } from './filecoinArchive.js';
import { startAgentMesh, publishMeshMessage } from './agentMesh.js';
import { appendAgentLog } from './agentLog.js';
import type { Libp2p } from 'libp2p';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

app.get('/pay', (req: express.Request, res: express.Response) => {
    res.sendFile(join(__dirname, '../public/pay.html'));
});

app.post('/api/payment-success', async (req: express.Request, res: express.Response) => {
    try {
        const { chatId, debtor, creditor, amount, hash } = req.body;

        tripTransactions.push({
            payer: debtor,
            amount: amount,
            description: `Settled debt with ${creditor}`,
        });

        const cid = await vault.saveState({ transactions: tripTransactions, registry: userRegistry });
        console.log(`✅ [Settlement Logged] CID: ${cid}`);

        if (chatId) {
            await bot.telegram.sendMessage(
                chatId,
                `🎉 **Settlement Complete!**\n\n💸 **${debtor}** successfully paid **${creditor}** **${amount} USDC**!\n🔗 [View on CeloScan](https://sepolia.celoscan.io/tx/${hash})\n\n*(State securely updated in AgentVault)*`,
                { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
            );

            const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
            const prompt = `Transactions Log: ${JSON.stringify(
                tripTransactions
            )}. Calculate the net settlements remaining to balance the trip. Return ONLY A RAW JSON ARRAY. Format: [{"debtor": "name", "creditor": "name", "amount": number}]`;
            const result = await model.generateContent(prompt);
            const rawText = result.response.text();

            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const settlements = JSON.parse(jsonMatch[0]);
                if (settlements.length === 0) {
                    await bot.telegram.sendMessage(
                        chatId,
                        `🎊 **The Group Ledger is now perfectly balanced!** 0.00 USDC owed by anyone.`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    let summary = '🔄 **Remaining Balances:**\n';
                    for (const debt of settlements)
                        summary += `• ${debt.debtor} still owes ${debt.creditor} ${debt.amount} USDC\n`;
                    await bot.telegram.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
                }
            }
        }
        res.json({ success: true });
    } catch (e: any) {
        console.error(`❌ Webhook Error: ${e.message}`);
        res.status(500).json({ error: 'Webhook failed' });
    }
});

app.listen(3000, () => {
    console.log(`🌍 [MiniApp] Payment Portal running. Expose via: ngrok http 3000`);
});

const client = createPublicClient({
    chain: {
        ...celoAlfajores,
        id: 11142220,
        rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
    },
    transport: http(),
});
const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const vault = new AgentVault('SplitBot_FINAL_DEMO');

let tripTransactions: any[] = [];
let userRegistry: Record<string, string> = {};
let meshNode: Libp2p | null = null;

async function getBalances(address: string) {
    try {
        const celoBalance = await client.getBalance({ address: address as `0x${string}` });
        const usdcBalance = await client.readContract({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
        });
        return { celo: formatEther(celoBalance), usdc: formatUnits(usdcBalance, 6) };
    } catch {
        return { celo: 'N/A', usdc: 'N/A' };
    }
}

bot.command('start', (ctx) => {
    ctx.reply(
        `🤖 **Celo SplitBot v2 Ready!**\n\n` +
            `Settlement: **${SETTLEMENT_MODE}** (set SETTLEMENT_MODE=escrow|minipay)\n\n` +
            `Commands:\n/register <wallet> - Link your Celo ID\n/agent - Check Agent Balance\n/history - View logged expenses\n/settle - Finalize Trip Expenses`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('agent', async (ctx) => {
    const addr = await vault.getAgentAddress();
    const bal = await getBalances(addr);
    ctx.reply(
        `🤖 **Agent Status**\nWallet: \`${addr}\`\nUSDC: ${bal.usdc}\nCELO: ${bal.celo}\nMode: ${SETTLEMENT_MODE}`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('register', async (ctx) => {
    const address = ctx.message.text.split(' ')[1];
    if (!address) return ctx.reply('❌ Usage: `/register <0xAddress>`');

    userRegistry[ctx.from!.first_name!.toLowerCase()] = address;
    const bal = await getBalances(address);

    const cid = await vault.saveState({ transactions: tripTransactions, registry: userRegistry });
    console.log(`✅ [User Registered] State Pinned: ${cid}`);
    await ctx.reply(
        `✅ **Registered: ${ctx.from!.first_name}**\n🏦 Wallet: \`${address}\`\n💰 Balance:\n💵 USDC: ${bal.usdc}\n💎 CELO: ${bal.celo}`,
        { parse_mode: 'Markdown' }
    );
});

/** Plan → verify → execute: AI proposes settlement vector, then escrow or MiniPay paths. */
bot.command('settle', async (ctx) => {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    if (tripTransactions.length === 0)
        return ctx.reply('ℹ️ No expenses logged yet. Send a message like \'I paid $50 for dinner\' to start!');
    await ctx.reply('🧮 Calculating final settlements with AI (plan → verify → execute)...');
    const prompt = `Transactions Log: ${JSON.stringify(tripTransactions)}. 
    
    Calculate the net settlements to balance the trip. 
    Deduplicate: Each person should either pay or receive ONCE in total if possible.
    
    RETURN ONLY A RAW JSON ARRAY. NO TEXT BEFORE OR AFTER.
    Format: [{"debtor": "name", "creditor": "name", "amount": number}]`;

    try {
        const result = await model.generateContent(prompt);
        const rawText = result.response.text();
        console.log(`🤖 [AI Settlement] Raw Response: ${rawText}`);

        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found');

        const settlements: SettlementDebt[] = JSON.parse(jsonMatch[0]);
        appendAgentLog({
            phase: 'plan',
            action: 'ai_settlement_plan',
            detail: JSON.stringify(settlements),
            chainTx: null,
        });

        for (const debt of settlements) {
            const creditorAddr = userRegistry[debt.creditor.toLowerCase()];
            if (!creditorAddr) {
                await ctx.reply(`⚠️ No wallet for creditor **${debt.creditor}** — register first.`);
                continue;
            }

            if (SETTLEMENT_MODE === 'escrow') {
                await ctx.reply(`🔒 **Escrow mode:** verifying pool + executing on-chain settle for ${debt.creditor}...`);
                try {
                    const r = await executeEscrowSettlement(client as any, vault, debt, creditorAddr as `0x${string}`);
                    tripTransactions.push({
                        payer: debt.debtor,
                        amount: debt.amount,
                        description: `Escrow settle ${r.mode} tx ${r.txHash}`,
                    });
                    await vault.saveState({ transactions: tripTransactions, registry: userRegistry });

                    const agentId = process.env.ERC8004_AGENT_ID;
                    if (agentId) {
                        await submitReputationAfterSettle({
                            agentId: BigInt(agentId),
                            score: 95,
                            detailUri: 'ipfs://settlement-proof',
                            endpoint: APP_URL,
                        });
                        await submitValidationRequest({
                            agentId: BigInt(agentId),
                            validatorAddress: (process.env.VALIDATOR_ADDRESS ||
                                getAgentAccount().address) as `0x${string}`,
                            requestUri: `https://sepolia.celoscan.io/tx/${r.txHash}`,
                        });
                    }

                    await archiveJsonToFilecoinBacked({
                        type: 'settlement',
                        debt,
                        txHash: r.txHash,
                        ts: Date.now(),
                    });

                    if (meshNode && process.env.AGENT_WALLET_PRIVATE_KEY) {
                        const w = new ethers.Wallet(process.env.AGENT_WALLET_PRIVATE_KEY);
                        await publishMeshMessage(meshNode, w, JSON.stringify({ kind: 'settle', debt, tx: r.txHash }));
                    }

                    await ctx.reply(
                        `✅ **Escrow settlement** ${r.mode}\nTx: \`${r.txHash}\`\n[Explorer](https://sepolia.celoscan.io/tx/${r.txHash})`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (err: any) {
                    console.error(err);
                    await ctx.reply(`❌ Escrow settle failed: ${err.message || err}`);
                }
            } else {
                const miniAppUrl = `${APP_URL}/pay?address=${creditorAddr}&amount=${debt.amount}&debtor=${encodeURIComponent(
                    debt.debtor
                )}&creditor=${encodeURIComponent(debt.creditor)}&chatId=${ctx.chat.id}`;
                await ctx.reply(
                    `💰 **${debt.debtor}** owes **${debt.creditor}** ${debt.amount} USDC\n\n📱 **MiniPay (demo):**\n\`${miniAppUrl}\``,
                    {
                        parse_mode: 'Markdown',
                        link_preview_options: { is_disabled: true },
                    }
                );
            }
        }
    } catch (e: any) {
        console.error(`❌ AI Settlement Error: ${e.message}`);
        ctx.reply('❌ AI calculation failed. Please try again.');
    }
});

bot.command('history', async (ctx) => {
    if (tripTransactions.length === 0) return ctx.reply('ℹ️ No expenses logged yet.');

    let summary = '📋 **Trip Expense History**\n\n';
    let total = 0;

    tripTransactions.forEach((t, i) => {
        const isSettlement = t.description && t.description.toLowerCase().includes('settled debt');
        const icon = isSettlement ? '💸' : '🛒';
        summary += `${i + 1}. ${icon} **${t.payer}**: ${t.amount} USDC for ${t.description}\n`;
        if (!isSettlement) {
            total += Number(t.amount || 0);
        }
    });

    summary += `\n💰 **Actual Total Spent**: ${total.toFixed(2)} USDC`;

    const statusMsg = await ctx.reply(summary + '\n\n🧠 *Agent calculates group reputation...*', {
        parse_mode: 'Markdown',
    });

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const analysisPrompt = `Transactions Log: ${JSON.stringify(tripTransactions)}. 
        1. Calculate net balances for each person.
        2. Assign a 'Reputation Rank' (e.g. Platinum Settler, Trustworthy, Solvent, or Debtor) based on their history.
        3. Give a very brief, friendly conversational summary. Who is owed? Who owes? Who is 'All Clear'?
        Format with emojis and clean spacing. No intro/outro.`;
        const result = await model.generateContent(analysisPrompt);

        try {
            await ctx.telegram.editMessageText(
                ctx.chat!.id,
                statusMsg.message_id,
                undefined,
                summary + `\n\n📊 **Agent Intelligence Summary:**\n${result.response.text()}`,
                { parse_mode: 'Markdown' }
            );
        } catch {
            await ctx.telegram.editMessageText(
                ctx.chat!.id,
                statusMsg.message_id,
                undefined,
                summary + `\n\n📊 **Agent Intelligence Summary:**\n${result.response.text()}`
            );
        }
    } catch (e: any) {
        console.error('❌ History AI Error:', e.message);
        await ctx.telegram.editMessageText(ctx.chat!.id, statusMsg.message_id, undefined, summary, {
            parse_mode: 'Markdown',
        });
    }
});

bot.on(['text', 'voice'], async (ctx: any) => {
    try {
        const text = ctx.message.text || '';
        if (text.startsWith('/')) return;

        let promptContent: any[] = [];

        if (ctx.message.voice) {
            await ctx.sendChatAction('record_voice');
            const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
            const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

            promptContent.push({
                inlineData: {
                    data: Buffer.from(response.data).toString('base64'),
                    mimeType: 'audio/ogg',
                },
            });
            promptContent.push(
                `Extract expense from this audio. Return raw JSON: {"payer": "${ctx.from.first_name}", "amount": num, "description": "text"}. If no expense found, return NULL.`
            );
        } else {
            promptContent.push(
                `Extract expense from: "${text}". Return raw JSON: {"payer": "${ctx.from.first_name}", "amount": num, "description": "text"}. If no expense found, return NULL.`
            );
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const res = await model.generateContent(promptContent);
        const content = res.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        if (content === 'NULL') return;

        const expense = JSON.parse(content);
        if (!expense.amount) return;

        tripTransactions.push(expense);
        await vault.saveState({ transactions: tripTransactions, registry: userRegistry });

        const successText = `Got it! ${expense.payer} paid ${expense.amount} USDC for ${expense.description}. I've logged the expense securely.`;

        if (ctx.message.voice && process.env.ELEVENLABS_API_KEY) {
            try {
                const elRes = await axios.post(
                    `https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`,
                    {
                        text: successText,
                        model_id: 'eleven_monolingual_v1',
                        voice_settings: { stability: 0.5, similarity_boost: 0.5 },
                    },
                    {
                        headers: {
                            'xi-api-key': process.env.ELEVENLABS_API_KEY,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'arraybuffer',
                    }
                );
                await ctx.replyWithVoice({ source: Buffer.from(elRes.data) });
            } catch {
                await ctx.reply(`✅ *${successText}*`, { parse_mode: 'Markdown' });
            }
        } else {
            await ctx.reply(`✅ *${successText}*`, { parse_mode: 'Markdown' });
        }
    } catch (e: any) {
        console.error('❌ Agent Parsing Error:', e.message);
    }
});

async function boot() {
    validateProdEnv();
    await vault.setup();

    const lastState = await vault.getLatestState();
    if (lastState && !('status' in lastState && (lastState as any).status === 'error')) {
        const data = lastState as any;
        if (Array.isArray(data.transactions)) tripTransactions = data.transactions;
        if (data.registry && typeof data.registry === 'object') userRegistry = data.registry;
        console.log(
            `📡 [Persistence] Recovered ${tripTransactions.length} transactions and ${Object.keys(userRegistry).length} users from AgentVault.`
        );
    }

    if (process.env.AGENT_WALLET_PRIVATE_KEY) {
        meshNode = await startAgentMesh({
            onMessage: (msg) => console.log('[mesh]', msg.payload),
            getSigner: () => new ethers.Wallet(process.env.AGENT_WALLET_PRIVATE_KEY!),
        });
    }

    bot.launch();
    console.log('🌟 SplitBot ONLINE');
}
boot().catch(console.error);
