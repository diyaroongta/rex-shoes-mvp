/* A PLACEHOLDER SELLING PRICE, SO A DEMO PI PRICES AT ALL.
 *
 * Thirteen of the fourteen articles carry no MRP, so every line on a demo
 * invoice prices to nothing — only Gola Plus is really priced. This fills the
 * GAPS with one obviously-invented figure so the commercial flow can be shown
 * end to end.
 *
 * It is invented factory data, which this project otherwise refuses to write,
 * so every safeguard is here and none of them is optional:
 *
 *   - It only ever FILLS GAPS. A range that already has a price keeps it, so
 *     the one article the factory really priced is never overwritten.
 *   - It is a DRY RUN unless --apply is passed.
 *   - The previous reference document is snapshotted to reference_data_history
 *     BEFORE the write, under the change type "placeholder_mrp", so the whole
 *     thing is one Restore away in Data & BOM.
 *   - One flat figure across every article and every size range is itself the
 *     label: real MRPs differ by range. --undo removes exactly the prices that
 *     match the placeholder figure and nothing else.
 *
 * Usage:
 *   node scripts/sample-mrp.mjs                 # dry run, shows what it would do
 *   node scripts/sample-mrp.mjs --apply         # write 500 into every unpriced range
 *   node scripts/sample-mrp.mjs --apply --price 650
 *   node scripts/sample-mrp.mjs --apply --undo  # take the placeholders back out
 */
import pg from "pg";
import { loadEnvLocal } from "./env-local.mjs";

loadEnvLocal();
const args = process.argv.slice(2);
const has = f => args.includes(f);
const valueOf = (f, fallback) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i+1] != null ? args[i+1] : fallback;
};
const PRICE = Number(valueOf("--price", 500));
const APPLY = has("--apply");
const UNDO  = has("--undo");

if(!Number.isFinite(PRICE) || PRICE <= 0){
  console.error("--price must be a number above 0");
  process.exitCode = 1;
}else if(!process.env.DATABASE_URL){
  console.error("No DATABASE_URL. Put it in .env.local (see .env.example).");
  process.exitCode = 1;
}else{
  const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return "unknown host"; } })();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } });
  await client.connect();
  try{
    await client.query("begin");
    const { rows } = await client.query("select value from reference_data where id = 1 for update");
    if(!rows.length) throw new Error("reference_data is empty — run npm run db:setup first");
    const ref = rows[0].value;
    const before = JSON.stringify(ref);
    const articles = ref.articles || {};
    ref.mrp = ref.mrp || {};

    const touched = [];
    let changed = 0;
    for(const [article, def] of Object.entries(articles)){
      const ranges = def.combo_order || Object.keys(def.combos || {});
      if(!ranges.length) continue;
      const chart = { ...(ref.mrp[article] || {}) };
      const mine = [];
      for(const range of ranges){
        const current = Number(chart[range]);
        if(UNDO){
          // Only what this script wrote: exactly the placeholder figure.
          if(current === PRICE){ delete chart[range]; mine.push(range); changed++; }
        }else if(!Number.isFinite(current) || current <= 0){
          chart[range] = PRICE; mine.push(range); changed++;
        }
      }
      if(mine.length){
        touched.push({ article, ranges: mine });
        if(Object.keys(chart).length) ref.mrp[article] = chart;
        else delete ref.mrp[article];
      }
    }

    console.log(`database: ${host}`);
    console.log(UNDO
      ? `Removing the ₹${PRICE} placeholder from ${changed} size range(s) across ${touched.length} article(s):`
      : `Filling ₹${PRICE} into ${changed} unpriced size range(s) across ${touched.length} article(s):`);
    for(const t of touched) console.log(`  ${t.article.padEnd(42)} ${t.ranges.join(", ")}`);
    /* "Already priced" and "cannot be ordered at all" are different facts and
       lumping them together hides the second one: an article with no size
       range is not merely unpriced, it can carry no order. */
    const rest = Object.keys(articles).filter(a => !touched.some(t => t.article === a));
    const noRanges = rest.filter(a => !((articles[a].combo_order || Object.keys(articles[a].combos||{})).length));
    const priced   = rest.filter(a => !noRanges.includes(a));
    if(!UNDO){
      console.log(`\nAlready priced, left alone: ${priced.length ? priced.join(", ") : "none"}`);
      console.log(`No size ranges at all, so nothing to price and no order can be placed on them: `
        + `${noRanges.length} article(s)`);
    }

    if(!APPLY){
      await client.query("rollback");
      console.log("\nDRY RUN — nothing written. Add --apply to write it.");
    }else if(!changed){
      await client.query("rollback");
      console.log("\nNothing to change.");
    }else{
      await client.query(`insert into reference_data_history (change_type, article_code, value)
                          values ($1,$2,$3)`,
                         [UNDO ? "placeholder_mrp_undo" : "placeholder_mrp", null, before]);
      await client.query(`insert into reference_data (id, value) values (1, $1)
                          on conflict (id) do update set value = $1, updated_at = now()`,
                         [JSON.stringify(ref)]);
      await client.query("commit");
      console.log(`\nWritten. The previous reference document is saved in Data & BOM → history`
        + ` as "${UNDO ? "placeholder_mrp_undo" : "placeholder_mrp"}", so this is one Restore away.`);
      if(!UNDO) console.log(`These are PLACEHOLDERS: every range is the same ₹${PRICE}. `
        + `Real MRPs differ by size range — replace them before anyone quotes from this.`);
    }
  }catch(e){
    await client.query("rollback").catch(()=>{});
    console.error("Failed, nothing written:", e.message || e);
    process.exitCode = 1;
  }finally{
    await client.end();
  }
}
