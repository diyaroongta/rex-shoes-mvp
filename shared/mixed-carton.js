/* MIXED CARTONS — the box at the end of a dispatch that is not a full one of
   anything.
 *
 * An order of 50 cartons is rarely 50 clean boxes. The packer fills 45 with
 * whole sizes, and what is left — six pairs of 8, six of 9 — will not fill a
 * carton of either, so it goes into one box together. That box is carton 46,
 * it holds 12 pairs, and the customer's gate checks it against a line on the
 * packing list that has to say exactly which sizes are inside it.
 *
 * Two rules carried over from the packing list itself, because breaking either
 * one is how a gate pass stops matching the lorry:
 *
 *   CARTONS ARE COUNTED, NEVER DERIVED. A mixed carton holds whatever the
 *   packer put in it. Nothing here divides pairs by a rate to decide what a
 *   box contains — the rate is used only to SUGGEST what is left over and to
 *   say, afterwards, that a box is not full.
 *
 *   AN UNKNOWN RATE IS NOT A ZERO. Several combos have no pairs-per-carton on
 *   record. Those sizes report `rate: null` and are left out of the
 *   suggestion rather than being treated as packing one pair to a box.
 *
 * Pure: no database, no clock.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pairsOf = sizes => (sizes || []).reduce((a, s) => a + Math.max(0, Math.round(num(s.pairs))), 0);

/* What a size's pairs come to in whole boxes, and what will not fill one.
   A rate that is not known returns nulls — "I do not know" and "none left
   over" are different answers and must not print alike. */
export function splitAtRate(pairs, rate){
  const n = Math.max(0, Math.round(num(pairs)));
  const r = rate == null || !(Number(rate) > 0) ? null : Math.round(Number(rate));
  if(r == null) return { pairs: n, rate: null, full_cartons: null, loose_pairs: null };
  return { pairs: n, rate: r, full_cartons: Math.floor(n / r), loose_pairs: n % r };
}

/* Size by size, what is packed and what is left over. `rateFor(size)` is the
   caller's — sizes inside one range do not pack alike (SPIKE's 11X1 packs its
   12s and 13s at 24 and size 1 at 18), so the rate is asked for per SIZE and
   never taken from the range. */
export function lineBreakdown(line, rateFor = () => null){
  const rows = [];
  for(const group of (line && line.groups) || []){
    for(const s of group.sizes || []){
      const size = String(s.size ?? "").trim();
      if(!size) continue;
      const existing = rows.find(r => r.size === size);
      if(existing){ existing.pairs += Math.max(0, Math.round(num(s.pairs))); continue; }
      rows.push({ size, pairs: Math.max(0, Math.round(num(s.pairs))) });
    }
  }
  return rows.map(r => ({ size: r.size, ...splitAtRate(r.pairs, rateFor(r.size)) }));
}

/* The carton the packer is about to make up: the pairs of each size that will
   not fill a box of their own. Returns null when there is nothing left over,
   because offering an empty carton is worse than offering none. */
export function suggestMixedCarton(line, rateFor = () => null){
  const sizes = lineBreakdown(line, rateFor)
    .filter(r => r.loose_pairs > 0)
    .map(r => ({ size: r.size, pairs: r.loose_pairs }));
  if(!sizes.length) return null;
  return { sizes, pairs: pairsOf(sizes) };
}

/* Add that carton to the sheet. It goes on the END of the line, which is what
   gives it the NEXT carton number — 45 full boxes already numbered, so this
   one is 46. The number itself is still derived by buildPackingList; nothing
   here writes a C/N. */
export function withMixedCarton(sheet, lineIndex, contents){
  const next = JSON.parse(JSON.stringify(sheet || {}));
  const line = (next.lines || [])[lineIndex];
  if(!line) return next;
  const sizes = ((contents && contents.sizes) || [])
    .map(s => ({ size: String(s.size ?? "").trim(), pairs: Math.max(0, Math.round(num(s.pairs))) }))
    .filter(s => s.size);
  line.groups = [...(line.groups || []), { sizes, cartons: 1, mixed: true }];
  return next;
}

/* What each numbered box on a built line actually is. A group of one size at
   its own full rate is an ordinary carton; anything else is called what it is,
   so the packing list can print "mixed" beside the C/N rather than leaving the
   gate to work it out. */
export function describeCartons(builtLine, rateFor = () => null){
  return ((builtLine && builtLine.groups) || []).map(g => {
    const sizes = g.sizes || [];
    const mixed = sizes.length > 1;
    const perCarton = g.cartons > 0 ? g.pairs / g.cartons : null;
    let standard = null, part = false;
    if(!mixed && sizes.length === 1){
      const r = splitAtRate(g.pairs, rateFor(sizes[0].size));
      standard = r.rate;
      /* "Not full" is only claimable when the rate is KNOWN. */
      part = standard != null && perCarton != null && perCarton < standard - 1e-9;
    } else if(mixed){
      part = true;      // a box holding several sizes is by definition a part carton
    }
    return { ...g, mixed, part, per_carton: perCarton, standard_pack: standard,
      contents: sizes.map(s => `${s.size} x ${s.pairs}`).join(", ") };
  });
}

/* The one-line summary the dispatcher reads back: how many boxes, how many of
   them are mixed, and how many pairs are in them. */
export function packingSummary(built, rateFor = () => null){
  let cartons = 0, mixed = 0, mixedPairs = 0, part = 0;
  for(const line of (built && built.lines) || []){
    for(const g of describeCartons(line, rateFor)){
      cartons += g.cartons;
      if(g.mixed){ mixed += g.cartons; mixedPairs += g.pairs; }
      else if(g.part) part += g.cartons;
    }
  }
  return { cartons, mixed_cartons: mixed, mixed_pairs: mixedPairs, part_cartons: part,
           pairs: (built && built.total_pairs) || 0 };
}
