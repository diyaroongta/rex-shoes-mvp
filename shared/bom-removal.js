/* Working out what a bulk BOM removal would actually delete.
 *
 * Pure: give it the reference document and a selection, get back the complete
 * list of what goes. It touches no database and no clock, so the preview the
 * clerk confirms and the deletion the server performs are produced by the same
 * function — a preview computed by different code from the delete is a preview
 * that can lie.
 *
 * Three levels, deliberately, because "remove it from the BOM" means three
 * different things depending on what is wrong:
 *
 *   articles   the whole article: every size range, its packing and its MRP
 *   ranges     one size range of an article, with all its material rates
 *   materials  one material inside one range
 *
 * A higher level absorbs the lower ones: selecting an article makes selecting
 * its ranges redundant, and the counts must not double-count them.
 */
import { splitScopedSizeKey } from "./bridge.js";

const norm = v => String(v == null ? "" : v).toUpperCase().replace(/\s+/g, "");
const rangesOf = def => (def && (def.combo_order || Object.keys(def.combos || {}))) || [];

/* Resolve a name the way the rest of the app does: exact first, then
   case/space-insensitive, so "rex gola (v)" finds "REX GOLA (V)". */
export function resolveArticle(articles, name){
  if(!articles || name == null) return null;
  if(Object.prototype.hasOwnProperty.call(articles, name)) return name;
  const want = norm(name);
  return Object.keys(articles).find(code => norm(code) === want) || null;
}

function ratesOf(articles, article, combo){
  return (((articles[article] || {}).combos || {})[combo] || {}).rates || {};
}

/* How many individual material rates sit under a range — the unit the factory
   thinks in when it asks "how much of the BOM is this?" */
export function rateCount(articles, article, combo){
  return Object.values(ratesOf(articles, article, combo))
    .reduce((n, entries) => n + Object.keys(entries || {}).length, 0);
}

/* What would be deleted, with every selection resolved and de-duplicated.
   Nothing is mutated. Unresolvable selections come back in `errors` rather
   than throwing, so a batch of forty reports all its problems at once instead
   of one per attempt. */
export function planRemoval(ref, selection = {}){
  const articles = (ref && ref.articles) || {};
  const errors = [];

  const wholeArticles = [];
  for(const raw of selection.articles || []){
    const code = resolveArticle(articles, raw);
    if(!code){ errors.push(`unknown article: ${raw || "(blank)"}`); continue; }
    if(!wholeArticles.includes(code)) wholeArticles.push(code);
  }
  const dropped = new Set(wholeArticles);

  const wholeRanges = [];
  const seenRange = new Set();
  for(const item of selection.ranges || []){
    const code = resolveArticle(articles, item && item.article);
    if(!code){ errors.push(`unknown article: ${(item && item.article) || "(blank)"}`); continue; }
    if(dropped.has(code)) continue;                       // the whole article is going anyway
    const combo = norm(item && item.combo);
    if(!rangesOf(articles[code]).includes(combo)){
      errors.push(`${code}: size range ${combo || "(blank)"} was not found`); continue;
    }
    const key = `${code}||${combo}`;
    if(seenRange.has(key)) continue;
    seenRange.add(key);
    wholeRanges.push({ article: code, combo, rates: rateCount(articles, code, combo) });
  }
  const droppedRange = new Set(seenRange);

  const materials = [];
  const seenMaterial = new Set();
  for(const item of selection.materials || []){
    const code = resolveArticle(articles, item && item.article);
    if(!code){ errors.push(`unknown article: ${(item && item.article) || "(blank)"}`); continue; }
    const combo = norm(item && item.combo);
    if(dropped.has(code) || droppedRange.has(`${code}||${combo}`)) continue;   // already covered
    const stage = norm(item && item.stage);
    const material = String((item && item.material) || "");
    const rates = ratesOf(articles, code, combo);
    if(!rates[stage] || !Object.prototype.hasOwnProperty.call(rates[stage], material)){
      errors.push(`${code} ${combo}: BOM item ${stage || "(blank)"} / ${material || "(blank)"} was not found`);
      continue;
    }
    const key = `${code}||${combo}||${stage}||${material}`;
    if(seenMaterial.has(key)) continue;
    seenMaterial.add(key);
    materials.push({ article: code, combo, stage, material });
  }

  /* A range stripped of its last material is worse than a deleted one: it
     still exists, so orders can still be placed on it, and it then consumes
     machine capacity while requiring no material at all. Removing the last
     rate therefore removes the range, and says so rather than doing it
     quietly. */
  const emptied = [];
  const perRange = {};
  for(const m of materials) perRange[`${m.article}||${m.combo}`] = (perRange[`${m.article}||${m.combo}`] || 0) + 1;
  for(const [key, count] of Object.entries(perRange)){
    const [article, combo] = key.split("||");
    if(count < rateCount(articles, article, combo)) continue;
    emptied.push({ article, combo });
    if(!seenRange.has(key)){
      seenRange.add(key);
      wholeRanges.push({ article, combo, rates: count, because_emptied: true });
    }
  }
  const finalMaterials = materials.filter(m => !seenRange.has(`${m.article}||${m.combo}`));

  /* An article stripped of its last range is in the same position. */
  const emptiedArticles = [];
  const perArticle = {};
  for(const r of wholeRanges) perArticle[r.article] = (perArticle[r.article] || 0) + 1;
  for(const [article, count] of Object.entries(perArticle)){
    if(count < rangesOf(articles[article]).length) continue;
    emptiedArticles.push(article);
    if(!dropped.has(article)){ dropped.add(article); wholeArticles.push(article); }
  }
  const finalRanges = wholeRanges.filter(r => !dropped.has(r.article));

  const articleRows = wholeArticles.map(code => ({
    article: code,
    ranges: rangesOf(articles[code]).length,
    rates: rangesOf(articles[code]).reduce((n, c) => n + rateCount(articles, code, c), 0),
    because_emptied: emptiedArticles.includes(code),
  }));

  return {
    articles: articleRows,
    ranges: finalRanges,
    materials: finalMaterials,
    emptied_ranges: emptied,
    emptied_articles: emptiedArticles,
    errors,
    totals: {
      articles: articleRows.length,
      ranges: finalRanges.length + articleRows.reduce((n, a) => n + a.ranges, 0),
      rates: finalMaterials.length
        + finalRanges.reduce((n, r) => n + r.rates, 0)
        + articleRows.reduce((n, a) => n + a.rates, 0),
    },
    empty: !articleRows.length && !finalRanges.length && !finalMaterials.length,
  };
}

