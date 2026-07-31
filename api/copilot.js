import { callModel } from "./_lib/ai.js";
import { fail, wrap } from "./_lib/http.js";

/* The copilot narrates state the ENGINE already computed. It is deliberately
   given no ability to calculate: if it starts producing dates or quantities of
   its own, the app stops being reproducible. */
const PROMPT = (ctx, question) =>
`You are the production-planning copilot for an Indian shoe factory. Answer using ONLY this live computed state. Be concrete, name orders and dates, a few sentences. Never invent numbers.

STATE:
${JSON.stringify(ctx, null, 1)}

QUESTION: ${question}`;

export default wrap(async (req, res) => {
  if(req.method !== "POST") return fail(res, 405, `${req.method} not allowed`);
  const { question, context } = req.body || {};
  if(!question || typeof question !== "string") return fail(res, 400, "question is required");
  if(question.length > 2000) return fail(res, 400, "question too long");

  const text = await callModel({
    max_tokens: 700,
    messages: [{ role:"user", content: PROMPT(context || {}, question) }],
  });
  return res.status(200).json({ text });
});
