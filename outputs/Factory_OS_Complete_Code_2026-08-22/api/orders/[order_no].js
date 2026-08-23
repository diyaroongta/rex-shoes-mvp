import { q } from "../_lib/db.js";
import { fail, wrap } from "../_lib/http.js";
import { INPUTS as SEED } from "../../shared/inputs.js";
import { syncPiMaster } from "../_lib/pis.js";

/* Same reason as the create endpoint: edit an order for an article that was
   uploaded through Data & BOM and seed-based validation would reject it. */
async function reference(){
  try{
    const { rows } = await q("select value from reference_data where id = 1");
    if(rows.length && rows[0].value && rows[0].value.articles) return rows[0].value;
  }catch(e){ /* fall through */ }
  return SEED;
}

/* Same guard as create: an unknown combo would consume machine capacity while
   ordering zero material, so it must never reach the table by any route. */
function validatePatch(body, current, INPUTS){
  const out = {};
  if("priority" in body){
    const p = Number(body.priority);
    if(!Number.isInteger(p) || p < 1) return { err:"priority must be an integer >= 1" };
    out.priority = p;
  }
  if("party" in body){
    if(typeof body.party !== "string" || !body.party.trim()) return { err:"party cannot be empty" };
    out.party = body.party.trim().slice(0,120);
  }
  if("order_date" in body){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.order_date))) return { err:"order_date must be YYYY-MM-DD" };
    out.order_date = body.order_date;
  }
  if("article_code" in body){
    if(!INPUTS.articles[body.article_code]) return { err:`unknown article_code: ${body.article_code}` };
    out.article_code = body.article_code;
  }
  if("lines" in body){
    const art = INPUTS.articles[out.article_code || current.article_code];
    if(!Array.isArray(body.lines) || !body.lines.length) return { err:"at least one line is required" };
    for(const l of body.lines){
      if(!art.combos[l.combo]) return { err:`unknown combo "${l.combo}" for ${out.article_code || current.article_code}` };
      if(!(Number(l.qty) > 0)) return { err:`line ${l.combo}: qty must be > 0` };
      if(l.sizes != null){
        if(typeof l.sizes !== "object" || Array.isArray(l.sizes)) return {err:`line ${l.combo}: sizes must be an object`};
        const values=Object.values(l.sizes);
        if(values.some(qty=>!Number.isFinite(Number(qty))||Number(qty)<0))
          return {err:`line ${l.combo}: exact-size quantities must be 0 or more`};
        const exact=values.reduce((sum,qty)=>sum+Number(qty),0);
        if(Math.abs(exact-Number(l.qty))>1e-6)
          return {err:`line ${l.combo}: exact-size quantities total ${exact}, not ${Number(l.qty)}`};
      }
    }
    out.lines = body.lines.map(l => ({ combo:l.combo, qty:Number(l.qty), label:l.label || l.combo,
      ...(l.sizes && typeof l.sizes === "object" ? { sizes:l.sizes } : {}),
      ...(Array.isArray(l.size_order) ? {size_order:l.size_order.map(String)} : {}),
      ...(Number(l.ppc)>0 ? {ppc:Number(l.ppc)} : {}) }));
  }
  // pi is a free-form blob (pi_no, price, remarks, attachment, order_nature...).
  // MERGE rather than replace, so editing just the remarks doesn't wipe pi_no.
  if("pi" in body && body.pi && typeof body.pi === "object")
    out.pi = { ...(current.pi || {}), ...body.pi };
  if(!Object.keys(out).length) return { err:"nothing to update" };
  return { patch: out };
}

export default wrap(async (req, res) => {
  const { order_no } = req.query;
  if(!order_no) return fail(res, 400, "order_no is required");

  if(req.method === "PATCH"){
    const { rows } = await q(
      `select order_no, order_date, article_code, priority, party, lines, pi
         from orders where order_no = $1`, [order_no]);
    if(!rows.length) return fail(res, 404, `no such order: ${order_no}`);

    const { patch, err } = validatePatch(req.body || {}, rows[0], await reference());
    if(err) return fail(res, 400, err);

    // Changing the article invalidates the old lines — require both together.
    if(patch.article_code && patch.article_code !== rows[0].article_code && !patch.lines)
      return fail(res, 400, "changing article_code requires new lines — the old combos may not exist on the new article");

    const cols = Object.keys(patch);
    const set  = cols.map((c,i) => `${c} = $${i+1}`).join(", ");
    const vals = cols.map(c => (c === "lines" || c === "pi") ? JSON.stringify(patch[c]) : patch[c]);
    const { rows: out } = await q(
      `update orders set ${set} where order_no = $${cols.length+1}
       returning order_no, order_date, article_code, priority, party, lines, pi`,
      [...vals, order_no]);
    const r = out[0];
    try{ await syncPiMaster(); }catch(_){}
    return res.status(200).json({
      ...r,
      order_date: r.order_date instanceof Date ? r.order_date.toISOString().slice(0,10) : String(r.order_date),
    });
  }

  if(req.method === "DELETE"){
    try{ await syncPiMaster(); }catch(_){}
    const { rowCount } = await q("delete from orders where order_no = $1", [order_no]);
    if(!rowCount) return fail(res, 404, `no such order: ${order_no}`);
    return res.status(200).json({ deleted: order_no });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
