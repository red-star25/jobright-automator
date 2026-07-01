import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sqlPath = join(__dirname, "../../migrations/001_initial.sql");
  const sql = readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Migration applied: 001_initial.sql");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
