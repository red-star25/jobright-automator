import pg from "pg";
import { env } from "../config/env.js";

function poolConfig(): pg.PoolConfig {
  const connectionString = env.DATABASE_URL;
  const needsSsl =
    /neon\.tech/i.test(connectionString) ||
    /sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ||
    process.env.NODE_ENV === "production";

  return {
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export const pool = new pg.Pool(poolConfig());

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
