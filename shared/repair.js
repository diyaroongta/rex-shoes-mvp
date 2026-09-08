/* Repair, between production and dispatch.
 *
 * A finished shoe fails inspection before it goes on the lorry. The factory's
 * own ARMOUR 17004 card already says how this is recorded: each movement is a
 * DATE, a SIZE and a QUANTITY — "SEND FOR REPAIR", "RECIVED AFTER REPAIR",
 * "REJECTION". So this is an EVENT LOG, not three counters, and the counters
 * are derived from it. Keeping the events means the card can be reproduced and
 * a wrong entry can be reversed; keeping only totals means neither.
 *
 * THE RULE BORROWED FROM JOB WORK: a partial return is still OUT, not short.
 * Pairs sent for repair and not yet back are IN REPAIR — they are not a
 * shortage until somebody writes them off as rejected. Treating the balance as
 * a shortage would report goods as lost while they are sitting on the bench.
 *
 * Pure — no database, no clock.
 */

export const MOVEMENTS = ["sent", "returned", "rejected"];

export const MOVEMENT_LABEL = {
  sent:     "Sent for repair",
  returned: "Received after repair",
  rejected: "Rejected",
};

const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
/* Rounding is NOT the same as accepting. A quantity of 2.5 pairs is somebody
   mistyping, and rounding it to 3 puts a pair into the record that was never
   inspected — so the validator refuses it. `tally` rounds, because that is
   only summing values the validator has already accepted. */
const exact = v => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const tally = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : NaN; };

/* Sizes are written as they are printed — "8s" is the kids run, "8" the adult
   repeat — so they are compared as text, never coerced to a number. */
const sizeKey = v => clean(v);

/* One movement, checked against what the order can actually support.
   `available` is the pairs of that size not yet dispatched; `already` is what
   this order has already sent / returned / rejected for that size. */
export function validateMovement(entry = {}, context = {}){
  const problems = [];
  const kind = clean(entry.kind).toLowerCase();
  const size = sizeKey(entry.size);
  const qty = exact(entry.qty);
  const on = clean(entry.on).slice(0, 10);

  if(!MOVEMENTS.includes(kind)) problems.push(`Movement must be one of: ${MOVEMENTS.join(", ")}`);
  if(!clean(entry.order_no)) problems.push("An order number is required");
  if(!size) problems.push("A size is required");
  if(!Number.isFinite(qty) || qty <= 0) problems.push("Quantity must be a whole number of 1 or more");
  if(on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) problems.push("Date must be YYYY-MM-DD");

  const already = context.already || {};
  const sent = tally(already.sent) || 0;
  const returned = tally(already.returned) || 0;
  const rejected = tally(already.rejected) || 0;
  const inRepair = Math.max(0, sent - returned - rejected);

  if(Number.isFinite(qty) && qty > 0){
    if(kind === "sent"){
      /* You cannot send for repair what has already left, and you cannot send
         the same pair twice without it coming back first. */
      const available = context.available == null ? null : tally(context.available);
      if(available != null && qty > available - inRepair)
        problems.push(`Only ${Math.max(0, available - inRepair)} pair(s) of size ${size} are available to send`);
    } else if(qty > inRepair){
      problems.push(`Only ${inRepair} pair(s) of size ${size} are in repair`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    value: { order_no: clean(entry.order_no), size, kind, qty: Number.isFinite(qty) ? qty : 0,
             on: on || null, note: clean(entry.note).slice(0, 300) || null },
  };
}

/* Every movement rolled up: by order, and within an order by size.
   `in_repair` is what is physically on the repair bench right now. */
export function repairLedger(entries = []){
  const byOrder = {};
  for(const e of entries){
    const order = clean(e.order_no);
    const size = sizeKey(e.size);
    const kind = clean(e.kind).toLowerCase();
    const qty = tally(e.qty) || 0;
    if(!order || !size || !MOVEMENTS.includes(kind) || qty <= 0) continue;

    const rec = byOrder[order] || (byOrder[order] = {
      order_no: order, sizes: {}, sent: 0, returned: 0, rejected: 0, in_repair: 0, events: 0,
    });
    const row = rec.sizes[size] || (rec.sizes[size] = {
      size, sent: 0, returned: 0, rejected: 0, in_repair: 0,
    });
    row[kind] += qty;
    rec[kind] += qty;
    rec.events += 1;
  }

  for(const rec of Object.values(byOrder)){
    for(const row of Object.values(rec.sizes))
      row.in_repair = Math.max(0, row.sent - row.returned - row.rejected);
    rec.in_repair = Math.max(0, rec.sent - rec.returned - rec.rejected);
    rec.size_order = Object.keys(rec.sizes).sort((a, z) =>
      String(a).localeCompare(String(z), undefined, { numeric: true }));
  }
  return byOrder;
}

/* Pairs an order cannot ship yet because they are on the repair bench. The
   dispatch screen reads this: shipping a pair that is being repaired is how a
   customer receives the very shoe that failed inspection. */
export function heldByRepair(ledger, orderNo){
  const rec = (ledger || {})[clean(orderNo)];
  return rec ? rec.in_repair : 0;
}

/* The whole factory's repair position, for a dashboard line. */
export function repairTotals(ledger){
  const out = { orders: 0, sent: 0, returned: 0, rejected: 0, in_repair: 0 };
  for(const rec of Object.values(ledger || {})){
    out.orders += 1;
    out.sent += rec.sent;
    out.returned += rec.returned;
    out.rejected += rec.rejected;
    out.in_repair += rec.in_repair;
  }
  return out;
}

/* What proportion of what was inspected had to go back. The number the factory
   actually wants — a line sending 8% back is a different problem from one
   sending 0.5% back. Returns null rather than 0 when nothing has been sent,
   because "no repairs yet" and "a 0% repair rate" are not the same claim. */
export function repairRate(ledger, producedPairs){
  const total = repairTotals(ledger);
  const base = Number(producedPairs);
  if(!Number.isFinite(base) || base <= 0 || total.sent === 0) return null;
  return Math.round((total.sent / base) * 1000) / 10;
}
