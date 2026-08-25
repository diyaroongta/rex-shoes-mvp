import { q, db } from "../_lib/db.js";
import { fail, wrap } from "../_lib/http.js";
import { INPUTS as SEED } from "../../shared/inputs.js";
import { ensurePiTable, syncPiMaster } from "../_lib/pis.js";
import { comboSizesForArticle, setReference } from "../../shared/bridge.js";

/* Same reason as the create endpoint: edit an order for an article that was
   uploaded through Data & BOM and seed-based validation would reject it. */
async function reference(){
  const { rows } = await q("select value from reference_data where id = 1");
  const ref=rows.length && rows[0].value && rows[0].value.articles?rows[0].value:SEED;
  setReference(ref); return ref;
}

function validDate(value){
  const s=String(value||""); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d]=s.split("-").map(Number),dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}

/* Same guard as create: an unknown combo would consume machine capacity while
   ordering zero material, so it must never reach the table by any route. */
function validatePatch(body, current, INPUTS){
  const out = {};
  if("priority" in body){
    const p = Number(body.priority);
    if(!Number.isInteger(p) || p < 1 || p > 3) return { err:"priority must be 1, 2 or 3" };
    out.priority = p;
  }
  if("party" in body){
    if(typeof body.party !== "string" || !body.party.trim()) return { err:"party cannot be empty" };
    out.party = body.party.trim().slice(0,120);
  }
  if("order_date" in body){
    if(!validDate(body.order_date)) return { err:"order_date must be a real date in YYYY-MM-DD" };
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
      if(!Number.isInteger(Number(l.qty)) || Number(l.qty)<=0) return { err:`line ${l.combo}: qty must be a whole number above 0` };
      if(l.sizes != null){
        if(typeof l.sizes !== "object" || Array.isArray(l.sizes)) return {err:`line ${l.combo}: sizes must be an object`};
        const values=Object.values(l.sizes);
        const allowed=new Set(comboSizesForArticle(out.article_code||current.article_code,l.combo,l.vl||body.pi?.vl||current.pi?.vl));
        for(const [size,qty] of Object.entries(l.sizes)){
          if(!allowed.has(String(size))) return {err:`line ${l.combo}: size ${size} is not inside that range (${[...allowed].join(", ")})`};
          if(!Number.isInteger(Number(qty))||Number(qty)<0) return {err:`line ${l.combo} size ${size}: quantity must be a whole number of 0 or more`};
        }
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
      `select order_no, order_date, article_code, priority, party, lines, pi, version
         from orders where order_no = $1 and active`, [order_no]);
    if(!rows.length) return fail(res, 404, `no such order: ${order_no}`);

    const { patch, err } = validatePatch(req.body || {}, rows[0], await reference());
    if(err) return fail(res, 400, err);

    // Changing the article invalidates the old lines — require both together.
    if(patch.article_code && patch.article_code !== rows[0].article_code && !patch.lines)
      return fail(res, 400, "changing article_code requires new lines — the old combos may not exist on the new article");

    const expected=req.body?.expected_version==null?rows[0].version:Number(req.body.expected_version);
    const client=await db().connect();
    try{
      await client.query("begin");
      const livePatch={...patch};
      const piNo=String(rows[0].pi?.pi_no||"").trim();
      if(piNo){
        await ensurePiTable(client);
        const {rows:master}=await client.query("select revision from proforma_invoices where pi_no=$1 for update",[piNo]);
        const next=Math.max(Number(rows[0].pi?.revision)||0,Number(master[0]?.revision)||0)+1;
        livePatch.pi={...(livePatch.pi||rows[0].pi),revision:next,
          revised_at:new Date().toISOString(),production_status:livePatch.pi?.production_status||"edited"};
      }
      const cols = Object.keys(livePatch);
      const set  = [...cols.map((c,i) => `${c} = $${i+1}`),"version = version + 1","updated_at = now()"].join(", ");
      const vals = cols.map(c => (c === "lines" || c === "pi") ? JSON.stringify(livePatch[c]) : livePatch[c]);
      const { rows: out } = await client.query(
        `update orders set ${set} where order_no = $${cols.length+1} and version = $${cols.length+2}
         returning order_no, order_date, article_code, priority, party, lines, pi, version`,
        [...vals, order_no, expected]);
      if(!out.length){await client.query("rollback");return fail(res,409,"This order changed in another session. Reload it before saving your edits.");}
      await syncPiMaster(client); await client.query("commit");
      const r=out[0];
      return res.status(200).json({...r,
        order_date:r.order_date instanceof Date?r.order_date.toISOString().slice(0,10):String(r.order_date)});
    }catch(e){await client.query("rollback");throw e;}finally{client.release();}
  }

  if(req.method === "DELETE"){
    const { rowCount } = await q("update orders set active=false, version=version+1, updated_at=now() where order_no = $1 and active", [order_no]);
    if(!rowCount) return fail(res, 404, `no such order: ${order_no}`);
    return res.status(200).json({ archived: order_no });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
