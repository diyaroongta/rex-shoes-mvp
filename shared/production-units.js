/* PRODUCTION UNITS — what the planner actually schedules.
 *
 * An order is a COMMERCIAL fact: 10,000 pairs, one customer, one delivery
 * promise. It is not how the factory makes them. The floor releases work in
 * BATCHES, one job card at a time — five cards of 2,000 pairs on five
 * different days — and each of those batches is what occupies cutting,
 * stitching and moulding on the day it runs.
 *
 * Scheduling the ORDER pretends all 10,000 pairs start together, which puts
 * the machine load on the wrong days and dates the dispatch from a release
 * that never happened. So the order is split into units:
 *
 *   job      one issued job card. Released on the card's OWN date, carrying
 *            the card's own size-wise quantities.
 *   balance  the pairs of an order that no job card has claimed yet. Still
 *            planned, because the customer is owed them and procurement has
 *            to buy for them — it is work waiting to be released.
 *   order    an order with no job cards at all. One unit, the whole order:
 *            exactly what the planner did before job cards existed.
 *
 * The three kinds add up to the order, never more, so material demand and the
 * pair count are unchanged by the split.
 *
 * Pure: no database, no clock.
 */
import { jobOrderBalance } from "./job-orders.js";

const qty = v => Math.max(0, Math.round(Number(v) || 0));

/* Postgres hands back `issued_on` as a Date OBJECT, and String(date) is
   "Wed Sep 09 2026", which is not a date the planner can index. It is read in
   LOCAL time on purpose: toISOString() on a date-only value stored at local
   midnight rolls back a day and releases the batch before it was issued. */
export function isoDate(value){
  if(value == null || value === "") return null;
  if(value instanceof Date){
    if(isNaN(value)) return null;
    const p = n => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${p(value.getMonth()+1)}-${p(value.getDate())}`;
  }
  const s = String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : isoDate(d);
}

const carriesCard = job => Array.isArray(job && job.card && job.card.lines) && job.card.lines.length > 0;

/* Fields every unit inherits from its order. The unit is ORDER-SHAPED because
   the engine schedules it unchanged — `order_no` is the unit's key, which is
   why a single-unit order keeps the order number itself and every existing
   plan override goes on working. */
function base(order, extra){
  return {
    order_no: extra.unit_key,
    unit_key: extra.unit_key,
    source_order_no: order.order_no,
    article_code: order.article_code,
    party: order.party,
    priority: order.priority,
    pi: order.pi || {},
    stitching: order.stitching || (order.pi || {}).stitching || "inhouse",
    printing: !!(order.printing || (order.pi || {}).printing),
    /* The delivery promise is made on the ORDER's date and does not move
       because a batch was released late — that is the very slippage the SLA
       exists to show. Release drives the schedule; this drives the target. */
    target_base_date: isoDate(order.order_date),
    ...extra,
  };
}

function jobUnit(order, job){
  const lines = job.card.lines
    .map(line => ({ combo: line.combo, label: line.label || line.combo,
                    qty: qty(line.qty),
                    sizes: line.sizes && typeof line.sizes === "object" ? { ...line.sizes } : null }))
    .filter(line => line.qty > 0);
  return base(order, {
    unit_key: `${order.order_no}#JC${job.id}`,
    unit_kind: "job",
    job_id: job.id,
    card_no: String((job.card && job.card.card_no) || job.id || "").trim(),
    fabricator: job.fabricator || "",
    job_stage: job.stage || "",
    /* A CARD HAS TWO DATES AND THEY ARE NOT THE SAME DAY.
         created_on   when the card was written. What the Job Orders Database
                      lists it under, and what the paperwork is filed by.
         order_date   when work is meant to START. This is what the plan
                      schedules from, because a card written on Friday for a
                      run beginning Monday occupies Monday's machines, not
                      Friday's.
       A card with no start date falls back to the day it was written, and one
       with neither falls back to the ORDER's date — never to today, because
       the planner is pure and has no clock. */
    created_on: isoDate(job.issued_on) || isoDate((job.card || {}).date),
    order_date: isoDate((job.card || {}).start_on) || isoDate(job.start_on)
      || isoDate(job.issued_on) || isoDate((job.card || {}).date) || isoDate(order.order_date),
    lines,
  });
}

function balanceUnit(order, lines){
  return base(order, {
    unit_key: `${order.order_no}#BAL`,
    unit_kind: "balance",
    order_date: isoDate(order.order_date),
    lines,
  });
}

/* One order in, one or more units out. Jobs that carry no size-wise card are
   NOT made into units — they are ad-hoc job work with no quantities the
   planner can place — but they still consume the order's balance, exactly as
   the Job Orders screen counts them. */
export function productionUnits(orders = [], jobs = []){
  const all = Array.isArray(jobs) ? jobs : [];
  const units = [];
  for(const order of orders || []){
    const mine = all.filter(job => String(job && job.order_no || "") === String(order.order_no || ""));
    const carded = mine.filter(carriesCard);
    if(!carded.length){
      units.push(base(order, { unit_key: order.order_no, unit_kind: "order",
                               order_date: isoDate(order.order_date), lines: order.lines || [] }));
      continue;
    }
    for(const job of carded) units.push(jobUnit(order, job));

    const balance = jobOrderBalance(order, mine);
    const left = balance.lines
      .filter(line => line.remaining > 0)
      .map(line => ({ combo: line.combo, label: line.label,
                      qty: line.remaining, sizes: line.remaining_sizes || null }));
    if(left.length) units.push(balanceUnit(order, left));
  }
  return units;
}

/* How a unit is named on screen. The card number is what the floor calls it;
   an unreleased balance says so in as many words, because "JO2112 balance"
   and "JO2112" are different amounts of work and must not read alike. */
export function unitLabel(unit){
  if(!unit) return "";
  if(unit.unit_kind === "job") return unit.card_no ? `Card ${unit.card_no}` : `Card #${unit.job_id}`;
  if(unit.unit_kind === "balance") return "Not yet on a job card";
  return "Whole order";
}

export function unitPairs(unit){
  return (unit && unit.lines || []).reduce((a, line) => a + qty(line.qty), 0);
}
