import { callModel } from "./_lib/ai.js";
import { fail, wrap } from "./_lib/http.js";

/* The copilot narrates state the ENGINE already computed. It is deliberately
   given no ability to calculate: if it starts producing dates or quantities of
   its own, the app stops being reproducible. Everything it needs to give a
   SPECIFIC answer — which stage is late on which order, by how many days,
   what's queued behind what — is already in the context; the job here is to
   make it use that detail instead of restating the headline. */
const PROMPT = (ctx, question) =>
`You are the production-planning copilot for an Indian shoe factory, embedded in their
scheduling app. You answer from the JSON state below — nothing else. Never invent an order,
a date, a quantity, or a material that isn't in it.

How to answer well:
- Name the actual order numbers, articles and dates involved. "JO2001 (Silky Belly, priority 1)
  is at risk — cutting finished 3 days late" beats "some orders are at risk."
- Every order that isn't on_track has "worst_stage", the specific stage causing it and its
  slip_days versus the target in sla_targets. Use it — that's the reason, not just the label.
- For bottleneck questions, use "machines": avg_util_pct near 100 across many busy_days is a
  real constraint; a single busy day is not. Note when a machine is "exclusive" (one order at
  a time) versus shared, since that changes what "at capacity" implies.
- For procurement questions, "shortfall" is what to buy now; "required" minus "stock" not
  matching a shortfall of zero usually means stock already covers it.
- If "schedule_problems" or an order's "unknown_combos" is non-empty, that's a data problem,
  not a scheduling one — say so plainly rather than working around it silently.
- If the question needs something not in the state (a reason no order references, a material
  not listed), say what's missing rather than guessing or padding the answer.
- Keep it tight: a few sentences for a simple question, a short list for a comparison. Don't
  restate the whole state back at the user.

STATE (today is "today"; all dates are already computed, do not recompute them):
${JSON.stringify(ctx, null, 1)}

QUESTION: ${question}`;

export default wrap(async (req, res) => {
  if(req.method !== "POST") return fail(res, 405, `${req.method} not allowed`);
  const { question, context } = req.body || {};
  if(!question || typeof question !== "string") return fail(res, 400, "question is required");
  if(question.length > 2000) return fail(res, 400, "question too long");

  const text = await callModel({
    max_tokens: 1200,
    messages: [{ role:"user", content: PROMPT(context || {}, question) }],
  });
  return res.status(200).json({ text });
});
