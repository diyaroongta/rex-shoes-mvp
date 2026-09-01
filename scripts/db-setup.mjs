#!/usr/bin/env node
/* Apply db/schema.sql to the database in DATABASE_URL.
 *
 *   DATABASE_URL="postgres://..." npm run db:setup
 *
 * This exists so applying the schema needs nothing but Node and the `pg`
 * package the project already depends on. The previous version shelled out to
 * psql, which is a separate install that many machines do not have — and a
 * missing psql failed with "command not found", which says nothing at all
 * about what the person was actually trying to do.
 *
 * The schema is written to be safe to re-run: every statement is IF NOT
 * EXISTS or an idempotent ALTER, so running this against a database that is
 * already up to date changes nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "./env-local.mjs";

/* So the Neon URL can be saved once in .env.local instead of pasted in
   front of every command. */
const fromFile = loadEnvLocal();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if(!process.env.DATABASE_URL){
  console.error("DATABASE_URL is not set.\n");
  /* Vercel stores it write-only, so it genuinely cannot be read back from
     there — Neon is the place to get it. */
  console.error("Get the connection string from the Neon dashboard:");
  console.error("  console.neon.tech -> your project -> Connect -> copy the connection string\n");
  console.error("Then save it once, so you never have to paste it again:");
  console.error('  echo \'DATABASE_URL=postgres://...\' > .env.local\n');
  console.error("and run  npm run db:setup  again. (.env.local is git-ignored.)");
  process.exit(1);
}

const describe = url => {
  try{ const u = new URL(url); return `${u.hostname}${u.port?":"+u.port:""}${u.pathname}`; }
  catch(_){ return "(unreadable DATABASE_URL)"; }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized:false },
});

try{
  console.log(`Applying db/schema.sql to ${describe(process.env.DATABASE_URL)}`);
  const sql = readFileSync(join(root, "db", "schema.sql"), "utf8");

  const before = await pool.query("select count(*)::int as n from information_schema.tables where table_schema='public'");
  await pool.query(sql);
  const after = await pool.query(
    `select table_name from information_schema.tables
      where table_schema='public' order by table_name`);

  console.log(`\n✓ Schema applied. ${before.rows[0].n} table(s) before, ${after.rows.length} after.`);
  console.log("  Tables: " + after.rows.map(r => r.table_name).join(", "));

  /* The whole point of running this right now is the users table, so say
     plainly whether it is there rather than making them go and look. */
  const hasUsers = after.rows.some(r => r.table_name === "users");
  if(!hasUsers){
    console.error("\n✗ The users table is still missing. Sign-in cannot work — please report this.");
    process.exitCode = 1;
  }else{
    const { rows:[{ n }] } = await pool.query("select count(*)::int as n from users");
    console.log(`\nNext: ${n === 0
      ? "create your account with  npm run user:create -- <username>"
      : `${n} account(s) already exist — run  node scripts/create-user.mjs --list  to see them.`}`);
  }
}catch(e){
  console.error("\n✗ Failed:", e.message);
  if(/password authentication|no pg_hba|SASL/i.test(e.message))
    console.error("  That looks like the wrong connection string. Copy DATABASE_URL from Vercel again.");
  if(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(e.message))
    console.error("  Could not reach the database host. Check the URL and your network.");
  process.exitCode = 1;
}finally{
  await pool.end();
}
