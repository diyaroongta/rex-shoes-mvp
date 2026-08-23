/* Adding one specific size to an order, rather than a whole size range.

   The factory writes orders both ways: "6X8 — 5 cartons" (a range) and
   "size 8 — 40 pairs" (one size). The planner needs two things for any line,
   and a single size has neither by itself:

     1. MATERIAL — the BOM holds rates per RANGE, not per size. So a single
        size has to borrow the rates of a range that contains it.
     2. PACKING  — pairs per carton, which for a lone size comes from the
        chart's SINGLE PACKSIZES rows, not the combination-pack rows.

   Where either is missing this reports it instead of guessing, because a
   guessed pack quantity silently changes the pair count, the material
   requirement and the dispatch date together. */

import { comboSizes } from "./pi.js";

/* Every size this article can be ordered in, and which range(s) cover it.
   A size can legitimately sit in more than one range (11s is in both 11X1 and
   9X12 for JILL), so callers must be able to choose. */
export function sizeCatalog(article, sizeResolver=comboSizes){
  const out = new Map();
  const combos = (article && (article.combo_order || Object.keys(article.combos || {}))) || [];
  for(const combo of combos){
    for(const size of sizeResolver(combo)){
      if(!out.has(size)) out.set(size, []);
      out.get(size).push(combo);
    }
  }
  return [...out.entries()].map(([size, inCombos]) => ({ size, combos: inCombos }));
}

/* Resolve one size for one article.
   packing        : { article: { combo: pairsPerCarton } }
   singlePackQty  : (article, size) => pairs per carton, or null
   preferredCombo : caller's choice when a size sits in several ranges */
export function resolveSize(articleCode, article, size, packing = {}, singlePackQty = () => null, preferredCombo = null, sizeResolver=comboSizes){
  const s = String(size || "").trim();
  const issues = [];
  if(!s) return { size:s, ok:false, issues:["No size given."] };

  const catalog = sizeCatalog(article,sizeResolver);
  const hit = catalog.find(c => c.size.toLowerCase() === s.toLowerCase());

  let combo = null, ambiguous = false;
  if(hit){
    if(preferredCombo && hit.combos.includes(preferredCombo)) combo = preferredCombo;
    else if(hit.combos.length === 1) combo = hit.combos[0];
    else { combo = hit.combos[0]; ambiguous = true;
      issues.push(`Size ${s} appears in ${hit.combos.join(" and ")} — confirm which one its material should come from.`); }
  }else{
    issues.push(`Size ${s} is not in any of ${articleCode}'s size ranges, so there is no BOM rate for it. Pick the range its material should come from.`);
  }

  // packing: the single-size chart first, then the range's own rate as a fallback
  let ppc = singlePackQty(articleCode, s);
  let ppcSource = ppc != null ? "single-size chart" : null;
  if(ppc == null && combo){
    const fromRange = (packing[articleCode] || {})[combo];
    if(fromRange != null){ ppc = fromRange; ppcSource = `${combo} pack rate`; }
  }
  if(ppc == null) issues.push(`No pairs-per-carton on file for size ${s} — enter it, or order in pairs.`);

  return {
    size: s,
    ok: !!combo && ppc != null,
    combo,                      // which range's BOM rates this size borrows
    ambiguous,
    candidates: hit ? hit.combos : (article.combo_order || []),
    ppc, ppcSource,
    inBom: !!hit,
    issues,
  };
}

/* Merge a specific-size quantity into an order's lines. A single size is
   stored as an ordinary line on its borrowed range, carrying a `sizes` map —
   the same shape a PI-read line uses — so the planner, the invoice and the
   dispatch tracker all handle it without special cases. */
export function addSizeToLines(lines, { combo, size, qty }){
  const next = (lines || []).map(l => ({ ...l, sizes: l.sizes ? { ...l.sizes } : undefined }));
  // Exact-size refills and whole-range orders may legitimately share a combo.
  // Only merge into another exact-size line; otherwise the whole-range amount
  // would be replaced by the new size map.
  const existing = next.find(l => l.combo === combo && l.sizes);
  const n = Math.max(0, Math.round(Number(qty) || 0));
  if(existing){
    existing.sizes = existing.sizes || {};
    existing.sizes[size] = (Number(existing.sizes[size]) || 0) + n;
    existing.qty = Object.values(existing.sizes).reduce((a,b) => a + (Number(b)||0), 0);
    if(!existing.label) existing.label = combo;
  }else{
    next.push({ combo, qty:n, label:`${combo} · size ${size}`, sizes:{ [size]: n } });
  }
  return next;
}
