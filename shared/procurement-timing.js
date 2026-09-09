/* WHEN a shortfall bites, not just how big it is.
 *
 * The buying list answers "what is short". The question procurement actually
 * asks is "what is short AND needed on Thursday" — a shortfall three weeks out
 * and one that stops cutting tomorrow look identical on a list sorted by
 * quantity, and they are not the same problem.
 *
 * Every piece of this is already computed and thrown away:
 *   - `netByOrder` walks orders in the sequence the plan runs them, so the
 *     order that finds the cupboard empty is known.
 *   - each order carries `stages` with a `start_date` per stage.
 *   - the BOM says which STAGE consumes a material.
 * Put together, a shortfall gets a date: the day the first order short of it
 * reaches the stage that eats it.
 *
 * Pure — no database, no clock.
 */

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

/* Which stages consume a material, per article. Read off the BOM rates rather
   than assumed: SOLE is a MOLDING material and INNER a PACKING one, and dating
   either from the day cutting starts would buy them weeks early. */
export function stagesUsingMaterial(article){
  const out = {};
  for(const combo of Object.values((article || {}).combos || {}))
    for(const [stage, rates] of Object.entries(combo.rates || {}))
      for(const key of Object.keys(rates || {}))
        (out[key] = out[key] || new Set()).add(stage);
  return out;
}

/* The date an order reaches a given stage. Falls back to the order's release
   date, because a material whose stage cannot be found is still needed by the
   time the order starts — early is the safe direction to be wrong in. */
function stageStart(order, stage){
  const found = ((order || {}).stages || []).find(s => s.stage === stage);
  return clean(found && found.start_date) || clean((order || {}).release_date) || "";
}

/* For every short material: the earliest date it is actually needed, and which
   order drives that date.
 *
 * `byOrder`  — the output of netByOrder (order_no -> { short: [...] })
 * `orders`   — computed orders, IN QUEUE SEQUENCE, each carrying `stages`
 * `articles` — the article master, for the material-to-stage mapping
 *
 * Returns material_key -> { needed_on, order_no, stage, shortfall }.
 */
export function neededBy(byOrder = {}, orders = [], articles = {}){
  const out = {};
  const stageCache = new Map();

  for(const order of orders){
    const rec = byOrder[order.order_no];
    if(!rec || !rec.short || !rec.short.length) continue;

    const code = clean(order.article_code || order.article);
    if(!stageCache.has(code)) stageCache.set(code, stagesUsingMaterial(articles[code]));
    const byMaterial = stageCache.get(code);

    for(const row of rec.short){
      const key = row.material_key;
      /* The EARLIEST consuming stage. A material used in both cutting and
         packing is needed when cutting starts, not when packing does. */
      const stages = [...(byMaterial[key] || [])];
      let when = "", which = "";
      for(const stage of stages){
        const date = stageStart(order, stage);
        if(date && (!when || date < when)){ when = date; which = stage; }
      }
      if(!when){ when = clean(order.release_date); which = ""; }

      const prev = out[key];
      /* Orders arrive in queue sequence, so the first one short of a material
         is the one that hits the wall — but a LATER order can still need it
         sooner if the queue was re-sequenced by hand. Keep the earliest date,
         not merely the first seen. */
      if(!prev || (when && when < prev.needed_on)){
        out[key] = { material_key:key, name:row.name, uom:row.uom,
                     needed_on: when, order_no: clean(order.order_no), stage: which,
                     shortfall: row.shortfall };
      }
    }
  }
  return out;
}

/* The buying list, most urgent first, with the date attached.
   `today` is injected rather than read from a clock, so this stays pure and
   the tests can sit on a fixed day. */
export function buyingList(procurement = [], timing = {}, today = ""){
  const rows = procurement
    .filter(m => Number(m.shortfall) > 0)
    .map(m => {
      const t = timing[m.material_key] || {};
      const needed_on = t.needed_on || "";
      /* null, not a big number, when nothing dates it — "no date" and "due in
         999 days" are different claims and must not sort together. */
      const days = (needed_on && today) ? daysBetween(today, needed_on) : null;
      return { ...m, needed_on, needed_for: t.order_no || "", stage: t.stage || "",
               days_until: days, overdue: days != null && days < 0 };
    });

  rows.sort((a, z) => {
    /* Dated rows first, earliest first. An undated shortfall is real but
       cannot be scheduled, so it sits below the ones that can. */
    if(a.needed_on && z.needed_on) return a.needed_on.localeCompare(z.needed_on)
      || z.shortfall - a.shortfall;
    if(a.needed_on) return -1;
    if(z.needed_on) return 1;
    return z.shortfall - a.shortfall;
  });
  return rows;
}

/* Whole days from one YYYY-MM-DD to another. UTC on both sides, so a clock
   change in between cannot turn 7 days into 6.96 and round it away. */
export function daysBetween(from, to){
  const a = Date.parse(`${clean(from)}T00:00:00Z`);
  const b = Date.parse(`${clean(to)}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* How urgent, in words the screen can colour by. Thresholds are deliberately
   coarse: procurement does not need eleven shades of amber. */
export function urgencyOf(row, leadDays = 7){
  if(!row || row.needed_on === "") return "undated";
  if(row.days_until == null) return "undated";
  if(row.days_until < 0) return "overdue";
  if(row.days_until <= leadDays) return "urgent";
  return "planned";
}
