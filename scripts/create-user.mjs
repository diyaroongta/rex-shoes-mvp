#!/usr/bin/env node
/* Create, reset, list and test Factory OS accounts.
 *
 *   node scripts/create-user.mjs <username> [--role admin|planner|viewer]
 *   node scripts/create-user.mjs --list             # who has an account
 *   node scripts/create-user.mjs --verify <user>    # does this password work?
 *   node scripts/create-user.mjs <user> --set-role planner   # change role only
 *   node scripts/create-user.mjs --unlock <user>    # clear a lockout
 *   node scripts/create-user.mjs --secret           # print an AUTH_SECRET
 *
 * The password is typed at the prompt and never echoed, never passed as an
 * argument (shell history), and never stored anywhere but as an scrypt hash.
 *
 *   DATABASE_URL="postgres://..." node scripts/create-user.mjs abhay
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { hashPassword, verifyPassword, assertUsablePassword,
         normalisePassword, MIN_PASSWORD } from "../api/_lib/auth.js";
import { hiddenPrompts } from "./hidden-prompt.mjs";
import { ROLES as VALID_ROLES, ROLE_SUMMARY } from "../shared/permissions.js";
import { loadEnvLocal } from "./env-local.mjs";

/* So the Neon URL can be saved once in .env.local instead of pasted in
   front of every command. */
const fromFile = loadEnvLocal();

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i > -1 ? (args[i+1] || "") : null; };

if(args.includes("--secret")){
  console.log(randomBytes(48).toString("base64url"));
  process.exit(0);
}

const ROLES = VALID_ROLES;
const listing  = args.includes("--list");
const verifying = flag("--verify");
const unlocking = flag("--unlock");
/* Changing a role must NOT require resetting the password. Accounts get
   created before anyone has decided who does what, so the common case is an
   existing person being narrowed from admin to planner. */
const settingRole = flag("--set-role");
const role = (settingRole || flag("--role") || "admin").toLowerCase();
const username = String(verifying || unlocking ||
                        args.find(a => !a.startsWith("--") && a !== role) || "").trim().toLowerCase();

if(!listing && !username){
  console.error("Usage: node scripts/create-user.mjs <username> [--role admin|planner|viewer]");
  console.error("       node scripts/create-user.mjs --list | --verify <user> | --unlock <user> | --secret");
  process.exit(1);
}
if(!ROLES.includes(role)){
  console.error(`Unknown role: ${role}. Use one of:\n`);
  for(const r of ROLES) console.error(`  ${r.padEnd(8)} ${ROLE_SUMMARY[r]}`);
  process.exit(1);
}
if(!process.env.DATABASE_URL){
  console.error("DATABASE_URL is not set.\n");
  console.error("Get it from the Neon dashboard (Vercel stores it write-only, so it");
  console.error("cannot be read back from there):");
  console.error("  console.neon.tech -> your project -> Connect -> copy the connection string\n");
  console.error("Save it once so you never paste it again:");
  console.error("  echo 'DATABASE_URL=postgres://...' > .env.local");
  process.exit(1);
}

/* WHICH database this is about to write to. Creating the account against a
   local or old database while the deployment reads a different one produces a
   login that fails with "Incorrect username or password" and no other clue —
   so the target is always stated, before anything is typed. */
function describeTarget(url){
  try{
    const u = new URL(url);
    return `${u.hostname}${u.port ? ":"+u.port : ""}${u.pathname}`;
  }catch(_){ return "(unreadable DATABASE_URL)"; }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized:false },
});

const fail = msg => { console.error(`\n✗ ${msg}`); process.exitCode = 1; };

