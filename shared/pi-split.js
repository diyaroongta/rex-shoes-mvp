/* Releasing a PI into production IN PARTS.

   A PI order is the commercial record of what was sold. What the factory runs
   is a PRODUCTION ORDER, and one PI order can become several of them — a
   customer who buys 5,400 pairs of one shoe is routinely made in three runs.

   So the PI order is not the thing that gets scheduled; it is the ceiling.
   Every production order created from it carries `pi.source_order` naming the
   PI order it came from, and what is still owed is the PI's quantity minus
   everything already released against it. Nothing is stored twice: the
   remainder is always derived, so it cannot drift out of step with the orders
   that were actually created.

   Pure: no imports, no I/O. Both the browser (to show what is left) and the
   server (to refuse over-release) call these, so the two can never disagree. */

const int = v => { const n = Math.round(Number(v) || 0); return n > 0 ? n : 0; };

/* Which PI order a live production order came from. Orders created before
   splitting existed have no `source_order`; they ARE the whole PI order, so
   they answer for themselves. */
export const sourceOrderOf = order =>
  String(((order || {}).pi || {}).source_order || (order || {}).order_no || "").trim();

/* Spread a released quantity across a line's sizes.

   Proportional to what each size still has, with the remainder going to the
   earliest sizes — the same rule `splitQty` uses on the invoice, so a split
   run is packed the way the factory already packs a range. Guaranteed: every
   size takes at most what it has, and the parts add up to exactly `want`.
   Sizes are pairs and pairs are indivisible, so this is all integer work. */
export function takeFromSizes(sizes, want){
  const names = Object.keys(sizes || {});
  const have = names.map(n => int(sizes[n]));
  const total = have.reduce((a, b) => a + b, 0);
  const target = Math.min(int(want), total);
  if(!names.length || target <= 0)
    return { taken:{}, left:Object.fromEntries(names.map((n,i) => [n, have[i]])) };

  const exact = have.map(h => (h * target) / total);
  const base  = exact.map(Math.floor);
  let short   = target - base.reduce((a, b) => a + b, 0);
  // Remainder to the earliest sizes that can still absorb one.
  for(let i = 0; i < base.length && short > 0; i++)
    if(base[i] < have[i]){ base[i] += 1; short -= 1; }
  // Any leftover (only reachable through rounding) goes wherever there is room.
  for(let i = 0; i < base.length && short > 0; i++){
    const room = have[i] - base[i];
    const add = Math.min(room, short);
    base[i] += add; short -= add;
  }
  const taken = {}, left = {};
  names.forEach((n, i) => { if(base[i] > 0) taken[n] = base[i]; left[n] = have[i] - base[i]; });
  return { taken, left };
}

/* Pairs already released against each PI order, per size range.
   { [source_order]: { [combo]: pairs } } */
export function releasedBySource(liveOrders, piNo){
  const out = {};
  for(const o of liveOrders || []){
    if(String(((o.pi || {}).pi_no) || "").trim() !== String(piNo || "").trim()) continue;
    const src = sourceOrderOf(o);
    const bucket = out[src] || (out[src] = {});
    for(const l of o.lines || []) bucket[l.combo] = (bucket[l.combo] || 0) + int(l.qty);
  }
  return out;
}

/* What is still owed on ONE PI order, line by line. `released` is that order's
   entry from releasedBySource. A line already fully released is kept with a
   remaining of 0 rather than dropped — the screen has to be able to show that
   it is done, not merely omit it. */
export function remainingForOrder(snapshotOrder, released = {}){
  const lines = (snapshotOrder.lines || []).map(l => {
    const ordered = int(l.qty);
    const done = int(released[l.combo]);
    const remaining = Math.max(0, ordered - done);
    // The sizes still owed: take what has gone and keep the rest.
    const sizes = l.sizes && typeof l.sizes === "object"
      ? takeFromSizes(l.sizes, done).left : null;
    return { combo:l.combo, label:l.label || l.combo, ordered, released:done, remaining,
      ...(sizes ? { sizes } : {}),
      ...(Array.isArray(l.size_order) ? { size_order:l.size_order } : {}),
      ...(Number(l.ppc) > 0 ? { ppc:Number(l.ppc) } : {}) };
  });
  const remaining = lines.reduce((a, l) => a + l.remaining, 0);
  const ordered   = lines.reduce((a, l) => a + l.ordered, 0);
  return { order_no:snapshotOrder.order_no, article_code:snapshotOrder.article_code,
    lines, ordered, released:ordered - remaining, remaining, fully_released:remaining === 0 };
}

/* Every PI order with what is left on it. */
export function remainingForPi(snapshotOrders, liveOrders, piNo){
  const released = releasedBySource(liveOrders, piNo);
  return (snapshotOrders || []).map(o => remainingForOrder(o, released[o.order_no] || {}));
}

/* The next production-order number for a PI order. The FIRST release keeps the
   PI order's own number, so a PI released whole looks exactly as it always
   did; later runs are -2, -3, and read as what they are on the shop floor. */
export function nextRunNo(baseOrderNo, alreadyReleasedRuns){
  const n = int(alreadyReleasedRuns);
  return n <= 0 ? String(baseOrderNo) : `${baseOrderNo}-${n + 1}`;
}

/* Turn a request for pairs into the lines of one production order.
   `want` is { [combo]: pairs }; a combo left out releases none of it.
   Returns { lines, errors } — asking for more than is owed is an error, never
   silently trimmed, because a quantity nobody agreed to would go straight onto
   the machines. */
export function buildRunLines(remaining, want){
  const lines = [], errors = [];
  for(const l of remaining.lines){
    const asked = int((want || {})[l.combo]);
    if(!asked) continue;
    if(asked > l.remaining){
      errors.push(`${remaining.order_no} ${l.combo}: asked for ${asked} pairs but only ${l.remaining} remain unreleased`);
      continue;
    }
    const line = { combo:l.combo, qty:asked, label:l.label,
      ...(Array.isArray(l.size_order) ? { size_order:l.size_order } : {}),
      ...(l.ppc ? { ppc:l.ppc } : {}) };
    if(l.sizes) line.sizes = takeFromSizes(l.sizes, asked).taken;
    lines.push(line);
  }
  if(!lines.length && !errors.length) errors.push(`${remaining.order_no}: nothing was selected to release`);
  return { lines, errors };
}
