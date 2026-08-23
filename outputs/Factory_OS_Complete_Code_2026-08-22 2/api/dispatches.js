import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { INPUTS } from "../shared/inputs.js";

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

    const { rows: ord } = await q(
      "select order_no, article_code, lines from orders where order_no = $1", [order_no]);
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
      if(!isFinite(n) || n < 0) return fail(res, 400, `${combo}: pairs must be 0 or more`);
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

    const k = closes_order ? "shortage"
            : ["partial","full","shortage"].includes(kind) ? kind : "partial";
    const { rows } = await q(
      `insert into dispatches (order_no, dispatched, cartons, kind, note, dispatched_on, closes_order)
       values ($1,$2,$3,$4,$5, coalesce($6::date, current_date), $7)
       returning id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order`,
      [order_no, JSON.stringify(clean), JSON.stringify(cartons || {}), k, note || null,
       dispatched_on || null, !!closes_order]);
    return res.status(201).json(rows[0]);
  }

  if(req.method === "DELETE"){
    const id = Number(req.query.id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const { rowCount } = await q("delete from dispatches where id = $1", [id]);
    if(!rowCount) return fail(res, 404, "no such dispatch");
    return res.status(200).json({ deleted: id });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
