/**
 * Resolve Lit Action source for vault PKP crypto: optional IPFS CID or bundled `vaultPkpCrypto.js`.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { LIT_VAULT_CRYPTO_IPFS_CID } from './config.js';
import { resolveLitActionCode } from './chipotleClient.js';

const _dirname = dirname(fileURLToPath(import.meta.url));

/** Stored in memory JSON `litHash` when using Chipotle Lit.Actions.Encrypt (HTTPS /lit_action path). */
export const LIT_VAULT_LIT_ACTION_HASH = 'lit_action_pkp_v1';

let bundled: string | null = null;

export function getBundledVaultPkpCryptoLitAction(): string {
    if (bundled) return bundled;
    const path = join(_dirname, '../../../packages/agent-vault/src/lit-actions/vaultPkpCrypto.js');
    bundled = readFileSync(path, 'utf8');
    return bundled;
}

export async function resolveVaultCryptoLitActionCode(): Promise<string> {
    const cid = LIT_VAULT_CRYPTO_IPFS_CID?.trim();
    if (cid) return resolveLitActionCode(cid);
    return getBundledVaultPkpCryptoLitAction();
}
