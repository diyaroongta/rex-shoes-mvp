/* WHAT IS INSIDE ONE CARTON OF A COMBINATION PACK.
 *
 * A combination pack is a named range packed together, and the factory's rule
 * is that the sizes in it are EQUAL: a carton of 7X10 holding 24 pairs is 6
 * each of 7, 8, 9 and 10. A carton of 6X11 — six sizes — at 24 is 4 each. The
 * pairs per carton never change; they come from the packing report. What this
 * settles is how those pairs are made up.
 *
 * THE RATE DOES NOT ALWAYS DIVIDE BY THE SIZES, AND THAT IS NOT A ROUNDING
 * PROBLEM. On the live packing chart 21 of 71 ranges do not divide: 2X5 is 18
 * pairs across 4 sizes (4.5 each) and 6X10B is 18 across 5 (3.6 each). Half a
 * pair is not a thing, so one carton of those ranges CANNOT hold equal sizes.
 * Two answers are possible and they are the factory's to give, not ours:
 * either the box really is uneven (5,4,5,4), or those ranges are packed in
 * multiples — 2X5 comes out even at TWO cartons, 9 of each.
 *
 * So this module does not choose. It reports `even` honestly, spreads the
 * remainder over the earliest sizes the same way the invoice already does, and
 * `evenAt()` names the smallest number of cartons that does divide, so a
 * screen can say "packs evenly in 2s" instead of printing 4.5.
 */

/* The invoice's own convention, so one range never splits two ways on two
   screens: the remainder goes to the earliest sizes — 18 across 4 is 5,5,4,4. */
export function spread(total, n){
  const t = Math.max(0, Math.round(Number(total) || 0));
  if(!(n > 0)) return [];
  const base = Math.floor(t / n), rem = t - base * n;
  return Array.from({ length:n }, (_, i) => base + (i < rem ? 1 : 0));
}

const clean = sizes => (sizes || []).map(s => String(s ?? "").trim()).filter(Boolean);

/* ONE carton. `rate` is the pairs per carton from the packing report. */
export function cartonMix(sizes, rate){
  const list = clean(sizes);
  const r = Number(rate);
  if(!list.length || !Number.isFinite(r) || r <= 0)
    return { rate: Number.isFinite(r) && r > 0 ? r : null, size_count: list.length,
             even: false, per_size: null, sizes: [], known: false };
  const even = r % list.length === 0;
  const each = spread(r, list.length);
  return {
    rate: r, size_count: list.length, even,
    per_size: even ? r / list.length : null,
    sizes: list.map((size, i) => ({ size, pairs: each[i] })),
    known: true,
  };
}

/* A whole line: `cartons` boxes of the same range. Written as the total per
   size, because that is what the order, the job card and the packing list all
   carry — and because a line of two 2X5 cartons IS even (9 each) even though
   one carton of it is not. */
export function lineMix(sizes, cartons, rate){
  const list = clean(sizes);
  const boxes = Math.max(0, Math.round(Number(cartons) || 0));
  const r = Number(rate);
  if(!list.length || !boxes || !Number.isFinite(r) || r <= 0)
    return { cartons: boxes, pairs: 0, even: false, per_size: null, sizes: [], known: false };
  const total = boxes * r;
  const even = total % list.length === 0;
  const each = spread(total, list.length);
  return {
    cartons: boxes, pairs: total, even,
    per_size: even ? total / list.length : null,
    sizes: list.map((size, i) => ({ size, pairs: each[i] })),
    known: true,
  };
}

/* The smallest number of cartons of this range whose pairs DO divide equally
   across its sizes. 2X5 at 18 over 4 sizes comes out at 2 cartons, 9 each.
   Null when nothing up to `max` divides — better than a number nobody can
   pack to. */
export function evenAt(sizes, rate, max = 12){
  const list = clean(sizes);
  const r = Number(rate);
  if(!list.length || !Number.isFinite(r) || r <= 0) return null;
  for(let c = 1; c <= max; c++)
    if((c * r) % list.length === 0)
      return { cartons: c, pairs: c * r, per_size: (c * r) / list.length };
  return null;
}
