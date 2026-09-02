import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { buildPackingList } from "../shared/packing-list.js";
import { validateIssue, receive, slipFor } from "../shared/job-work.js";
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
/* Job work shares this endpoint rather than getting its own file: Vercel's
   Hobby plan builds one function per file under api/ and allows 12, and the
   project is at exactly 12. It is a good neighbour — a dispatch and a job work
   issue are the same shape of thing, goods leaving with a quantity that is
   later reconciled against what came back. Both are a planner's daily work,
   so they share the permission too. */
async function jobWork(req, res){
  if(req.method === "GET"){
    const { rows } = await q(
      `select id, fabricator, fabricator_type, article, stage, order_no, qty,
              received, shortage, status, slip, sample, sample_status, rate,
              payable, note, issued_on
         from job_work order by status, issued_on desc, id desc`);
    return res.status(200).json(rows.map(r => ({ ...r,
      qty:Number(r.qty), received:Number(r.received),
      shortage:Number(r.shortage), rate:Number(r.rate) })));
  }

  if(req.method === "POST"){
    const b = req.body || {};
    const { rows:[fab] } = await q(
      `select name, type, rate, payable, active from fabricators where name = $1`,
      [String(b.fabricator || "").trim()]);
    if(!fab) return fail(res, 404, `no such fabricator: ${b.fabricator || "(none)"}`);

    const check = validateIssue(b, { ...fab, rate:Number(fab.rate) });
    if(!check.ok) return fail(res, 400, check.problems.join("; "));
    const v = check.value;

    /* The rate is SNAPSHOTTED onto the job. Renegotiating a fabricator's rate
       next month must not silently rewrite what last month's work cost. */
    const { rows } = await q(
      `insert into job_work (fabricator, fabricator_type, article, stage, order_no,
                             qty, slip, sample, sample_status, rate, payable, note,
                             issued_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::date, current_date))
       returning id, fabricator, fabricator_type, article, stage, order_no, qty,
                 received, shortage, status, slip, sample, sample_status, rate,
                 payable, note, issued_on`,
      [v.fabricator, v.fabricator_type, v.article, v.stage, v.order_no, v.qty,
       v.slip, v.sample, v.sample_status, Number(fab.rate), fab.payable, v.note,
       v.issued_on]);
    return res.status(201).json({ ...rows[0], qty:Number(rows[0].qty),
      received:Number(rows[0].received), rate:Number(rows[0].rate) });
  }

  /* Receiving work back, and recording a sample's verdict. */
  if(req.method === "PATCH"){
    const b = req.body || {};
    const id = Number(b.id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const { rows:[job] } = await q(
      `select id, qty, received, status, sample from job_work where id = $1`, [id]);
    if(!job) return fail(res, 404, `no such job: ${id}`);

    if(b.sample_status != null){
      if(!job.sample) return fail(res, 400, "only sample work carries a sample verdict");
      const st = String(b.sample_status);
      if(!["pending","approved","rejected","revision"].includes(st))
        return fail(res, 400, `unknown sample status: ${st}`);
      const { rows } = await q(
        `update job_work set sample_status=$2, updated_at=now() where id=$1
         returning id, sample_status`, [id, st]);
      return res.status(200).json(rows[0]);
    }

    const out = receive({ qty:Number(job.qty), received:Number(job.received) },
                        b.received, { close: !!b.close });
    if(!out.ok) return fail(res, 400, out.problems.join("; "));
    const { rows } = await q(
      `update job_work set received=$2, shortage=$3, status=$4, updated_at=now()
        where id=$1
       returning id, fabricator, article, qty, received, shortage, status`,
      [id, out.received, out.shortage, out.status]);
    return res.status(200).json({ ...rows[0], qty:Number(rows[0].qty),
      received:Number(rows[0].received), shortage:Number(rows[0].shortage) });
  }

  return fail(res, 405, `${req.method} not allowed`);
}

export default wrap(async (req, res) => {
  if(String((req.query||{}).resource||"") === "job_work"
     || (req.body && req.body.resource === "job_work"))
    return jobWork(req, res);

  if(req.method === "GET"){
    const { rows } = await q(
      `select id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order, packing_list
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
    /* The packing list is the document that travels with the lorry; `clean` is
       what the pending balance is reduced by. Letting them disagree would put
       one number on the customer's gate pass and a different one in the order
       book, so the sheet is checked against the dispatch before either is
       written. */
    let sheet = null;
    if(req.body && req.body.packing_list){
      const built = buildPackingList(req.body.packing_list);
      const dispatchedPairs = Object.values(clean).reduce((a,v)=>a+Number(v||0),0);
      if(built.total_pairs !== dispatchedPairs)
        return fail(res, 400,
          `The packing list adds up to ${built.total_pairs} pairs but this dispatch is ${dispatchedPairs}. `
          + `Correct the sizes or the quantities before saving.`);
      if(!built.ok) return fail(res, 400, built.problems.slice(0,5).join("; "));
      sheet = req.body.packing_list;
    }

    const { rows } = await q(
      `insert into dispatches (order_no, dispatched, cartons, kind, note, dispatched_on, closes_order, packing_list)
       values ($1,$2,$3,$4,$5, coalesce($6::date, current_date), $7, $8)
       returning id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order, packing_list`,
      [order_no, JSON.stringify(clean), JSON.stringify(cleanCartons), k, note || null,
       dispatched_on || null, !!closes_order, sheet ? JSON.stringify(sheet) : null]);
    return res.status(201).json(rows[0]);
  }

  /* Removing a mis-keyed packing report. The record is NOT erased — it moves to
     dispatches_removed, so what was once claimed as shipped stays answerable
     for — but it stops counting, which returns those pairs to the order's
     pending balance. That is the correction the factory actually needs; an
     un-editable wrong number is not an audit trail, it is a wrong number. */
  if(req.method === "DELETE"){
    const id = Number(req.query.id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const client = await db().connect();
    try{
      await client.query("begin");
      await client.query(`create table if not exists dispatches_removed (
        id integer primary key, order_no text not null, dispatched jsonb not null,
        cartons jsonb, kind text, note text, dispatched_on date,
        closes_order boolean not null default false,
        removed_at timestamptz not null default now())`);
      const { rows } = await client.query(
        `select id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order
           from dispatches where id = $1 for update`, [id]);
      if(!rows.length){ await client.query("rollback"); return fail(res, 404, "no such dispatch"); }
      const d = rows[0];
      await client.query(
        `insert into dispatches_removed (id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
        [d.id, d.order_no, JSON.stringify(d.dispatched), JSON.stringify(d.cartons || {}),
         d.kind, d.note, d.dispatched_on, d.closes_order]);
      await client.query("delete from dispatches where id = $1", [id]);
      await client.query("commit");
      const pairs = Object.values(d.dispatched || {}).reduce((a,b)=>a+(Number(b)||0), 0);
      return res.status(200).json({ removed:id, order_no:d.order_no, pairs_returned:pairs });
    }catch(e){ try{ await client.query("rollback"); }catch(_){ } throw e; }
    finally{ client.release(); }
  }

  return fail(res, 405, `${req.method} not allowed`);
});
