/* WHAT IS ACTUALLY LOADED, ARTICLE BY ARTICLE.
 *
 * The factory tracks BOM data entry on a spreadsheet: 35 articles, three a
 * day, each row marked Done or Pending. That sheet records that somebody DID
 * the work; it cannot record whether the work arrived intact. GOLA was marked
 * Done and its master still had no size range covering the adult 6 and no 6X9
 * at all, which is what silently dropped cartons off two invoices — every row
 * that DID print was perfectly correct, so nothing looked wrong.
 *
 * This module answers the other question: for each article the master holds,
 * how many of its size ranges carry material rates, packing rates and an MRP.
 * It counts what is there and names what is not. It never guesses a rate and
 * never fills a gap.
 *
 * THE DANGEROUS STATE IS `no_rates`, NOT `empty`.
 * An article the master does not hold at all is loud — an order against it is
 * set aside and reported. An article WITH size ranges and NO rates is silent:
 * it schedules normally, books machine capacity and requires zero material, so
 * the buying list is short and nothing says so. That is the state this view
 * exists to surface.
 *
 * Pure: give it the reference document and it returns the audit. The packing
 * lookup is INJECTED rather than imported, because pairs-per-carton inherits
 * between articles (SPIKE reads ARMOUR's chart by position) and that rule
 * lives in bridge.js with the reference it reads. Duplicating it here would
 * give two answers to one question.
 */

/* The family the factory says out loud. The tracker lists GOLA and SPIKE; the
   article master holds GOLA LACE BLACK BLACK (BLACK SKINFIT) and eleven
   Jacks. Rolling up by family is what lets one be checked against the other.
   `familyOf` is injected for the same reason packing is — shared/product-codes
   owns that rule. Without it every article is its own family, which still
   audits correctly, just without the roll-up. */
const DEFAULT_FAMILY = name => String(name || "").trim().toUpperCase();

const combosOf = article =>
  (article && (article.combo_order || Object.keys(article.combos || {}))) || [];

/* A range "carries rates" when at least one stage names at least one material.
   A range whose rates object exists but is empty is NOT rated — that is the
   shape an interrupted upload leaves behind, and counting it would report the
   gap as filled. */
function rateFacts(combo){
  const stages = [];
  const materials = new Set();
  let entries = 0;
  for(const [stage, byMaterial] of Object.entries((combo && combo.rates) || {})){
    const names = Object.keys(byMaterial || {});
    if(!names.length) continue;
    stages.push(stage);
    for(const name of names) materials.add(name);
    entries += names.length;
  }
  return { stages, materials, entries };
}

export function auditArticle(reference, name, opts = {}){
  const familyOf = opts.familyOf || DEFAULT_FAMILY;
  const packQty  = opts.packQty  || (() => null);
  const ref = reference || {};
  const article = ((ref.articles || {})[name]) || {};
  const ranges = combosOf(article);
  const mrpChart = (ref.mrp || {})[name] || {};

  const without_rates = [], without_packing = [], without_mrp = [];
  const materials = new Set();
  const stages = new Set();
  let rate_entries = 0;

  for(const combo of ranges){
    const facts = rateFacts((article.combos || {})[combo]);
    if(!facts.entries) without_rates.push(combo);
    rate_entries += facts.entries;
    for(const m of facts.materials) materials.add(m);
    for(const s of facts.stages) stages.add(s);

    const ppc = packQty(name, combo);
    if(ppc == null || !Number.isFinite(Number(ppc)) || Number(ppc) <= 0) without_packing.push(combo);

    const price = mrpChart[combo];
    if(price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) without_mrp.push(combo);
  }

  /* `empty`    — no size ranges at all: an order against it is refused loudly.
     `no_rates` — ranges, not one rate: plans and books capacity in silence.
     `partial`  — some ranges rated, some not: those lines price to nothing.
     `rated`    — every range carries material rates. */
  const state = !ranges.length ? "empty"
    : rate_entries === 0 ? "no_rates"
    : without_rates.length ? "partial"
    : "rated";

  return {
    article: name,
    family: familyOf(name),
    product_code: article.product_code || "",
    ranges: ranges.length,
    ranges_rated: ranges.length - without_rates.length,
    without_rates,
    rate_entries,
    materials: materials.size,
    stages: [...stages],
    ranges_packed: ranges.length - without_packing.length,
    without_packing,
    ranges_priced: ranges.length - without_mrp.length,
    without_mrp,
    state,
  };
}

/* Worst wins. A family is only as loaded as its least loaded article — one
   unrated Jack among twelve is still a Jack order that prices to nothing. */
const RANK = { empty:0, no_rates:1, partial:2, rated:3 };
const worst = states => states.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "rated");

export function auditBom(reference, opts = {}){
  const ref = reference || {};
  const articles = Object.keys(ref.articles || {})
    .map(name => auditArticle(ref, name, opts))
    .sort((a, b) => a.family.localeCompare(b.family) || a.article.localeCompare(b.article));

  const byFamily = new Map();
  for(const row of articles){
    if(!byFamily.has(row.family))
      byFamily.set(row.family, { family:row.family, articles:[], ranges:0, ranges_rated:0,
        rate_entries:0, ranges_packed:0, ranges_priced:0 });
    const f = byFamily.get(row.family);
    f.articles.push(row.article);
    f.ranges += row.ranges;
    f.ranges_rated += row.ranges_rated;
    f.rate_entries += row.rate_entries;
    f.ranges_packed += row.ranges_packed;
    f.ranges_priced += row.ranges_priced;
  }
  const families = [...byFamily.values()].map(f => ({
    ...f,
    state: worst(articles.filter(a => a.family === f.family).map(a => a.state)),
  })).sort((a, b) => a.family.localeCompare(b.family));

  const count = state => articles.filter(a => a.state === state).length;
  return {
    articles, families,
    totals: {
      articles: articles.length,
      families: families.length,
      ranges: articles.reduce((n, a) => n + a.ranges, 0),
      rate_entries: articles.reduce((n, a) => n + a.rate_entries, 0),
      rated: count("rated"), partial: count("partial"),
      no_rates: count("no_rates"), empty: count("empty"),
    },
  };
}
