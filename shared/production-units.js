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
 *   balance  the pairs of an order that no job card has claimed yet. They are
 *            NOT put on machines, because the floor has not released them,
 *            but procurement still has to buy for them and the Order Book
 *            must show them as waiting.
 *
 * The three kinds add up to the order, never more, so material demand and the
 * pair count are unchanged by the split.
 *
 * Pure: no database, no clock.
 */
import { jobOrderBalance } from "./job-orders.js";
import { productionOrder, upperPairs, splitLines } from "./stock-plan.js";

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
    /* A CLOSED card is finished work: it is not scheduled again and buys no
       material, but its pairs still count as released (they were made). */
    closed: String(job.status || "") === "closed",
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
    /* A card raised for pairs whose uppers are already in the upper store
       starts at MOULDING: nothing is cut or stitched for it. */
    ...(startStageOf(job) ? { start_stage: startStageOf(job) } : {}),
    created_on: isoDate(job.issued_on) || isoDate((job.card || {}).date),
    order_date: isoDate((job.card || {}).start_on) || isoDate(job.start_on)
      || isoDate(job.issued_on) || isoDate((job.card || {}).date) || isoDate(order.order_date),
    lines,
  });
}

function balanceUnit(order, lines, startStage = null){
  return base(order, {
    unit_key: `${order.order_no}#BAL${startStage ? "U" : ""}`,
    unit_kind: "balance",
    order_date: isoDate(order.order_date),
    ...(startStage ? { start_stage: startStage } : {}),
    lines,
  });
}

export const UPPER_START_STAGE = "MOLDING";
const startStageOf = job => String((job && job.card && job.card.start_stage) || "").toUpperCase() === UPPER_START_STAGE
  ? UPPER_START_STAGE : null;

/* Pairs of each size already on a card of one kind — moulding-start cards
   when `fromUppers`, full-routing cards otherwise. Only a card that names its
   sizes can be counted against a size. */
export function cardedBySize(jobs = [], fromUppers = false){
  const out = {};
  for(const job of jobs || []){
    if(!!startStageOf(job) !== !!fromUppers) continue;
    for(const line of (job.card && job.card.lines) || [])
      for(const [size, n] of Object.entries(line.sizes || {})){
        const k = String(size).trim().toLowerCase();
        out[k] = (out[k] || 0) + qty(n);
      }
  }
  return out;
}

/* THE BALANCE OF AN ORDER WHOSE STOCK HAS BEEN DECIDED, in the two parts the
   floor releases separately:

     from_uppers  pairs whose uppers are reserved in the upper store. Their
                  card starts at MOULDING.
     full         everything else still to be made, through the whole routing.

   Pairs supplied from finished goods are in neither — they are not made.
   `jobs` are this order's live cards. Shared by the planner, the Create Job
   Order screen and the server's cap, so all three count the same balance. */
export function releaseBalance(order, jobs = []){
  const balance = jobOrderBalance(productionOrder(order), jobs);
  const left = balance.lines.filter(line => line.remaining > 0)
    .map(line => ({ combo: line.combo, label: line.label, qty: line.remaining,
                    sizes: line.remaining_sizes || null,
                    ...(Array.isArray(line.size_order) && line.size_order.length ? { size_order: line.size_order } : {}) }));
  const owed = upperPairs(order), done = cardedBySize(jobs, true);
  const stillFromUppers = Object.fromEntries(Object.entries(owed)
    .map(([size, n]) => [size, Math.max(0, n - (done[size] || 0))]));
  const { taken, left: full } = splitLines(left, stillFromUppers);
  return { balance, from_uppers: taken, full,
    from_upper_pairs: taken.reduce((a, l) => a + qty(l.qty), 0),
    full_pairs: full.reduce((a, l) => a + qty(l.qty), 0) };
}

/* Does this order's stock decision change what is put on job cards? */
export const usesStock = order => productionOrder(order) !== order || Object.keys(upperPairs(order)).length > 0;

/* THE BALANCE ONE CARD MAY DRAW ON, in the shape jobOrderBalance returns, for
   an order whose stock has been decided: the pairs starting at moulding when
   `fromUppers`, otherwise the pairs to make through the full routing. A remake
   belongs to the full routing — pairs lost on the floor are made again from
   the beginning. */
export function cardBalance(order, jobs = [], fromUppers = false){
  const mine = (jobs || []).filter(job => !(job && job.cancelled)
    && String(job && job.order_no || "") === String(order && order.order_no || ""));
  const release = releaseBalance(order, mine);
  const lines = (fromUppers ? release.from_uppers : release.full).map(line => ({
    combo: line.combo, label: line.label || line.combo, ordered: qty(line.qty), issued: 0,
    remaining: qty(line.qty), remaining_sizes: line.sizes || undefined,
    size_order: Array.isArray(line.size_order) ? line.size_order : Object.keys(line.sizes || {}) }));
  const remaining = lines.reduce((a, line) => a + line.remaining, 0);
  const toRemake = fromUppers ? 0 : release.balance.to_remake;
  return { ...release.balance, lines, remaining, to_remake: toRemake,
    remake_allowance: remaining + toRemake,
    from_upper_pairs: release.from_upper_pairs, full_pairs: release.full_pairs };
}

/* One order in, one or more units out. Jobs that carry no size-wise card are
   NOT made into units — they are ad-hoc job work with no quantities the
   planner can place — but they still consume the order's balance, exactly as
   the Job Orders screen counts them. */
export function productionUnits(orders = [], jobs = []){
  const all = Array.isArray(jobs) ? jobs : [];
  const units = [];
  for(const order of orders || []){
    /* A card cancelled with its order is not work; an ARCHIVED card is — it was
       finished and filed, and its pairs must not fall back into the balance. */
    const mine = all.filter(job => !(job && job.cancelled)
      && String(job && job.order_no || "") === String(order.order_no || ""));
    const carded = mine.filter(carriesCard);
    /* STOCK FIRST. Pairs the order takes from finished goods are never made,
       so they are on no unit at all; pairs covered by uppers already in the
       store wait for a card that starts at moulding. An order with no stock
       decision goes through exactly as it always did. */
    const decided = productionOrder(order) !== order || Object.keys(upperPairs(order)).length > 0;
    if(!carded.length && !decided){
      /* Issuing a PI creates an ORDER, not a production release. Previously
         this fallback silently treated the full order as a scheduled unit,
         which made a brand-new PI read "all of it" under On job cards. The
         whole quantity is a balance until a real, size-wise job card exists. */
      units.push(balanceUnit(order, order.lines || []));
      continue;
    }
    for(const job of carded) units.push(jobUnit(order, job));

    if(!decided){
      const balance = jobOrderBalance(order, mine);
      const left = balance.lines
        .filter(line => line.remaining > 0)
        .map(line => ({ combo: line.combo, label: line.label,
                        qty: line.remaining, sizes: line.remaining_sizes || null }));
      if(left.length) units.push(balanceUnit(order, left));
      continue;
    }
    const release = releaseBalance(order, mine);
    if(release.from_uppers.length) units.push(balanceUnit(order, release.from_uppers, UPPER_START_STAGE));
    /* An order always has at least one unit, even an empty one: an order with
       none is planned WHOLE by the engine, which is exactly wrong for an order
       its stock decision covers completely from finished goods. */
    if(release.full.length || (!carded.length && !release.from_uppers.length))
      units.push(balanceUnit(order, release.full));
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
