/**
 * Production profile: fail fast when required secrets are missing.
 */
export function validateProdEnv() {
  if (process.env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  if (!process.env.AGENT_WALLET_PRIVATE_KEY) missing.push('AGENT_WALLET_PRIVATE_KEY');
  if (missing.length) {
    throw new Error(`[env] production missing: ${missing.join(', ')}`);
  }
}
