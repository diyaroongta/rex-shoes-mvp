import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { buildPackingList } from "../shared/packing-list.js";
import { validateIssue, receive, slipFor } from "../shared/job-work.js";
import { jobOrderBalance } from "../shared/job-orders.js";
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
              payable, note, issued_on, card
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

    /* A job card is allocated from the Order Book, never straight from the PI.
       Refuse a stale browser that tries to allocate more than is still free. */
    if(v.order_no){
      const {rows:[order]}=await q(
        `select order_no, article_code, lines from orders where order_no=$1 and active`,[v.order_no]);
      if(!order) return fail(res,404,`no such active Order Book row: ${v.order_no}`);
      if(String(order.article_code)!==v.article)
        return fail(res,400,`${v.order_no} is for ${order.article_code}, not ${v.article}`);
      const {rows:prior}=await q(
        `select order_no, qty, card from job_work where order_no=$1`,[v.order_no]);
      const balance=jobOrderBalance(order,prior);
      if(v.qty>balance.remaining)
        return fail(res,409,`${v.order_no} has only ${balance.remaining} pairs left for job cards`);

      const cardLines=Array.isArray(b.card?.lines)?b.card.lines:[];
      if(!cardLines.length) return fail(res,400,"Issue Order Book work through a size-wise Job Card");
      const named=new Set();
      let cardTotal=0;
      for(const line of cardLines){
        const combo=String(line?.combo||"");
        const available=balance.lines.find(row=>row.combo===combo);
        const amount=Math.max(0,Math.round(Number(line?.qty)||0));
        if(!available) return fail(res,400,`${combo||"(blank)"} is not on ${v.order_no}`);
        if(named.has(combo)) return fail(res,400,`${combo} appears twice on the Job Card`);
        named.add(combo); cardTotal+=amount;
        if(amount>available.remaining)
          return fail(res,409,`${v.order_no} ${combo} has only ${available.remaining} pairs left for job cards`);
        if(line.sizes&&typeof line.sizes==="object"){
          const sizeTotal=Object.values(line.sizes).reduce((a,n)=>a+Math.max(0,Math.round(Number(n)||0)),0);
          if(sizeTotal!==amount) return fail(res,400,`${combo} size quantities total ${sizeTotal}, not ${amount}`);
          for(const [size,n] of Object.entries(line.sizes)){
            if(available.remaining_sizes&&Math.max(0,Math.round(Number(n)||0))>Number(available.remaining_sizes[size]||0))
              return fail(res,409,`${v.order_no} ${combo} size ${size} exceeds its Order Book balance`);
          }
        }
      }
      if(cardTotal!==v.qty) return fail(res,400,`Job Card lines total ${cardTotal}, not ${v.qty}`);
    }

    /* The rate is SNAPSHOTTED onto the job. Renegotiating a fabricator's rate
       next month must not silently rewrite what last month's work cost. */
    const { rows } = await q(
      `insert into job_work (fabricator, fabricator_type, article, stage, order_no,
                             qty, slip, sample, sample_status, rate, payable, note,
                             issued_on, card)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::date, current_date),$14)
       returning id, fabricator, fabricator_type, article, stage, order_no, qty,
                 received, shortage, status, slip, sample, sample_status, rate,
                 payable, note, issued_on, card`,
      [v.fabricator, v.fabricator_type, v.article, v.stage, v.order_no, v.qty,
       v.slip, v.sample, v.sample_status, Number(fab.rate), fab.payable, v.note,
       v.issued_on, b.card ? JSON.stringify(b.card) : null]);
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
      `select id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order,
              packing_list, hidden
         from dispatches
        where $1::boolean or not hidden
        order by dispatched_on desc, id desc`,
      [String((req.query||{}).include_hidden||"") === "1"]);
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

    /* Hidden rows are INCLUDED here on purpose: hiding takes a report off the
       history list, it does not un-ship the pairs. */
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

    /* TWO DIFFERENT THINGS, and conflating them loses pairs or invents them.
         hide  — "I do not want to see this in the history any more." The goods
                 shipped; the row keeps counting against the order.
         undo  — "this report was mis-keyed." The pairs go back to pending and
                 the record moves to dispatches_removed.
       `mode=hide` is the new, safe one; undo stays the default so nothing that
       already calls this changes behaviour without being asked to. */
    if(String((req.query||{}).mode||"") === "hide"){
      const { rowCount } = await q(
        "update dispatches set hidden = true where id = $1 and not hidden", [id]);
      if(!rowCount) return fail(res, 404, "That report is not in the history — it may already be hidden or undone.");
      return res.status(200).json({ id, hidden:true,
        note:"Hidden from the history. The pairs still count as dispatched." });
    }
    if(String((req.query||{}).mode||"") === "unhide"){
      const { rowCount } = await q(
        "update dispatches set hidden = false where id = $1", [id]);
      if(!rowCount) return fail(res, 404, "no such dispatch");
      return res.status(200).json({ id, hidden:false });
    }

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
      if(!rows.length){
        await client.query("rollback");
        /* Almost always a stale screen: the report was already undone in
           another tab, or Undo was pressed twice. Saying so beats "404". */
        return fail(res, 404, "That packing report is no longer there — it may already have been undone. Reload the dispatch list.");
      }
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
