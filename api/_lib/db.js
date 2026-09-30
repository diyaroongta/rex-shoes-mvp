/* One pooled Postgres client, reused across warm serverless invocations.
   Works with any Postgres: Neon, Supabase, Railway, RDS, or local. */
import { Pool } from "pg";

let pool;
export function db(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if(!pool){
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,                                    // serverless: keep it small
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized:false },
    });
    /* An IDLE client dropped by the server (Neon closes idle connections;
       the log said `read ETIMEDOUT`) is emitted on the pool. With no listener
       Node treats that as an unhandled error and kills the process — the
       local server died that way after an hour and a half idle, and a warm
       function instance would too. pg has already discarded the dead client;
       the next query opens a fresh one, so logging it is all that is needed. */
    pool.on("error", e => console.error("Postgres idle client error (discarded):", e.code || e.message));
  }
  return pool;
}
export const q = (text, params) => db().query(text, params);
