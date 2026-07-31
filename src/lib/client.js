/* Thin wrapper over our own API. The browser never talks to an AI provider
   directly and never holds a key — every call below hits our server. */

async function j(url, opts){
  const r = await fetch(url, opts);
  if(!r.ok){
    let detail = "";
    try { const b = await r.json(); detail = b.error || JSON.stringify(b).slice(0,200); }
    catch(_){ try { detail = (await r.text()).slice(0,200); } catch(__){} }
    throw new Error(`${r.status}${detail ? " — " + detail : ""}`);
  }
  return r.json();
}
const post = (url, body) => j(url, {
  method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
});

/* ---- order sheet ---- */
export const listOrders      = ()          => j("/api/orders");
export const createOrders    = drafts      => post("/api/orders", { orders: drafts });
export const patchOrder      = (no, patch) => j(`/api/orders/${encodeURIComponent(no)}`,
                                                { method:"PATCH", headers:{"Content-Type":"application/json"},
                                                  body:JSON.stringify(patch) });
export const setPriority     = (no, p)     => patchOrder(no, { priority:p });
export const deleteOrder     = no          => j(`/api/orders/${encodeURIComponent(no)}`, { method:"DELETE" });
export const deleteAllOrders = ()          => j("/api/orders?all=1", { method:"DELETE" });

/* ---- shared config (machine capacities) ---- */
export const getSettings = ()      => j("/api/settings");
export const putSettings = patch   => j("/api/settings", {
  method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch)
});

/* ---- reference data (articles, BOM rates, materials, packing) ---- */
export const getReference   = ()        => j("/api/reference");
export const uploadBom      = payload   => post("/api/reference", payload);
export const patchReference = patch     => j("/api/reference", {
  method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch) });

/* ---- product catalogue ---- */
export const getCatalogue   = ()        => j("/api/catalogue");
export const putCatalogue   = entry     => j("/api/catalogue", {
  method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(entry) });
export const deleteCatalogue= code      => j(`/api/catalogue?article_code=${encodeURIComponent(code)}`, { method:"DELETE" });

/* ---- AI, proxied ---- */
export async function readOrderPhoto(imageBase64){
  const d = await post("/api/read-order-photo", { image_base64: imageBase64 });
  return d.text || "";
}
export async function askCopilot(question, context){
  const d = await post("/api/copilot", { question, context });
  return d.text || "";
}
