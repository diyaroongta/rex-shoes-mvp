/* Read DATABASE_URL (and anything else) out of .env.local when it is not
 * already in the environment.
 *
 * Without this, every account command needs the full Neon connection string
 * pasted in front of it. That is long, easy to truncate, and on Vercel the
 * value is stored write-only — so it has to be fetched from Neon each time,
 * which is exactly the sort of friction that ends with the account being
 * created against the wrong database.
 *
 * .env.local is already in .gitignore, so the string never reaches the repo.
 * No dependency: the format is one KEY=VALUE per line, which is all we need.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvLocal(){
  const loaded = [];
  for(const name of [".env.local", ".env"]){
    const path = join(root, name);
    if(!existsSync(path)) continue;
    for(const raw of readFileSync(path, "utf8").split("\n")){
      const line = raw.trim();
      if(!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if(eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip one layer of surrounding quotes, which people add out of habit.
      if((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      /* A value already in the real environment WINS. Otherwise a stale file
         would silently override a URL the caller passed on purpose. */
      if(process.env[key] == null || process.env[key] === ""){
        process.env[key] = value;
        loaded.push({ key, from: name });
      }
    }
  }
  return loaded;
}
