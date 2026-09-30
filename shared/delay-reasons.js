/* WHY IS THIS ORDER LATE?
 *
 * The dashboard could say an order was at risk or breached and stop there,
 * which tells a director the thing they can already see and nothing they can
 * act on. Every input to that verdict was computed and thrown away: the
 * engine dates each stage, records how long it waited for a machine, the
 * capacity it was divided by, and whether a planner pinned it by hand.
 *
 * This reassembles them into reasons, each with the days it cost, worst
 * first. Nothing here recalculates the plan — it reads what the planner
 * already decided, so the answer can never disagree with the board.
 *
 * WHAT IT WILL NOT DO IS GUESS. A reason is only reported when the figure
 * behind it exists: an unknown capacity produces no capacity reason rather
 * than a made-up one, and `days` is null where the cost is real but not
 * countable. "This order is late and I cannot tell you why" is a worse
 * answer than a short list, and a better one than an invented cause.
 */

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = v => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const daysBetween = (from, to) => {
  const a = day(from), b = day(to);
  if(!a || !b) return null;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
};

/* The planner's own instructions, in the planner's words. An order moved by
   hand is not "late" in the same sense as one stuck behind a machine — one is
   a decision, the other a constraint, and a director reading the board needs
   to know which. */
function overrideReasons(order){
  const ov = (order && order.override) || {};
  const out = [];
  if(ov.seq != null)
    out.push({ kind:"planned_by_hand", days:null,
      text:`Its place in the queue was set by hand to position ${ov.seq}.` });
  if(ov.start_on)
    out.push({ kind:"planned_by_hand", days:daysBetween(order.order_date, ov.start_on),
      text:`Its start was pinned by hand to ${ov.start_on}.` });
  for(const [stage, machine] of Object.entries(ov.machine || {}))
    out.push({ kind:"planned_by_hand", days:null,
      text:`${stage} was pinned by hand to ${machine}.` });
  for(const [stage, n] of Object.entries(ov.days || {}))
    out.push({ kind:"planned_by_hand", days:null,
      text:`${stage} was pinned by hand to finish in ${n} day${Number(n)===1?"":"s"}.` });
  return out;
}

export function delayReasons(order, options = {}){
  if(!order) return { status:"unknown", reasons:[], promise:null };
  const workcenters = options.workcenters || {};
  const nameOf = code => (workcenters[code] && workcenters[code].name) || code || "a machine";
  const stages = (order.stages || []).filter(s => s && !s.instant);
  const reasons = [];

  /* DATA FAULTS FIRST. An order whose article or BOM is missing is not late
     because of the factory; it is late because nobody can plan it. */
  if(order.article_missing)
    reasons.push({ kind:"data", days:null, stage:null,
      text:`Its article is no longer in the article master, so it cannot be planned at all.` });
  if(order.bom_missing)
    reasons.push({ kind:"data", days:null, stage:null,
      text:`${order.article || "This article"} has size ranges but no BOM rates, so it books machine `
         + `time while asking for no material — nothing is being bought for it.` });

  for(const r of overrideReasons(order)) reasons.push({ ...r, stage:null });

  /* THE RELEASE. Work cannot start on the day the order is taken when the
     route costs something before production. */
  const releaseDelay = num(order.release_delay_days);
  if(releaseDelay > 0)
    reasons.push({ kind:"release", days:releaseDelay, stage:null,
      text:`It could not start for ${releaseDelay} day${releaseDelay===1?"":"s"} after the order date`
         + `${order.printing ? " (printing and external handling)" : " (external handling)"}.` });

  for(const s of stages){
    const stage = s.stage;
    /* WAITING FOR A MACHINE — the commonest real cause, and the one a planner
       can actually do something about by re-sequencing. */
    const wait = num(s.queue_wait_days);
    if(wait > 0)
      reasons.push({ kind:"queue", days:wait, stage,
        text:`${stage} waited ${wait} day${wait===1?"":"s"} for ${nameOf(s.work_center)} — `
           + `work ahead of it in the queue had the machine.` });

    /* SHEER SIZE. Only claimable when the capacity is known: most centres
       still carry placeholder figures, and an invented rate reads as a
       measurement. */
    const cap = num(s.capacity_per_day), dur = num(s.duration_days);
    if(cap > 0 && dur > 1)
      reasons.push({ kind:"capacity", days:dur, stage,
        text:`${stage} takes ${dur} days: ${Math.round(num(order.qty)).toLocaleString("en-IN")} pairs `
           + `at ${Math.round(cap).toLocaleString("en-IN")} a day on ${nameOf(s.work_center)}.` });

    if(s.transit && dur > 0)
      reasons.push({ kind:"transit", days:dur, stage,
        text:`${dur} day${dur===1?"":"s"} in transit — the work is stitched outside and has to come `
           + `back before it can be checked.` });
  }

  /* A DATA FAULT LEADS, WHATEVER IT COSTS IN DAYS.
     Sorting purely by days buried "this article has no BOM" under a four-day
     machine queue, because a missing BOM has no day count at all. It is not a
     smaller problem than the queue — it is a different kind, and the only one
     on the list that nobody on the floor can fix. Everything else is then
     worst-first, because that is how a director triages, and a reason with no
     countable cost sorts below one that has a number. */
  const rank = r => r.kind === "data" ? 0 : 1;
  reasons.sort((a, b) => rank(a) - rank(b)
    || (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days));

  const late = daysBetween(order.target_date, order.dispatch_date);
  return {
    status: order.sla || "unknown",
    order_no: order.order_no,
    party: order.party || "",
    article: order.article || order.article_code || "",
    qty: Math.round(num(order.qty)),
    order_date: day(order.order_date),
    release_date: day(order.release_date),
    dispatch_date: day(order.dispatch_date),
    lead_days: num(order.lead_days),
    /* Days past the promise, when a promise exists. Null is not zero. */
    late_by: late != null && late > 0 ? late : null,
    reasons,
    /* The stage carrying the worst slip, which is where a planner would push. */
    bottleneck: stages.reduce((worst, s) =>
      (worst == null || num(s.slip_days) > num(worst.slip_days)) ? s : worst, null),
  };
}
