import axios from 'axios';

/**
 * Optional Filecoin-backed archival via NFT.Storage (uploads to IPFS with Filecoin persistence).
 * Set NFT_STORAGE_API_KEY. Pinata remains primary; this adds a second CID for audit trails.
 */
export async function archiveJsonToFilecoinBacked(body: Record<string, unknown>): Promise<{
  cid: string;
  url?: string;
} | null> {
  const key = process.env.NFT_STORAGE_API_KEY;
  if (!key) {
    return null;
  }
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    const res = await axios.post('https://api.nft.storage/upload', blob, {
      headers: { Authorization: `Bearer ${key}` },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const cid = res.data?.value?.cid || res.data?.cid;
    if (!cid) return null;
    return { cid, url: `https://${cid}.ipfs.nftstorage.link` };
  } catch (e) {
    console.warn('[filecoin-archive] NFT.Storage upload failed', e);
    return null;
  }
}
