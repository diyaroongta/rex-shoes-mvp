import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";
import { pairsPerCarton, setReference } from "../shared/bridge.js";

function validDate(value){
  if(value==null||value==="") return true;
  const s=String(value); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d]=s.split("-").map(Number),dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}

/* Packing / dispatch reports. Recording one reduces an order's pending
   quantity; it never edits the order itself, so the original order stays
   auditable against what actually shipped. */
export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q(
      `select id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order
         from dispatches order by dispatched_on desc, id desc`);
    return res.status(200).json(rows.map(r => ({
      ...r,
      dispatched_on: r.dispatched_on instanceof Date
        ? r.dispatched_on.toISOString().slice(0,10) : String(r.dispatched_on),
    })));
  }

  if(req.method === "POST"){
    const { order_no, dispatched, cartons, kind, note, dispatched_on, closes_order } = req.body || {};
    if(!order_no) return fail(res, 400, "order_no is required");
    if(!dispatched || typeof dispatched !== "object")
      return fail(res, 400, "dispatched must be { combo: pairs }");
    if(!validDate(dispatched_on)) return fail(res,400,"dispatched_on must be a real date in YYYY-MM-DD");
    if(kind!=null&&!['partial','full','shortage'].includes(kind)) return fail(res,400,"kind must be partial, full or shortage");
    if(kind==="shortage"&&!closes_order) return fail(res,400,"a shortage report must close the order");

    const { rows: ord } = await q(
      "select order_no, article_code, lines from orders where order_no = $1 and active", [order_no]);
    if(!ord.length) return fail(res, 404, `no such order: ${order_no}`);

    // Never accept a dispatch for a combo the order doesn't contain, and never
    // more than remains outstanding — an over-dispatch would show as negative
    // pending and quietly corrupt the shortage figure.
    const ordered = {};
    for(const l of ord[0].lines) ordered[l.combo] = (ordered[l.combo] || 0) + Number(l.qty);

    const { rows: prev } = await q("select dispatched from dispatches where order_no = $1", [order_no]);
    const already = {};
    for(const p of prev)
      for(const [c,v] of Object.entries(p.dispatched)) already[c] = (already[c] || 0) + Number(v);

    const clean = {};
    for(const [combo, v] of Object.entries(dispatched)){
      const n = Number(v);
      if(!Number.isInteger(n) || n < 0) return fail(res, 400, `${combo}: pairs must be a whole number of 0 or more`);
      if(n === 0) continue;
      if(ordered[combo] == null) return fail(res, 400, `${combo} is not on order ${order_no}`);
      const remaining = ordered[combo] - (already[combo] || 0);
      if(n > remaining)
        return fail(res, 400, `${combo}: only ${remaining} pairs remain outstanding, cannot dispatch ${n}`);
      clean[combo] = n;
    }
    // A closing dispatch may ship nothing at all — writing the whole remaining
    // balance off short is legitimate. Any other dispatch must ship something.
    if(!Object.keys(clean).length && !closes_order) return fail(res, 400, "nothing to dispatch");

    const remainingAfter=Object.keys(ordered).reduce((sum,c)=>sum+ordered[c]-(already[c]||0)-(clean[c]||0),0);
    if(kind==="full"&&remainingAfter>0) return fail(res,400,`full dispatch still leaves ${remainingAfter} pairs outstanding`);
    if(closes_order&&remainingAfter>0&&!String(note||"").trim())
      return fail(res,400,"a reason is required when closing an order with a shortage");
    const k = closes_order ? "shortage" : remainingAfter===0 ? "full" : "partial";

    // Cartons are a derived audit field. Recalculate them from the line's
    // snapshotted ppc first, then the current packing rule; never trust a
    // browser-supplied carton total that can disagree with dispatched pairs.
    const {rows:refRows}=await q("select value from reference_data where id = 1");
    setReference(refRows[0]?.value?.articles?refRows[0].value:INPUTS);
    const cleanCartons={};
    for(const [combo,n] of Object.entries(clean)){
      const linePpc=(ord[0].lines||[]).find(l=>l.combo===combo&&Number(l.ppc)>0)?.ppc;
      const ppc=Number(linePpc)||pairsPerCarton(ord[0].article_code,combo);
      if(ppc) cleanCartons[combo]=n/ppc;
    }
    const { rows } = await q(
      `insert into dispatches (order_no, dispatched, cartons, kind, note, dispatched_on, closes_order)
       values ($1,$2,$3,$4,$5, coalesce($6::date, current_date), $7)
       returning id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order`,
      [order_no, JSON.stringify(clean), JSON.stringify(cleanCartons), k, note || null,
       dispatched_on || null, !!closes_order]);
    return res.status(201).json(rows[0]);
  }

  if(req.method === "DELETE"){
    return fail(res,405,"dispatch reports are audit records and cannot be deleted");
  }

  return fail(res, 405, `${req.method} not allowed`);
});