/* Apply a plan to the reference document, in place. Only ever called with a
   plan that planRemoval produced, so everything here is already resolved. */
export function applyRemoval(ref, plan){
  const articles = ref.articles || {};

  const forgetRange = (article, combo) => {
    const def = articles[article];
    if(!def) return;
    if(def.combos) delete def.combos[combo];
    if(Array.isArray(def.combo_order)) def.combo_order = def.combo_order.filter(c => c !== combo);
    if(ref.packing && ref.packing[article]) delete ref.packing[article][combo];
    if(ref.mrp && ref.mrp[article]) delete ref.mrp[article][combo];
    /* Exact per-size packing is stored as RANGE::SIZE precisely so two ranges
       sharing a numeral stay apart. Those belonging to this range go with it;
       an unscoped key is not this range's to delete. */
    const singles = (ref.packing_singles_exact || {})[article];
    if(singles) for(const key of Object.keys(singles)){
      if(splitScopedSizeKey(key).combo === combo) delete singles[key];
    }
  };

  const forgetArticle = article => {
    for(const combo of rangesOf(articles[article])) forgetRange(article, combo);
    delete articles[article];
    if(ref.packing) delete ref.packing[article];
    if(ref.mrp) delete ref.mrp[article];
    if(ref.packing_singles_exact) delete ref.packing_singles_exact[article];
    if(ref.packing_singles_by_article) delete ref.packing_singles_by_article[article];
  };

  // Materials first: the range and article passes below may delete what they sit in.
  for(const m of plan.materials){
    const rates = ratesOf(articles, m.article, m.combo);
    if(rates[m.stage]){
      delete rates[m.stage][m.material];
      if(!Object.keys(rates[m.stage]).length) delete rates[m.stage];
    }
  }
  for(const r of plan.ranges) forgetRange(r.article, r.combo);
  for(const a of plan.articles) forgetArticle(a.article);

  return ref;
}

/* Which live orders a plan would strand. An order on a deleted ARTICLE cannot
   be planned at all; an order on a deleted RANGE keeps its dates but loses the
   material rates behind that line. Both are reported; neither is guessed at. */
export function ordersAtRisk(plan, orders){
  const goneArticles = new Set(plan.articles.map(a => a.article));
  const goneRanges = new Set(plan.ranges.map(r => `${r.article}||${r.combo}`));
  const rows = [];
  for(const o of orders || []){
    const code = o.article_code;
    if(goneArticles.has(code)){
      rows.push({ order_no: o.order_no, article: code, reason: "article", detail: "its article would no longer exist" });
      continue;
    }
    const hit = (o.lines || []).map(l => norm(l.combo)).filter(c => goneRanges.has(`${code}||${c}`));
    if(hit.length) rows.push({ order_no: o.order_no, article: code, reason: "range",
                               combos: [...new Set(hit)],
                               detail: `size range ${[...new Set(hit)].join(", ")} would lose its material rates` });
  }
  return rows;
}
