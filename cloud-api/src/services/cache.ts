import { query } from "../db/pool.js";

export type CachedRewriteResponse = {
  text: string;
  subject?: string;
  proofPoint?: string;
};

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export async function getCachedResponse(cacheKey: string): Promise<CachedRewriteResponse | null> {
  const result = await query<{ response: CachedRewriteResponse; created_at: Date }>(
    `select response, created_at from ai_response_cache where cache_key = $1`,
    [cacheKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > CACHE_TTL_MS) return null;
  return row.response;
}

export async function setCachedResponse(cacheKey: string, response: CachedRewriteResponse) {
  await query(
    `insert into ai_response_cache (cache_key, response, created_at)
     values ($1, $2, now())
     on conflict (cache_key) do update set response = excluded.response, created_at = now()`,
    [cacheKey, JSON.stringify(response)]
  );
}

export async function pruneExpiredCache() {
  await query(
    `delete from ai_response_cache where created_at < now() - interval '14 days'`
  );
}
