/* WHERE THE WORK ACTUALLY IS — the status board.
 *
 * Two different questions get asked with the same words, and answering them
 * with one number is how a plan starts lying:
 *
 *   WHERE SHOULD IT BE?   The plan says this card is in moulding today. That
 *                         is a FORECAST. It is true of a factory where
 *                         everything ran to capacity.
 *   WHERE IS IT?          Somebody issued it to a stitching line on the 12th
 *                         and nothing has been recorded since. That is a
 *                         RECORDED MOVEMENT — a fact, with a date on it.
 *
 * So every row carries both, and says whether they agree. A board that showed
 * only the plan would report work as moulding that is still sitting in
 * cutting; one that showed only movements would report nothing at all for the
 * orders nobody has keyed yet.
 *
 * WHAT COUNTS AS A RECORDED MOVEMENT is deliberately narrow — only things
 * somebody physically did and wrote down:
 *   a job card issued      that stage has STARTED
 *   a job card received    that stage has FINISHED (partly or fully)
 *   a dispatch recorded    it has left the factory
 * Anything else is a forecast and is labelled as one.
 *
 * Pure: no database, and `today` is injected.
 */
import { STAGE_SEQUENCE } from "./engine.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const iso = v => {
  if(v == null || v === "") return null;
  if(v instanceof Date) return isNaN(v) ? null
    : `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}`;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : null;
};
const rank = stage => { const i = STAGE_SEQUENCE.indexOf(stage); return i < 0 ? 99 : i; };

/* The stage the PLAN has this work in today, and whether it has started. */
export function plannedPosition(view, today){
  const stages = ((view && view.stages) || []).filter(s => !s.instant && s.start_date);
  if(!stages.length) return { phase:"unplanned", stage:null, since:null, until:null };
  const first = stages[0], last = stages[stages.length - 1];
  if(today < first.start_date)
    return { phase:"not_started", stage:first.stage, since:null, until:first.start_date };
  if(today > last.end_date)
    return { phase:"finished", stage:last.stage, since:last.start_date, until:last.end_date };
  const here = stages.find(s => today >= s.start_date && today <= s.end_date)
    /* Between two stages — the plan has it waiting for the next one. */
    || stages.find(s => s.start_date > today) || last;
  return { phase: here.start_date > today ? "waiting" : "running",
           stage: here.stage, since: here.start_date, until: here.end_date,
           work_center: here.work_center || null };
}

/* The last thing anybody WROTE DOWN about this work. Job cards are matched on
   the order, and on the card when the row is a batch — a card issued against
   one batch says nothing about the batch beside it. */
export function recordedPosition(view, ctx = {}){
  const orderNo = String((view && view.order_no) || "");
  const unitKey = (view && view.unit_key) || orderNo;
  const isBatch = unitKey !== orderNo;
  const events = [];

  for(const job of ctx.jobs || []){
    if(String(job.order_no || "") !== orderNo) continue;
    if(isBatch && String(view.job_id || "") !== String(job.id || "")) continue;
    const stage = String(job.stage || "").split("&")[0].trim().toUpperCase() || "STITCHING";
    const issued = iso(job.issued_on) || iso((job.card || {}).date);
    if(issued) events.push({ on:issued, stage, kind:"issued", pairs:num(job.qty),
      detail:`${num(job.qty)} pairs issued to ${job.fabricator || "a line"}`,
      card_no:(job.card || {}).card_no || job.id });
    if(num(job.received) > 0)
      /* A receipt has no date of its own on the row, so it is dated by the
         job's last update rather than invented. */
      events.push({ on: iso(job.updated_at) || issued, stage, kind:"received", pairs:num(job.received),
        detail:`${num(job.received)} of ${num(job.qty)} pairs back from ${job.fabricator || "the line"}`,
        card_no:(job.card || {}).card_no || job.id });
  }
  for(const d of ctx.dispatches || []){
    if(String(d.order_no || "") !== orderNo) continue;
    if(d.hidden) continue;
    const pairs = Object.values(d.dispatched || {}).reduce((a,v)=>a+num(v),0);
    const on = iso(d.dispatched_on) || iso(d.created_at);
    if(on) events.push({ on, stage:"DISPATCH", kind:"dispatched", pairs,
      detail:`${pairs} pairs dispatched` });
  }

  events.sort((a,z) => a.on < z.on ? -1 : a.on > z.on ? 1 : rank(a.stage) - rank(z.stage));
  const last = events[events.length - 1] || null;
  return { events, last,
    stage: last ? last.stage : null,
    on: last ? last.on : null,
    /* NOTHING RECORDED is its own answer, and must not read as "in cutting". */
    phase: last ? last.kind : "nothing_recorded" };
}

/* One row of the board: where the plan has it, where the last movement puts
   it, and whether those two agree. */
export function statusRow(view, ctx = {}){
  const today = ctx.today;
  const planned = plannedPosition(view, today);
  const recorded = recordedPosition(view, ctx);
  const agrees = recorded.stage == null ? null : rank(recorded.stage) === rank(planned.stage);
  const behind = recorded.stage != null && rank(recorded.stage) < rank(planned.stage);
  return {
    order_no: view.order_no, unit_key: view.unit_key || view.order_no,
    unit_kind: view.unit_kind || "order", card_no: view.card_no || null,
    party: view.party, article: view.article_code || view.article, qty: view.qty,
    dispatch_date: view.dispatch_date, sla: view.sla,
    planned, recorded, agrees, behind,
    /* The column the row is DRAWN in. The board is about where work is, so a
       recorded movement wins over a forecast whenever there is one. */
    column: recorded.stage || planned.stage || "CUTTING",
    column_is_recorded: recorded.stage != null,
  };
}

/* The whole board, one column per stage in the order a shoe passes through
   them — never Object.keys order, which put PACKING second on live data. */
export function statusBoard(views, ctx = {}){
  const rows = (views || []).map(v => statusRow(v, ctx));
  const columns = STAGE_SEQUENCE.map(stage => ({
    stage,
    rows: rows.filter(r => r.column === stage),
  }));
  return {
    columns,
    rows,
    counts: {
      total: rows.length,
      recorded: rows.filter(r => r.column_is_recorded).length,
      /* Rows whose last recorded movement is behind where the plan says they
         should be. This is the number the board exists to produce. */
      behind: rows.filter(r => r.behind).length,
      nothing_recorded: rows.filter(r => r.recorded.phase === "nothing_recorded").length,
    },
  };
}
