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
  /* One file, or one entry PER PAGE. A PI too heavy to send as a PDF is
     re-rendered page by page in the browser, and every page has to arrive —
     dropping the tail would return an invoice that looked complete and was
     short whole lines. */
  const files = Array.isArray(file_base64) ? file_base64 : [file_base64];
  if(!files.length || !files.every(f => typeof f === "string" && f.length >= 100))
    return fail(res, 400, "file_base64 is required");
  /* Vercel caps a serverless request body at 4.5 MB, and base64 inflates a
     file by a third — so the old 9,000,000 guard let through payloads the
     PLATFORM would reject before this handler ever ran, which surfaced as an
     opaque failure rather than as a message anyone could act on. */
  const total = files.reduce((n,f)=>n+f.length, 0);
  if(total > 4_400_000)
    return fail(res, 413,
      "That PI is too large to upload (the limit is about 3 MB). Export it at a lower "
      + "resolution, or split it and upload one part at a time.");

  const mt = media_type || "application/pdf";
  const ALLOWED = ["application/pdf","image/jpeg","image/png","image/webp"];
  if(!ALLOWED.includes(mt)) return fail(res, 400, `unsupported file type: ${mt}`);
  if(files.length > 1 && mt === "application/pdf")
    return fail(res, 400, "several PDFs cannot be read as one document; send pages as images");

  try{
    const { rows } = await q("select value from reference_data where id = 1");
    if(rows.length) setReference(rows[0].value);
  }catch(e){ /* fall back to the bundled seed */ }

  const blocks = files.map(data => mt === "application/pdf"
    ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data } }
    : { type:"image",    source:{ type:"base64", media_type:mt,               data } });

  const text = await callModel({
    max_tokens: 8000,
    messages: [{ role:"user", content: [ ...blocks, { type:"text", text: readPiPrompt() } ] }],
  });
  return res.status(200).json({ text });
});
