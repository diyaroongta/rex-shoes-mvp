import { callModel } from "./_lib/ai.js";
import { readPrompt, setReference } from "../shared/bridge.js";
import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";

/* The browser sends ONLY an image. The prompt is built here, so a client can
   never inject its own instructions into the model call. */
export default wrap(async (req, res) => {
  if(req.method !== "POST") return fail(res, 405, `${req.method} not allowed`);

  const b64 = req.body && req.body.image_base64;
  if(typeof b64 !== "string" || b64.length < 100) return fail(res, 400, "image_base64 is required");
  // ~7MB of base64 ≈ 5MB image; the client already shrinks on retry.
  if(b64.length > 7_000_000) return fail(res, 413, "image too large — retry at lower resolution");

  // the reader's vocabulary must match whatever articles are actually loaded
  try{
    const { rows } = await q("select value from reference_data where id = 1");
    if(rows.length) setReference(rows[0].value);
  }catch(e){ /* fall back to the bundled seed */ }

  const text = await callModel({
    max_tokens: 3000,
    messages: [{ role:"user", content: [
      { type:"image", source:{ type:"base64", media_type:"image/jpeg", data: b64 } },
      { type:"text", text: readPrompt() },
    ]}],
  });
  return res.status(200).json({ text });
});
