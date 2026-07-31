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
  }
  return pool;
}
export const q = (text, params) => db().query(text, params);
