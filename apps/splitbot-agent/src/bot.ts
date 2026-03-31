import 'dotenv/config';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import express, { type RequestHandler } from 'express';
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
    ESCROW_ADDRESS,
    RPC_URL,
    SETTLEMENT_MODE,
    AGENT_VAULT_ID,
    GEMINI_MODEL,
    USDC_DECIMALS,
    getAgentAccount,
} from './config.js';
import { generateContentWithRetry } from './gemini.js';
import { executeEscrowSettlement, type SettlementDebt } from './settlement.js';
import { submitReputationAfterSettle, submitValidationRequest } from './erc8004.js';
import { archiveJsonToFilecoinBacked } from './filecoinArchive.js';
import { startAgentMesh, publishMeshMessage } from './agentMesh.js';
import { appendAgentLog } from './agentLog.js';
import type { Libp2p } from 'libp2p';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Escape user/content for Telegram <code>parse_mode: HTML</code>. */
function tgHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const app = express();
// cors@2 types target Express 4; Express 5 Response differs — bridge via unknown.
app.use(cors() as unknown as RequestHandler);
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

            const prompt = `Transactions Log: ${JSON.stringify(
                tripTransactions
            )}. Calculate the net settlements remaining to balance the trip. Return ONLY A RAW JSON ARRAY. Format: [{"debtor": "name", "creditor": "name", "amount": number}]`;
            const result = await generateContentWithRetry(genAI, prompt);
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
const escrowPoolAbi = parseAbi(['function totalPool() view returns (uint256)']);

/** Default 90s is too short for /settle (Gemini + Lit + chain + IPFS). Override with TELEGRAM_HANDLER_TIMEOUT_MS. */
const TELEGRAM_HANDLER_TIMEOUT_MS = (() => {
    const n = Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS);
    return Number.isFinite(n) && n >= 90_000 ? n : 600_000;
})();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, {
    handlerTimeout: TELEGRAM_HANDLER_TIMEOUT_MS,
});

