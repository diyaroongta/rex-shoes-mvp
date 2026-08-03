import { callModel } from "./_lib/ai.js";
import { fail, wrap } from "./_lib/http.js";
import { setReference } from "../shared/bridge.js";
import { readPiPrompt } from "../shared/pi-read.js";
import { q } from "./_lib/db.js";

/* Reads an existing Proforma Invoice — PDF or photo — into structured order
   lines. The prompt is built server-side from live reference data, so the
   browser never supplies instructions to the model. */
export default wrap(async (req, res) => {
  if(req.method !== "POST") return fail(res, 405, `${req.method} not allowed`);

  const { file_base64, media_type } = req.body || {};
  if(typeof file_base64 !== "string" || file_base64.length < 100)
    return fail(res, 400, "file_base64 is required");
  if(file_base64.length > 9_000_000)
    return fail(res, 413, "file too large — split the PI or lower the scan resolution");

  const mt = media_type || "application/pdf";
  const ALLOWED = ["application/pdf","image/jpeg","image/png","image/webp"];
  if(!ALLOWED.includes(mt)) return fail(res, 400, `unsupported file type: ${mt}`);

  try{
    const { rows } = await q("select value from reference_data where id = 1");
    if(rows.length) setReference(rows[0].value);
  }catch(e){ /* fall back to the bundled seed */ }

  const block = mt === "application/pdf"
    ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data:file_base64 } }
    : { type:"image",    source:{ type:"base64", media_type:mt,               data:file_base64 } };

  const text = await callModel({
    max_tokens: 8000,
    messages: [{ role:"user", content: [ block, { type:"text", text: readPiPrompt() } ] }],
  });
  return res.status(200).json({ text });
});
