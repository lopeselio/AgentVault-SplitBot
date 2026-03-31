import axios from 'axios';

/** True if `s` looks like an IPFS CID (v0 Qm… or v1 baf…), not inline JS. */
export function looksLikeIpfsCid(s: string): boolean {
  const t = s.trim();
  if (t.includes('function main') || t.includes('async function main')) return false;
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{40,}|baf[a-z0-9]{50,})$/i.test(t);
}

/**
 * `POST /lit_action` expects **`code` = JavaScript source**. A pinned CID must be fetched first.
 * Tries public gateways (w3s, dweb, Pinata); override base with `PINATA_GATEWAY_URL` if needed.
 */
export async function fetchLitActionSourceFromCid(cid: string): Promise<string> {
  const id = cid.trim();
  const bases = [
    `https://w3s.link/ipfs/${id}`,
    `https://dweb.link/ipfs/${id}`,
    (process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs').replace(/\/$/, '') +
      `/${id}`,
  ];
  let last = '';
  for (const url of bases) {
    try {
      const res = await axios.get<string>(url, {
        timeout: 45_000,
        validateStatus: (st) => st === 200,
        responseType: 'text',
      });
      const body = typeof res.data === 'string' ? res.data : String(res.data);
      if (body.length > 80 && /(async\s+)?function\s+main\s*\(/.test(body)) return body;
      last = `short or invalid script from ${url}`;
    } catch (e: unknown) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(
    `Lit Action: could not fetch JS for CID ${id.slice(0, 20)}… (${last}). Pin with scripts/pin-lit-action.ts and ensure gateways can read the CID.`,
  );
}

/**
 * Resolve `LIT_SETTLEMENT_IPFS_CID` / param: either return inline code or fetch from IPFS.
 */
export async function resolveLitActionCode(ipfsIdOrInline: string): Promise<string> {
  const raw = ipfsIdOrInline.trim();
  if (!looksLikeIpfsCid(raw)) return raw;
  return fetchLitActionSourceFromCid(raw);
}

/**
 * Lit **core HTTP API** (`POST /core/v1/lit_action`).
 *
 * Same contract as cURL and the official “Core SDK” (`LitNodeSimpleApiClient.litAction`):
 * https://developer.litprotocol.com/management/api_direct#7-run-lit-action
 *
 * Auth: `X-Api-Key` or `Authorization: Bearer <key>` (usage key recommended).
 * OpenAPI: https://api.dev.litprotocol.com/swagger-ui/
 *
 * Lit Actions examples (entrypoint `async function main({ ... }) { ... }`):
 * https://developer.litprotocol.com/lit-actions/examples
 */
export function getLitCoreApiBase(): string {
  const raw = process.env.LIT_CORE_API_BASE?.trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'https://api.dev.litprotocol.com/core/v1';
}

/**
 * Request body for `POST .../lit_action` (snake_case per API).
 * `code` must be **JavaScript source** (not a CID). Resolve CID → source via `resolveLitActionCode` first.
 */
export type LitCoreLitActionRequest = {
  code: string;
  js_params?: Record<string, unknown> | null;
};

/** @deprecated Use LitCoreLitActionRequest */
export type ChipotleLitActionRequest = LitCoreLitActionRequest;

export type LitCoreLitActionResponse = {
  has_error: boolean;
  logs: string;
  response: unknown;
};

/** @deprecated Use LitCoreLitActionResponse */
export type ChipotleLitActionResponse = LitCoreLitActionResponse;

/**
 * Run a Lit Action via the core API (`POST /lit_action`).
 * Prefer a **usage** API key with `execute_in_groups` scoped to the group that contains this action + PKP.
 */
export async function runLitAction(
  apiKey: string,
  body: LitCoreLitActionRequest
): Promise<LitCoreLitActionResponse> {
  const res = await axios.post<LitCoreLitActionResponse | { err?: string }>(
    `${getLitCoreApiBase()}/lit_action`,
    {
      code: body.code,
      js_params: body.js_params ?? null,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      validateStatus: () => true,
    }
  );
  const data = res.data;
  if (res.status >= 400) {
    throw new Error(`Lit core API lit_action HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  if (typeof data === 'object' && data && 'has_error' in data && data.has_error) {
    throw new Error(`Lit lit_action: ${(data as LitCoreLitActionResponse).logs || 'unknown error'}`);
  }
  if (typeof data === 'object' && data && 'response' in data) {
    return data as LitCoreLitActionResponse;
  }
  throw new Error(`Lit lit_action unexpected response ${JSON.stringify(data)}`);
}

/** Alias kept for existing imports. */
export const runChipotleLitAction = runLitAction;
