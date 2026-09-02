/* Job work: sending work out and getting it back.
 *
 * Straight from the client's Job Work Module note, and the whole point of the
 * design is that ONE flow covers both an internal stitching line and an
 * outside fabricator. They differ in three ways and no more:
 *
 *   the slip     an external gets a "Job Work Challan", a line gets an
 *                "Internal Issue Slip" — same movement, different document
 *   the money    external work is rate x quantity; a line skips that step
 *                entirely, because no money changes hands
 *   the mixing   sample work is kept apart from bulk so small runs of 1-10
 *                pieces never land in the middle of a production batch
 *
 * Everything else — issue, receive, shortage — is identical, which is why it
 * is one module and one screen rather than two of each.
 *
 * Pure: no database, no clock. `now` is injected where a date is needed.
 */
import { RULES, payableFor, jobCost } from "./fabricators.js";

export const SLIP = {
  internal_line: "Internal Issue Slip",
  external:      "Job Work Challan",
  sample:        "Job Work Challan",
};

/* Sample work carries its own verdict alongside the job record. */
export const SAMPLE_STATUS = ["pending", "approved", "rejected", "revision"];
export const SAMPLE_LABEL = {
  pending:  "Awaiting decision",
  approved: "Approved",
  rejected: "Rejected",
  revision: "Revision needed",
};

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

export const slipFor = fabricator => SLIP[(fabricator || {}).type] || "Job Work Challan";

/* An issue, checked before anything leaves the store. */
export function validateIssue(input = {}, fabricator = null){
  const problems = [];
  const article = clean(input.article);
  const qty = Math.round(num(input.qty));

  if(!fabricator) problems.push("Choose who the work is going to");
  else if(!fabricator.active) problems.push(`${fabricator.name} is not active and cannot take new work`);
  if(!article) problems.push("Choose the article or style being sent");
  if(qty <= 0) problems.push("Enter how many to issue");

  /* Sample work is small by definition. A four-figure quantity against a
     sample maker is a bulk order sent to the wrong place, and it is worth
     stopping before the pieces physically leave. */
  if(fabricator && fabricator.type === "sample" && qty > 10)
    problems.push(`${qty} is a bulk quantity for a sample fabricator — samples run 1-10 pieces. Send bulk to a line or an external fabricator.`);
  if(fabricator && fabricator.type !== "sample" && input.sample)
    problems.push("Only a sample fabricator takes sample work — that is what keeps samples out of bulk job work");

  return {
    ok: problems.length === 0,
    problems,
    value: {
      fabricator: fabricator ? fabricator.name : "",
      fabricator_type: fabricator ? fabricator.type : "",
      article, qty,
      stage: clean(input.stage) || "STITCHING",
      order_no: clean(input.order_no) || null,
      note: clean(input.note).slice(0, 300) || null,
      issued_on: input.issued_on || null,
      slip: fabricator ? slipFor(fabricator) : null,
      sample: !!(fabricator && fabricator.type === "sample"),
      sample_status: fabricator && fabricator.type === "sample" ? "pending" : null,
    },
  };
}

/* Receiving work back. Partial returns are normal, so this is cumulative and
   the shortage is only meaningful once the job is closed — an open job with
   40 of 100 back is not 60 short, it is 60 still out. */
export function receive(job, receivedNow, opts = {}){
  const issued = Math.round(num(job && job.qty));
  const already = Math.round(num(job && job.received));
  const add = Math.round(num(receivedNow));
  const problems = [];

  if(add <= 0) problems.push("Enter how many came back");
  if(already + add > issued)
    problems.push(`That is more than was issued — ${issued} went out and ${already} is already back`);

  const received = already + add;
  const outstanding = Math.max(0, issued - received);
  const closing = !!opts.close;

  return {
    ok: problems.length === 0,
    problems,
    received,
    outstanding,
    /* Closed short: the balance is accepted as never coming back. Until then
       it is still out with the fabricator, not lost. */
    shortage: closing ? outstanding : 0,
    status: closing ? "closed" : (outstanding === 0 ? "closed" : "partial"),
  };
}

/* What is physically with each fabricator right now — the "with fabricator /
   line" bucket the note asks for. Issued minus what has come back, per
   fabricator, ignoring closed jobs whose balance was written off. */
export function withFabricators(jobs){
  const out = {};
  for(const j of jobs || []){
    const name = clean(j.fabricator);
    if(!name) continue;
    const issued = Math.round(num(j.qty));
    const received = Math.round(num(j.received));
    const open = j.status !== "closed";
    const bucket = out[name] || (out[name] = {
      fabricator: name, type: j.fabricator_type || "", issued: 0, received: 0, with_them: 0,
      open_jobs: 0, shortage: 0,
    });
    bucket.issued += issued;
    bucket.received += received;
    bucket.shortage += Math.round(num(j.shortage));
    if(open){ bucket.open_jobs += 1; bucket.with_them += Math.max(0, issued - received); }
  }
  return Object.values(out).sort((a, z) => z.with_them - a.with_them || a.fabricator.localeCompare(z.fabricator));
}

/* What a finished job is worth. Internal lines answer zero and say so, rather
   than being skipped by the caller and quietly forgotten in the payables. */
export function amountFor(job, fabricator){
  const f = fabricator || { type: job && job.fabricator_type, rate: job && job.rate, payable: job && job.payable };
  if(!payableFor(f.type, f.payable)) return { payable:false, amount:0, basis:"internal line — no payment" };
  /* Paid on what came BACK, not on what went out: a shortage is not work done.
     Falls back to the issued quantity while the job is still open, so the
     figure on an open challan is what it will cost if it all returns. */
  const pieces = (job && job.received > 0) ? job.received : (job && job.qty) || 0;
  const cost = jobCost(f, pieces);
  return { ...cost, basis: (RULES[f.type] || {}).rate === "flat" ? "flat sample charge" : "rate x pieces received" };
}

/* One line of the register, resolved for display. */
export function summarise(job, fabricator){
  const issued = Math.round(num(job.qty));
  const received = Math.round(num(job.received));
  const money = amountFor(job, fabricator);
  return {
    ...job,
    issued, received,
    outstanding: Math.max(0, issued - received),
    slip: job.slip || (fabricator ? slipFor(fabricator) : null),
    amount: money.amount,
    payable: money.payable,
    amount_basis: money.basis,
  };
}
