/* The ONLY place the Anthropic key is read. Never import this from /src. */
const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

export async function callModel({ messages, max_tokens }){
  const key = process.env.ANTHROPIC_API_KEY;
  if(!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await fetch(API, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key": key,
      "anthropic-version":"2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens, messages }),
  });
  if(!r.ok){
    const detail = await r.text().catch(()=>"" );
    throw new Error(`provider ${r.status}: ${detail.slice(0,300)}`);
  }
  const d = await r.json();
  const text = Array.isArray(d.content)
    ? d.content.filter(b=>b.type==="text").map(b=>b.text).join("\n")
    : "";
  return text;
}

/* --- swapping providers ---------------------------------------------------
   Everything provider-specific is above this line. To move to a different
   vendor, or to an OCR service plus a parser, reimplement callModel so it
   still returns a plain string. Nothing else in the app changes.
   ------------------------------------------------------------------------ */
