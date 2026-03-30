import type { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from './config.js';

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function isTransientGeminiError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|try again|Service Unavailable/i.test(
        msg
    );
}

/** Primary model from config (for logging / rare direct use). */
export function getGeminiModel(genAI: GoogleGenerativeAI) {
    return genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

/** Ordered fallbacks if primary keeps returning 503 (same region may differ). */
function modelChain(): string[] {
    const fallbacks = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-8b'];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of [GEMINI_MODEL, ...fallbacks]) {
        if (!seen.has(m)) {
            seen.add(m);
            out.push(m);
        }
    }
    return out;
}

async function generateContentOnModel(
    model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
    modelLabel: string,
    request: Parameters<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>[0],
    options?: { maxRetries?: number; baseMs?: number }
): Promise<Awaited<ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>>> {
    const maxRetries = options?.maxRetries ?? 4;
    const baseMs = options?.baseMs ?? 1000;
    let last: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await model.generateContent(request);
        } catch (e) {
            last = e;
            if (!isTransientGeminiError(e) || attempt === maxRetries - 1) {
                throw e;
            }
            const delay = baseMs * Math.pow(2, attempt);
            console.warn(
                `[Gemini] transient error (${modelLabel}), retry ${attempt + 1}/${maxRetries} in ${delay}ms…`
            );
            await sleep(delay);
        }
    }
    throw last;
}

/**
 * Retries on 503/429, then tries fallback model ids (still versioned — avoids `*-latest` overload).
 */
export async function generateContentWithRetry(
    genAI: GoogleGenerativeAI,
    request: Parameters<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>[0],
    options?: { maxRetries?: number; baseMs?: number }
): Promise<Awaited<ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>>> {
    const chain = modelChain();
    let last: unknown;
    for (let i = 0; i < chain.length; i++) {
        const name = chain[i];
        try {
            const model = genAI.getGenerativeModel({ model: name });
            return await generateContentOnModel(model, name, request, options);
        } catch (e) {
            last = e;
            const lastModel = i === chain.length - 1;
            if (!isTransientGeminiError(e) || lastModel) {
                throw e;
            }
            console.warn(
                `[Gemini] model ${name} still failing after retries — trying ${chain[i + 1]}… (${e instanceof Error ? e.message : e})`
            );
        }
    }
    throw last;
}