try{
  console.log(`Database: ${describeTarget(process.env.DATABASE_URL)}`
    + (fromFile.some(e=>e.key==="DATABASE_URL") ? "  (from .env.local)" : ""));

  const exists = await pool.query("select to_regclass('public.users') as t");
  if(!exists.rows[0].t){
    console.error("\nThe users table does not exist in THIS database. Apply the schema first:");
    console.error("  npm run db:setup");
    process.exit(1);
  }

  /* ---- who has an account ---- */
  if(listing){
    const { rows } = await pool.query(
      `select username, role, active, failed_attempts,
              locked_until > now() as locked, last_login_at
         from users order by username`);
    if(!rows.length){
      console.log("\nNo accounts exist yet. Create the first one with:");
      console.log("  npm run user:create -- <username>");
    }else{
      console.log(`\n${rows.length} account${rows.length===1?"":"s"}:\n`);
      for(const r of rows){
        const flags = [ r.active ? null : "DEACTIVATED", r.locked ? "LOCKED" : null ].filter(Boolean);
        const seen = r.last_login_at ? new Date(r.last_login_at).toISOString().slice(0,16).replace("T"," ") : "never";
        console.log(`  ${r.username.padEnd(16)} ${r.role.padEnd(8)} last login: ${seen}` +
                    (flags.length ? `  [${flags.join(", ")}]` : ""));
      }
    }
    process.exit(0);
  }

  /* ---- clear a lockout ---- */
  if(unlocking){
    const { rowCount } = await pool.query(
      `update users set failed_attempts = 0, locked_until = null, updated_at = now()
        where username = $1`, [username]);
    if(!rowCount) fail(`No account called "${username}" in this database. Run --list to see what is there.`);
    else console.log(`\n✓ Unlocked ${username}. They can sign in again straight away.`);
    process.exit(process.exitCode || 0);
  }

  /* ---- change a role, leaving the password alone ---- */
  if(settingRole){
    const { rows } = await pool.query(
      "select role from users where username = $1", [username]);
    if(!rows.length){
      fail(`No account called "${username}" in this database. Run --list to see what is there.`);
      process.exit(1);
    }
    if(rows[0].role === role){
      console.log(`\n${username} is already ${role}. Nothing changed.`);
      process.exit(0);
    }
    await pool.query("update users set role = $2, updated_at = now() where username = $1",
                     [username, role]);
    console.log(`\n✓ ${username}: ${rows[0].role} -> ${role}`);
    console.log(`  ${ROLE_SUMMARY[role]}`);
    /* The role rides in the signed session cookie, so it is fixed for the rest
       of the current 12-hour session and does not tighten retroactively. */
    console.log("\n  They must sign out and back in for this to take effect.");
    process.exit(0);
  }

  /* ---- test a password against what is stored ---- */
  if(verifying){
    const { rows } = await pool.query(
      "select password_hash, active, locked_until > now() as locked from users where username = $1", [username]);
    if(!rows.length){
      fail(`No account called "${username}" in this database. Run --list to see what is there.`);
      process.exit(1);
    }
    const [password] = await hiddenPrompts([`Password to test for "${username}" (not shown): `]);
    const ok = verifyPassword(password, rows[0].password_hash);
    console.log(ok
      ? `\n✓ That password is correct for ${username}.`
      : `\n✗ That password does NOT match what is stored for ${username}.`);
    if(ok && !rows[0].active) console.log("  But the account is DEACTIVATED, so signing in will still be refused.");
    if(ok && rows[0].locked)  console.log("  But the account is LOCKED. Clear it with --unlock " + username);
    if(!ok) console.log(`  Reset it with:  npm run user:create -- ${username}`);
    process.exit(ok ? 0 : 1);
  }

  /* ---- create or reset ---- */
  const { rows } = await pool.query("select username, role from users where username = $1", [username]);
  const resetting = rows.length > 0;
  console.log(resetting
    ? `Account "${username}" already exists — this will RESET its password.`
    : `Creating account "${username}" with role ${role}.`);

  const [password, again] = await hiddenPrompts([
    `Password (at least ${MIN_PASSWORD} characters, not shown): `,
    "Repeat password: ",
  ]);

  if(password !== again){
    /* Say what differs without printing either one. Two passwords that look
       the same but differ in length or in trailing whitespace are the usual
       cause, and "they do not match" alone sends people round in circles. */
    const why = password.length !== again.length
      ? `first was ${password.length} characters, second was ${again.length}`
      : "same length, different characters";
    fail(`The two passwords do not match (${why}). Nothing was changed.`);
    process.exit(1);
  }

  try{ assertUsablePassword(password); }
  catch(e){ fail(`${e.message} Nothing was changed.`); process.exit(1); }

  /* Leading or trailing spaces are legal but are almost always an accident of
     pasting, and they are invisible at a prompt that echoes nothing. */
  const clean = normalisePassword(password);
  if(clean !== clean.trim())
    console.log("\n  Note: this password starts or ends with a space. That is allowed, but it\n" +
                "  must be typed with the space every time. Re-run if it was a paste artefact.");

  await pool.query(
    `insert into users (username, password_hash, display_name, role, active,
                        failed_attempts, locked_until, updated_at)
     values ($1, $2, $3, $4, true, 0, null, now())
     on conflict (username) do update set
       password_hash = $2, role = $4, active = true,
       failed_attempts = 0, locked_until = null, updated_at = now()`,
    [username, hashPassword(password), username, role]);

  /* THE SAFEGUARD THAT MATTERS. Read the hash back out of the database and
     check the typed password against it. This proves the account works before
     anyone opens a browser — it catches a write that went to a different
     database, a column that silently truncated, an encoding that shifted in
     transit, and any future change to the hashing that forgets one side. */
  const back = await pool.query(
    "select password_hash, role, active from users where username = $1", [username]);
  if(!back.rows.length){
    fail("The account was not found immediately after writing it. Nothing can be trusted here — " +
         "check that DATABASE_URL points where you think it does.");
    process.exit(1);
  }
  if(!verifyPassword(password, back.rows[0].password_hash)){
    fail("The stored password did NOT verify when read back. The account has been left in place " +
         "but will not accept this password — do not rely on it. Please report this.");
    process.exit(1);
  }

  console.log(`\n✓ ${resetting ? "Password reset" : "Account created"}: ${username} (${back.rows[0].role})`);
  console.log("  Verified: the stored password was read back and checked — this account can sign in.");
  console.log(`  Database: ${describeTarget(process.env.DATABASE_URL)}`);
  console.log("\nNext: make sure AUTH_SECRET is set on Vercel for this same project, then sign in.");
}catch(e){
  fail(e.message);
}finally{
  await pool.end();
}
