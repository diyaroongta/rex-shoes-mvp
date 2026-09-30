/* WHAT IS EACH MACHINE MAKING TODAY, AND WHY THAT JOB.
 *
 * The schedule board answered a different question from the one the factory
 * asks. It drew one row per order across the whole horizon — good for "when
 * does JO2112 ship", useless for the question actually put to it: "what is the
 * rotary running right now, and why that order and not another one?"
 *
 * Every figure needed was already computed and thrown away. `compute()` gives
 * each stage a work centre, a start and end, and `alloc` — the pairs booked on
 * that centre on each day. This joins them the other way round: by MACHINE,
 * for ONE day.
 *
 * The "why" is not a guess either. A job is on a machine today because of
 * exactly one of a short list of reasons, and the planner can act on each:
 * somebody pinned it by hand, it is urgent, or it simply reached the front of
 * the queue. Naming which turns an opaque board into an argument the planner
 * can overrule.
 *
 * Pure: units in, a day in, an answer out. No clock — the day is passed.
 */
import { dayIndex, fromDay, workCentresInOrder } from "./engine.js";

const REAL_STAGE = s => s && !s.instant && s.work_center;

/* Why this job is on this machine today, in the planner's own terms and in
 * the order that decides it: a hand-written instruction beats priority, and
 * priority beats queue position. */
function reasonFor(unit, queuePos, queueLen){
  const ov = unit.override || {};
  const pinned = [];
  if(ov.seq != null)      pinned.push("its queue position was pinned");
  if(ov.start_on)         pinned.push(`its start was pinned to ${ov.start_on}`);
  if(ov.machine && Object.keys(ov.machine).length) pinned.push("a stage was pinned to this machine");
  if(ov.days && Object.keys(ov.days).length)       pinned.push("a stage was pinned to a fixed number of days");
  if(pinned.length) return { kind:"manual", text:`Planned by hand — ${pinned.join(", ")}.` };
  if(Number(unit.priority) === 1)
    return { kind:"urgent", text:"Marked urgent (P1), so it takes the machine before normal work." };
  if(Number(unit.priority) === 3)
    return { kind:"low", text:"Marked low priority (P3) — it runs when nothing above it needs the machine." };
  return { kind:"queue",
    text: queuePos
      ? `Next in the queue — position ${queuePos} of ${queueLen}, by order date.`
      : "In the queue by order date." };
}

export function floorToday({ units = [], workcenters = {}, queue = [], today, origin }){
  const todayIdx = dayIndex(today, origin);
  const pos = new Map(queue.map((key, i) => [key, i + 1]));
  /* Route order, from the one definition — and real machines only. The
     reference document carries `_lead_time_rules` alongside the work centres,
     and it is not something anybody makes shoes on. */
  const real = Object.fromEntries(
    Object.entries(workcenters).filter(([code]) => !String(code).startsWith("_")));
  const codes = workCentresInOrder(real);

  const centres = codes.map(code => {
    const wc = workcenters[code] || {};
    const capacity = Number(wc.capacity_per_day) || 0;
    const running = [];
    let next = null;

    for(const unit of units){
      for(const stage of (unit.stages || [])){
        if(!REAL_STAGE(stage) || stage.work_center !== code) continue;

        if(stage.start <= todayIdx && todayIdx <= stage.end){
          const alloc = stage.alloc || {};
          const pairsToday = Number(alloc[todayIdx]) || 0;
          /* Pairs this stage already put through BEFORE today, so the card can
             say how far along the job is rather than only that it is here. */
          let before = 0;
          for(const [d, v] of Object.entries(alloc))
            if(Number(d) < todayIdx) before += Number(v) || 0;
          const qty = Number(unit.qty) || 0;
          running.push({
            unit_key: unit.unit_key, order_no: unit.order_no, card_no: unit.card_no || null,
            article: unit.article, party: unit.party || "",
            stage: stage.stage, qty,
            pairs_today: pairsToday,
            /* A stage inside its own start..end that books NO pairs today is
               WAITING for this machine, not running on it. Drawing the two the
               same way is what made the old board unreadable. */
            waiting: pairsToday === 0,
            done_before: before,
            pct_through: qty ? Math.min(100, Math.round(100 * (before + pairsToday) / qty)) : null,
            priority: unit.priority, overridden: !!unit.overridden,
            queue_pos: pos.get(unit.unit_key) || null,
            ends_on: stage.end_date || fromDay(stage.end, origin),
            reason: reasonFor(unit, pos.get(unit.unit_key), queue.length),
          });
        }else if(stage.start > todayIdx){
          const starts = stage.start;
          if(!next || starts < next.start)
            next = { start: starts, starts_on: stage.start_date || fromDay(starts, origin),
              days_away: starts - todayIdx, order_no: unit.order_no, card_no: unit.card_no || null,
              article: unit.article, stage: stage.stage, qty: Number(unit.qty) || 0 };
        }
      }
    }

    /* Working first, then whoever is waiting on this machine — the planner
       reads the top of the card and stops. */
    running.sort((a, b) => Number(a.waiting) - Number(b.waiting)
      || b.pairs_today - a.pairs_today
      || (a.queue_pos || 1e9) - (b.queue_pos || 1e9));

    const booked = running.reduce((n, r) => n + r.pairs_today, 0);
    return {
      code, name: wc.name || code, stage: wc.stage || null,
      capacity_per_day: capacity || null,
      booked_today: +booked.toFixed(2),
      /* Capacity is a placeholder on most centres and an unknown one cannot be
         a percentage. Null says "not known", which is not the same as 0%. */
      util_pct: capacity ? Math.round(100 * booked / capacity) : null,
      over_capacity: !!capacity && booked > capacity + 1e-9,
      running, idle: running.length === 0, next,
    };
  });

  return {
    date: today,
    centres,
    busy: centres.filter(c => c.running.some(r => !r.waiting)).length,
    idle: centres.filter(c => c.idle).length,
    pairs_today: +centres.reduce((n, c) => n + c.booked_today, 0).toFixed(2),
  };
}
