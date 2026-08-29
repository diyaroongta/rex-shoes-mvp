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
/* Manual planning override for one order. `{}` hands the order back to the
   automatic planner. */
export const setPlanOverride = (no, ov)    => patchOrder(no, { plan_override:ov||{} });
export const deleteOrder     = no          => j(`/api/orders/${encodeURIComponent(no)}`, { method:"DELETE" });
export const deleteAllOrders = ()          => j("/api/orders?all=1", { method:"DELETE" });
export const listPis         = ()          => j("/api/pis");
/* Omit order_nos to release the whole PI; pass a subset to release only
   those orders and leave the rest of the PI unscheduled. */
export const schedulePi      = (pi_no, order_nos) =>
  post("/api/pis", order_nos ? { pi_no, order_nos } : { pi_no });
export const listArchivedPis = ()          => j("/api/pis?archived=1");
/* Archiving hides a PI and takes its orders off the schedule; restoring puts
   them back. Deleting is permanent and refuses while any order has shipped. */
export const archivePi       = pi_no       => post("/api/pis", { pi_no, action:"archive" });
export const restorePi       = pi_no       => post("/api/pis", { pi_no, action:"restore" });
export const deletePi        = pi_no       => j(`/api/pis?pi_no=${encodeURIComponent(pi_no)}&confirm=1`, { method:"DELETE" });
export const nextPiNumber    = ()          => post("/api/pi-numbers", {});

/* ---- shared config (machine capacities) ---- */
export const getSettings = ()      => j("/api/settings");
export const putSettings = patch   => j("/api/settings", {
  method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch)
});

/* ---- parties and their commercial terms ---- */
export const listParties = ()   => j("/api/parties");
export const saveParty   = p    => j("/api/parties", {
  method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(p) });
export const removeParty = name => j(`/api/parties?name=${encodeURIComponent(name)}`, { method:"DELETE" });
/* Re-price the orders already raised for a party with their current terms.
   `previewPartyTerms` reports what would change; `applyPartyTerms` does it. */
export const previewPartyTerms = name => post("/api/parties", { name, preview:true });
export const applyPartyTerms   = name => post("/api/parties", { name });

/* ---- dispatch / packing reports ---- */
export const listDispatches  = ()      => j("/api/dispatches");
export const addDispatch     = d       => post("/api/dispatches", d);
/* Removing a dispatch puts those pairs back into the order's pending balance,
   so it is a correction of a mis-keyed report, not a way to hide a shipment. */
export const deleteDispatch  = id      => j(`/api/dispatches?id=${id}`, { method:"DELETE" });

/* ---- reference data (articles, BOM rates, materials, packing) ---- */
export const getReference   = ()        => j("/api/reference");
export const uploadBom      = payload   => post("/api/reference", payload);
/* The reference revision log, and the undo that makes it worth keeping. */
export const referenceHistory = ()   => j("/api/reference?history=1");
export const restoreReference = id   => post("/api/reference", { restore_revision:id });
export const patchReference = patch     => j("/api/reference", {
  method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch) });

/* ---- product catalogue ---- */
export const getCatalogue   = ()        => j("/api/catalogue");
export const putCatalogue   = entry     => j("/api/catalogue", {
  method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(entry) });
/* `confirmBom` is the explicit yes to also deleting a finished article's BOM,
   packing and MRP. Orders referencing the article always block the delete. */
export const deleteCatalogue= (code, confirmBom=false) =>
  j(`/api/catalogue?article_code=${encodeURIComponent(code)}${confirmBom?"&confirm_bom=1":""}`, { method:"DELETE" });

/* ---- AI, proxied ---- */
export async function readOrderPhoto(imageBase64){
  const d = await post("/api/read-order-photo", { image_base64: imageBase64 });
  return d.text || "";
}
export async function readPi(fileBase64, mediaType){
  const d = await post("/api/read-pi", { file_base64: fileBase64, media_type: mediaType });
  return d.text || "";
}
export async function askCopilot(question, context){
  const d = await post("/api/copilot", { question, context });
  return d.text || "";
}
