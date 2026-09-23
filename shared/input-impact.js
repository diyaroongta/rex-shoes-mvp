/* "WHAT DID MY ENTRY JUST DO?"
 *
 * Somebody on the floor types "we cut 300 today" and presses save. Four
 * different things then move — the card's own plan, the order's dispatch
 * date, tomorrow's machine load, and the delivery status the customer is
 * judged on — and until now the screen said only "Saved".
 *
 * This compares the plan BEFORE the entry with the plan AFTER it and reports
 * the difference in the factory's own terms. It reports nothing it cannot
 * show: a figure that did not move is listed as unchanged rather than left
 * out, because "procurement did not change" is information, and its absence
 * reads as "nobody checked".
 *
 * Pure: it is given both plans, and compares them. No database, no clock.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const byKey = (rows, key) => new Map((rows || []).map(r => [r[key], r]));
const dayDiff = (a, b) => (!a || !b) ? null
  : Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const SLA_WORD = { on_track:"On track", at_risk:"At risk", breach:"Delayed" };

/* What physically went into the database, named the way the database names it
   — so a person can be shown the row rather than asked to trust a summary. */
export function storedRows(saved = []){
  return (saved || []).map(r => ({
    table: "production_actuals",
    key: [r.production_on, r.work_center, r.stage, r.unit_key || r.order_no].join(" · "),
    production_on: r.production_on,
    work_center: r.work_center,
    stage: r.stage,
    order_no: r.order_no,
    job_card_no: r.job_card_no || null,
    planned_pairs: Math.round(num(r.planned_pairs)),
    actual_pairs: Math.round(num(r.actual_pairs)),
    /* The gap is what drives everything downstream, so it is computed once
       here rather than in three screens. */
    gap: Math.round(num(r.actual_pairs) - num(r.planned_pairs)),
    note: r.note || "",
  }));
}

export function planImpact(before, after, saved = []){
  const stored = storedRows(saved);
  const wasOrders = byKey((before || {}).orders, "order_no");
  const nowOrders = byKey((after || {}).orders, "order_no");

  const orders = [];
  for(const [no, now] of nowOrders){
    const was = wasOrders.get(no);
    if(!was) continue;
    const moved = was.dispatch_date !== now.dispatch_date;
    const slaMoved = was.sla !== now.sla;
    if(!moved && !slaMoved) continue;
    orders.push({
      order_no: no, party: now.party, article: now.article_code || now.article,
      dispatch_before: was.dispatch_date, dispatch_after: now.dispatch_date,
      days_moved: dayDiff(was.dispatch_date, now.dispatch_date),
      sla_before: was.sla, sla_after: now.sla,
      sla_before_label: SLA_WORD[was.sla] || was.sla,
      sla_after_label: SLA_WORD[now.sla] || now.sla,
      /* A later date and a worse status are different kinds of bad news and a
         screen should be able to colour them apart. */
      worse: (now.dispatch_date || "") > (was.dispatch_date || "")
             || RANK(now.sla) > RANK(was.sla),
    });
  }

  const wasUnits = byKey((before || {}).units, "unit_key");
  const cards = [];
  for(const now of (after || {}).units || []){
    const was = wasUnits.get(now.unit_key);
    if(!was || was.dispatch_date === now.dispatch_date) continue;
    cards.push({
      unit_key: now.unit_key, order_no: now.order_no, card_no: now.card_no,
      dispatch_before: was.dispatch_date, dispatch_after: now.dispatch_date,
      days_moved: dayDiff(was.dispatch_date, now.dispatch_date),
    });
  }

  /* Work that left the machine board because it is finished, and work that
     appeared on it because it is not. */
  const load = [];
  const centres = new Set([
    ...Object.keys((before || {}).daily_load || {}),
    ...Object.keys((after || {}).daily_load || {}),
  ]);
  for(const centre of centres){
    const wasDays = ((before || {}).daily_load || {})[centre] || {};
    const nowDays = ((after || {}).daily_load || {})[centre] || {};
    const wasTotal = Object.values(wasDays).reduce((a, v) => a + num(v), 0);
    const nowTotal = Object.values(nowDays).reduce((a, v) => a + num(v), 0);
    const delta = Math.round(nowTotal - wasTotal);
    if(delta === 0) continue;
    load.push({ work_center: centre, pairs_before: Math.round(wasTotal),
                pairs_after: Math.round(nowTotal), delta });
  }
  load.sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta));

  const shortBefore = ((before || {}).procurement || []).length;
  const shortAfter = ((after || {}).procurement || []).length;

  const behind = stored.filter(r => r.gap < 0);
  const ahead = stored.filter(r => r.gap > 0);

  return {
    stored,
    pairs_recorded: stored.reduce((a, r) => a + r.actual_pairs, 0),
    pairs_planned: stored.reduce((a, r) => a + r.planned_pairs, 0),
    behind_rows: behind.length,
    behind_pairs: behind.reduce((a, r) => a + Math.abs(r.gap), 0),
    ahead_rows: ahead.length,
    ahead_pairs: ahead.reduce((a, r) => a + r.gap, 0),
    orders, cards, load,
    procurement: { short_before: shortBefore, short_after: shortAfter,
                   changed: shortBefore !== shortAfter },
    /* SAID OUT LOUD, not omitted. Each of these is a thing a person might
       reasonably fear the entry silently changed. */
    unchanged: [
      orders.length ? null : "No order's dispatch date or delivery status moved.",
      cards.length ? null : "No job card's own dates moved.",
      load.length ? null : "Machine loading is unchanged.",
      shortBefore === shortAfter ? "The buying list is unchanged — recording production does not change what was ordered." : null,
      "Nothing was written to the order book, the PI or the dispatch book.",
    ].filter(Boolean),
  };
}

const RANK = sla => ({ on_track:0, at_risk:1, breach:2 })[sla] ?? 0;