bot.catch((err: unknown) => {
    const e = err as { response?: { error_code?: number; description?: string } };
    if (e?.response?.error_code === 409) {
        console.error(
            '\n[Telegram] 409 Conflict: another client is already using getUpdates with this bot token.\n' +
                '  • Stop other terminals running the bot (npm start / dev / start:no-lit).\n' +
                '  • Stop deployed workers or tunnels using the same TELEGRAM_BOT_TOKEN.\n' +
                '  • Or create a second bot via @BotFather for parallel local testing.\n',
        );
        process.exit(1);
    }
    console.error('[Telegram]', err);
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const vault = new AgentVault(AGENT_VAULT_ID);

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
    // Legacy Markdown breaks on underscores (e.g. SETTLEMENT_MODE → italic). Use HTML.
    ctx.reply(
        `🤖 <b>Celo SplitBot v2 Ready!</b>\n\n` +
            `Settlement: <b>${tgHtml(SETTLEMENT_MODE)}</b> (env <code>SETTLEMENT_MODE</code>: <code>escrow</code> or <code>minipay</code>)\n\n` +
            `<b>Commands:</b>\n` +
            `/register &lt;wallet&gt; - Link your Celo ID\n` +
            `/agent - Check Agent Balance\n` +
            `/pool - USDC in TripEscrow contract\n` +
            `/history - View logged expenses\n` +
            `/settle - Finalize Trip Expenses`,
        { parse_mode: 'HTML' },
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

bot.command('pool', async (ctx) => {
    try {
        const poolWei = await client.readContract({
            address: ESCROW_ADDRESS,
            abi: escrowPoolAbi,
            functionName: 'totalPool',
        });
        const usdc = formatUnits(poolWei, USDC_DECIMALS);
        const note =
            SETTLEMENT_MODE === 'escrow'
                ? 'In <b>escrow</b> mode, <code>/settle</code> pays creditors from this pool (needs enough USDC here).'
                : 'Mode is <b>minipay</b> (P2P transfers). Pool is still the on-chain TripEscrow balance if you fund it for demos.';
        await ctx.reply(
            `🏦 <b>TripEscrow pool</b>\n\n` +
                `<b>${tgHtml(usdc)}</b> USDC\n\n` +
                `Contract: <code>${tgHtml(ESCROW_ADDRESS)}</code>\n\n` +
                note,
            { parse_mode: 'HTML' }
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await ctx.reply(`❌ Could not read pool: ${msg}`);
    }
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
    if (tripTransactions.length === 0)
        return ctx.reply('ℹ️ No expenses logged yet. Send a message like \'I paid $50 for dinner\' to start!');
    await ctx.reply('🧮 Calculating final settlements with AI (plan → verify → execute)...');
    const prompt = `Transactions Log: ${JSON.stringify(tripTransactions)}. 
    
    Calculate the net settlements to balance the trip. 
    Deduplicate: Each person should either pay or receive ONCE in total if possible.
    
    RETURN ONLY A RAW JSON ARRAY. NO TEXT BEFORE OR AFTER.
    Format: [{"debtor": "name", "creditor": "name", "amount": number}]`;

    try {
        const result = await generateContentWithRetry(genAI, prompt);
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
            const key = debt.creditor.trim().toLowerCase();
            let creditorAddr = userRegistry[key];
            // AI may use a nickname; try first token if exact match missing (e.g. "Elio L." vs "elio")
            if (!creditorAddr && key.includes(' ')) {
                const first = key.split(/\s+/)[0]!;
                creditorAddr = userRegistry[first];
            }
            if (!creditorAddr) {
                const names = Object.keys(userRegistry);
                const list = names.length ? names.map((n) => `• ${n}`).join('\n') : '_(none yet)_';
                await ctx.reply(
                    `⚠️ No wallet for creditor **${debt.creditor}**.\n\n` +
                        `**Registered** (Telegram first name → wallet):\n${list}\n\n` +
                        `The creditor must **/register** from their Telegram account:\n` +
                        `\`/register 0x…\`\n\n` +
                        `Names in the settlement must match those **first names** (or the AI may shorten "Name Surname" to the first name only).`,
                    { parse_mode: 'Markdown' }
                );
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
        const msg = e?.message || String(e);
        console.error(`❌ AI Settlement Error: ${msg}`);
        if (/503|429|high demand|UNAVAILABLE/i.test(msg)) {
            await ctx.reply(
                '⏳ Google AI is busy (503). Wait ~30s and run /settle again — the bot will try backup models automatically.'
            );
        } else {
            await ctx.reply('❌ AI calculation failed. Please try again.');
        }
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
        const analysisPrompt = `Transactions Log: ${JSON.stringify(tripTransactions)}. 
        1. Calculate net balances for each person.
        2. Assign a 'Reputation Rank' (e.g. Platinum Settler, Trustworthy, Solvent, or Debtor) based on their history.
        3. Give a very brief, friendly conversational summary. Who is owed? Who owes? Who is 'All Clear'?
        Format with emojis and clean spacing. No intro/outro.`;
        const result = await generateContentWithRetry(genAI, analysisPrompt);

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

        const res = await generateContentWithRetry(genAI, promptContent);
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
        const msg = e?.message || String(e);
        console.error('❌ Agent Parsing Error:', msg);
        if (/503|429|high demand|UNAVAILABLE/i.test(msg)) {
            await ctx.reply(
                '⏳ Google AI is temporarily busy. Please wait a few seconds and send your expense again.'
            );
        }
    }
});

async function boot() {
    validateProdEnv();
    console.log(
        `[Telegram] handler timeout ${TELEGRAM_HANDLER_TIMEOUT_MS / 1000}s (long commands like /settle; set TELEGRAM_HANDLER_TIMEOUT_MS to override)`,
    );
    console.log(`[Gemini] model=${GEMINI_MODEL} (override with GEMINI_MODEL in .env)`);
    await vault.setup();
    await vault.logPersistenceDiagnostics();
    vault.logLitIntegrationDiagnostics();

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

    // Polling requires no active webhook and no second poller (same token).
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch();
    console.log('🌟 SplitBot ONLINE');
}
boot().catch(console.error);
