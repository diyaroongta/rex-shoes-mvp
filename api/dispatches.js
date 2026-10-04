import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { buildPackingList, checkAgainstOrder } from "../shared/packing-list.js";
import { validateIssue, receive, slipFor } from "../shared/job-work.js";
import { jobOrderBalance } from "../shared/job-orders.js";
import { INPUTS } from "../shared/inputs.js";
import { setReference } from "../shared/bridge.js";
import { validateMovement, repairLedger, heldByCombo } from "../shared/repair.js";
import { cleanGatePassFields } from "../shared/gate-pass.js";
import { validateMoves } from "../shared/finished-stock.js";
import { validateJobCardFields } from "../shared/production-actuals.js";

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
              payable, note, issued_on, card, archived
         from job_work
        where ($1::boolean is true or archived = false)
        order by status, issued_on desc, id desc`,
      [String((req.query||{}).archived||"") === "1"]);
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
        `select order_no, qty, shortage, status, card from job_work where order_no=$1`,[v.order_no]);
      const balance=jobOrderBalance(order,prior);

      /* A REMAKE IS ASKED FOR, NEVER ASSUMED.
         Pairs written off as a job-work shortage went out and never came back;
         the customer is still owed them, but `issued` already counts them, so
         the order reads as fully issued. Rather than quietly adding them back
         to the balance — which would make a hundred lost pairs disappear into
         an arithmetic — the operator says "remake these" and the cap lifts by
         exactly that much, for that request only. */
      const remake = b.remake === true || b.remake === "true";
      const cap = remake ? balance.remake_allowance : balance.remaining;
      if(remake && balance.to_remake <= 0)
        return fail(res,409,`${v.order_no} has no pairs written off short, so there is nothing to remake`);
      if(v.qty>cap)
        return fail(res,409, remake
          ? `${v.order_no} has ${balance.remaining} pairs left plus ${balance.to_remake} to remake — `
            + `${cap} in all, and ${v.qty} was asked for`
          : balance.to_remake > 0
            ? `${v.order_no} has only ${balance.remaining} pairs left for job cards. `
              + `${balance.to_remake} pair(s) were written off short and can be re-issued as a REMAKE.`
            : `${v.order_no} has only ${balance.remaining} pairs left for job cards`);

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
        /* On a remake the lost pairs are not attributable to a size range —
           a shortage is recorded per JOB — so any range may carry them, and
           the TOTAL cap above is what actually bounds the card. */
        const comboCap = available.remaining + (remake ? balance.to_remake : 0);
        if(amount>comboCap)
          return fail(res,409,`${v.order_no} ${combo} has only ${comboCap} pairs left for job cards`);
        if(line.sizes&&typeof line.sizes==="object"){
          const sizeTotal=Object.values(line.sizes).reduce((a,n)=>a+Math.max(0,Math.round(Number(n)||0)),0);
          if(sizeTotal!==amount) return fail(res,400,`${combo} size quantities total ${sizeTotal}, not ${amount}`);
          for(const [size,n] of Object.entries(line.sizes)){
            /* On a remake every size's remaining is zero — the order IS fully
               issued — and a shortage was never recorded per size, so the
               per-size cap lifts by the remake pool and the TOTAL is what
               bounds the card. Without this every size would be refused and
               the remake could not be raised at all. */
            const sizeCap = Number((available.remaining_sizes||{})[size]||0) + (remake ? balance.to_remake : 0);
            if(available.remaining_sizes&&Math.max(0,Math.round(Number(n)||0))>sizeCap)
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

  /* TWO DIFFERENT INTENTIONS, TWO DIFFERENT ACTIONS — the same split the
     dispatch book already makes, for the same reason.

       archive   the work was done; take the finished job off the working list.
                 Every balance goes on counting it, so the Order Book does not
                 suddenly believe those pairs were never issued.
       delete    this challan should never have existed. The row goes, and the
                 pairs return to the Order Book as un-issued — which is right
                 for a mis-key and catastrophic for real work, so it is refused
                 on anything that has been received against. */
  if(req.method === "DELETE"){
    const id = Number((req.query||{}).id ?? (req.body||{}).id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const mode = String((req.query||{}).mode ?? (req.body||{}).mode ?? "archive");
    const { rows:[job] } = await q(
      `select id, status, received, qty, order_no, archived from job_work where id = $1`, [id]);
    if(!job) return fail(res, 404,
      `no such job order: ${id}. It may already have been removed — reload the list.`);

    if(mode === "archive"){
      if(job.status !== "closed") return fail(res, 400,
        `job ${id} is still ${job.status}. Only a closed job order can be archived — `
        + `receive what came back, or close it short, first.`);
      const { rows } = await q(
        `update job_work set archived = true, updated_at = now() where id = $1
         returning id, order_no, status`, [id]);
      return res.status(200).json({ ...rows[0], archived:true,
        note:"Archived. Every balance still counts these pairs as issued." });
    }

    if(mode === "delete"){
      if(Number(job.received) > 0) return fail(res, 400,
        `job ${id} has ${job.received} pairs received against it, so it is a real job and not `
        + `a mis-key. Deleting it would hand those pairs back to the Order Book as never issued. `
        + `Archive it instead.`);
      await q(`delete from job_work where id = $1`, [id]);
      return res.status(200).json({ id, deleted:true, order_no:job.order_no,
        note:`Deleted. ${job.qty} pairs return to ${job.order_no || "the Order Book"} as un-issued.` });
    }

    return fail(res, 400, `unknown mode: ${mode} — use archive or delete`);
  }

  return fail(res, 405, `${req.method} not allowed`);
}

/* Repair lives here rather than in api/repairs.js because Vercel's Hobby plan
   builds one function per file under api/ and allows TWELVE — the project is at
   exactly twelve, and a thirteenth is rejected at DEPLOY time even though the
   build and every test pass. Job work already rides here for the same reason,
   and repair is genuinely dispatch-adjacent: it is the last thing that happens
   to a shoe before it goes on the lorry. */
async function repairs(req, res){
  if(req.method === "GET"){
    const { rows } = await q(
      `select id, order_no, size, kind, qty, moved_on, note, created_at
         from repairs order by id desc`);
    return res.status(200).json(rows);
  }

  if(req.method === "POST"){
    const body = req.body || {};
    /* Every movement is checked against what this order can actually support,
       using the SAME pure function the screen uses — so the browser cannot be
       shown one answer and the database given another. */
    const { rows: prior } = await q(
      `select size, kind, qty from repairs where order_no = $1`, [String(body.order_no||"")]);
    const already = { sent:0, returned:0, rejected:0 };
    for(const r of prior)
      if(String(r.size) === String(body.size) && already[r.kind] != null)
        already[r.kind] += Number(r.qty) || 0;

    const checked = validateMovement(body, { already, available: body.available });
    if(!checked.ok) return fail(res, 400, checked.problems.join("; "));
    const v = checked.value;

    const { rows: ord } = await q(
      `select order_no from orders where order_no = $1 and active`, [v.order_no]);
    if(!ord.length) return fail(res, 404, `no live order ${v.order_no}`);

    const { rows } = await q(
      `insert into repairs (order_no, size, kind, qty, moved_on, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, order_no, size, kind, qty, moved_on, note, created_at`,
      [v.order_no, v.size, v.kind, v.qty, v.on, v.note, (req.user||{}).username || null]);
    return res.status(201).json(rows[0]);
  }

  /* A movement is a RECORD OF WHAT HAPPENED, so a wrong one is deleted rather
     than edited — an edited quantity would leave no trace that it changed. */
  if(req.method === "DELETE"){
    const id = Number((req.query||{}).id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const { rowCount } = await q("delete from repairs where id = $1", [id]);
    if(!rowCount) return fail(res, 404, "that repair movement is no longer there — reload the screen");
    return res.status(200).json({ id, deleted:true });
  }

  return fail(res, 405, `${req.method} not allowed`);
}

/* Shop-floor production input.  This deliberately records only the one fact
   the plan cannot know: pairs achieved. Article, customer, sizes, stage and
   planned quantity all come from the live schedule and are snapshotted here
   so an uploaded weekly sheet remains auditable after the plan moves. */
async function productionActuals(req, res){
  if(req.method === "GET"){
    const { rows }=await q(
      `select id, production_on, work_center, stage, order_no, unit_key, job_card_no, article, party,
              size_ranges, planned_pairs, actual_pairs, note, created_by, updated_at,
              rejected_pairs, repair_pairs, cartons, operators, supervisor, shift
         from production_actuals order by production_on desc, work_center, order_no`);
    return res.status(200).json(rows.map(row=>({...row,
      rejected_pairs:Number(row.rejected_pairs||0),repair_pairs:Number(row.repair_pairs||0),
      cartons:row.cartons==null?null:Number(row.cartons),operators:row.operators==null?null:Number(row.operators),
      production_on:row.production_on instanceof Date
        ?row.production_on.toISOString().slice(0,10):String(row.production_on).slice(0,10),
      planned_pairs:Number(row.planned_pairs),actual_pairs:Number(row.actual_pairs)})));
  }

  if(req.method === "POST"){
    const input=Array.isArray(req.body&&req.body.rows)?req.body.rows:[];
    if(!input.length) return fail(res,400,"rows is required");
    if(input.length>1000) return fail(res,400,"Upload at most 1,000 production rows at a time");
    const clean=[];
    for(const [i,row] of input.entries()){
      const line=i+1,production_on=String(row.production_on||"").slice(0,10);
      const work_center=String(row.work_center||"").trim();
      const stage=String(row.stage||"").trim();
      const order_no=String(row.order_no||"").trim();
      const unit_key=String(row.unit_key||order_no).trim();
      const actual_pairs=Number(row.actual_pairs),planned_pairs=Number(row.planned_pairs);
      if(!validDate(production_on)||!production_on) return fail(res,400,`Row ${line}: production date is invalid`);
      if(!work_center||!stage||!order_no) return fail(res,400,`Row ${line}: work centre, stage and order number are required`);
      if(!Number.isInteger(actual_pairs)||actual_pairs<0) return fail(res,400,`Row ${line}: achieved pairs must be a whole number`);
      if(!Number.isInteger(planned_pairs)||planned_pairs<0) return fail(res,400,`Row ${line}: planned pairs must be a whole number`);
      if(!unit_key) return fail(res,400,`Row ${line}: plan row ID is required`);
      const extra=validateJobCardFields(row);
      if(extra.problem) return fail(res,400,`Row ${line}: ${extra.problem}`);
      clean.push({production_on,work_center,stage,order_no,unit_key,...extra.fields,
        job_card_no:String(row.job_card_no||"").trim(),
        article:String(row.article||"").trim(),party:String(row.party||"").trim(),
        size_ranges:String(row.size_ranges||"").trim(),planned_pairs,actual_pairs,
        note:String(row.note||"").trim().slice(0,500)});
    }
    const orderNos=[...new Set(clean.map(row=>row.order_no))];
    const { rows:live }=await q("select order_no from orders where active and order_no = any($1::text[])",[orderNos]);
    const liveSet=new Set(live.map(row=>String(row.order_no)));
    const missing=orderNos.filter(no=>!liveSet.has(no));
    if(missing.length) return fail(res,409,`These orders are no longer live: ${missing.join(", ")}`);

    const client=await db().connect();
    try{
      await client.query("begin");
      const saved=[];
      for(const row of clean){
        const { rows }=await client.query(
          `insert into production_actuals
             (production_on, work_center, stage, order_no, unit_key, job_card_no, article, party,
              size_ranges, planned_pairs, actual_pairs, note, created_by,
              rejected_pairs, repair_pairs, cartons, operators, supervisor, shift)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           on conflict (production_on, work_center, stage, unit_key) do update set
             order_no=excluded.order_no, job_card_no=excluded.job_card_no,
             article=excluded.article, party=excluded.party, size_ranges=excluded.size_ranges,
             planned_pairs=excluded.planned_pairs, actual_pairs=excluded.actual_pairs,
             note=excluded.note, created_by=excluded.created_by,
             rejected_pairs=excluded.rejected_pairs, repair_pairs=excluded.repair_pairs,
             cartons=excluded.cartons, operators=excluded.operators,
             supervisor=excluded.supervisor, shift=excluded.shift, updated_at=now()
           returning id, production_on, work_center, stage, order_no, unit_key, job_card_no, planned_pairs, actual_pairs, note,
             rejected_pairs, repair_pairs, cartons, operators, supervisor, shift`,
          [row.production_on,row.work_center,row.stage,row.order_no,row.unit_key,row.job_card_no,row.article,row.party,
           row.size_ranges,row.planned_pairs,row.actual_pairs,row.note,(req.user||{}).username||null,
           row.rejected_pairs,row.repair_pairs,row.cartons,row.operators,row.supervisor,row.shift]);
        saved.push(rows[0]);
      }
      await client.query("commit");
      return res.status(200).json({saved:saved.length,rows:saved});
    }catch(error){ await client.query("rollback"); throw error; }
    finally{ client.release(); }
  }

  return fail(res,405,`${req.method} not allowed`);
}

/* FINISHED GOODS LEDGER — see shared/finished-stock.js. Lives here for the
   same reason job work and repairs do: twelve functions is the Hobby limit. */
async function finishedStockMoves(req, res){
  if(req.method === "GET"){
    const { rows } = await q(
      `select id, article, size, qty, kind, order_no, dispatch_id, note, moved_on, created_by
         from finished_stock order by moved_on desc, id desc`);
    return res.status(200).json(rows.map(r => ({ ...r, qty:Number(r.qty),
      moved_on: r.moved_on instanceof Date ? r.moved_on.toISOString().slice(0,10) : String(r.moved_on||"").slice(0,10) })));
  }
  if(req.method === "POST"){
    const { rows:clean, problems } = validateMoves((req.body||{}).moves);
    if(problems.length) return fail(res, 400, problems.slice(0,6).join("; "));
    if(clean.length > 1000) return fail(res, 400, "Record at most 1,000 movements at a time");
    const client = await db().connect();
    try{
      await client.query("begin");
      const saved = [];
      for(const m of clean){
        const { rows } = await client.query(
          `insert into finished_stock (article, size, qty, kind, order_no, note, moved_on, created_by)
           values ($1,$2,$3,$4,$5,$6, coalesce($7::date, current_date), $8)
           returning id, article, size, qty, kind, order_no, note, moved_on`,
          [m.article, m.size, m.qty, m.kind, m.order_no, m.note, m.moved_on, (req.user||{}).username||null]);
        saved.push(rows[0]);
      }
      await client.query("commit");
      return res.status(201).json({ saved:saved.length, rows:saved });
    }catch(e){ await client.query("rollback"); throw e; }
    finally{ client.release(); }
  }
  /* A movement is a record of what happened, so a wrong one is DELETED and
     re-entered rather than overtyped. A move that came in with an MTS dispatch
     is refused here — undo that dispatch instead, or the order book and the
     shelf disagree. */
  if(req.method === "DELETE"){
    const id = Number((req.query||{}).id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const { rows } = await q("select dispatch_id from finished_stock where id = $1", [id]);
    if(!rows.length) return fail(res, 404, "That movement is no longer there — reload the list.");
    if(rows[0].dispatch_id) return fail(res, 409, "This came in with an MTS dispatch. Undo that dispatch in the Dispatch Book instead — it removes this too.");
    await q("delete from finished_stock where id = $1", [id]);
    return res.status(200).json({ id, deleted:true });
  }
  return fail(res, 405, `${req.method} not allowed`);
}

/* PHOTOS OF THE COMPLETED PAPER JOB CARD. A card counts as RECEIVED once a
   photo is on file — that is the job-card filled % the factory monitors. */
async function jobCardDocs(req, res){
  if(req.method === "GET"){
    const withImages = String((req.query||{}).images||"") === "1";
    const jobId = (req.query||{}).job_id;
    const { rows } = await q(
      `select id, job_id, card_no, order_no, note, uploaded_by, created_at${withImages ? ", image" : ""}
         from job_card_documents
        where ($1::bigint is null or job_id = $1)
        order by created_at desc`, [jobId ? Number(jobId) : null]);
    return res.status(200).json(rows);
  }
  if(req.method === "POST"){
    const b = req.body || {};
    const image = String(b.image || "");
    if(!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return fail(res, 400, "image must be a JPEG, PNG or WebP photo");
    if(image.length > 3_000_000) return fail(res, 413, "That photo is too large even after resizing — retake it closer, or upload a smaller one");
    const jobId = Number(b.job_id);
    if(!Number.isInteger(jobId)) return fail(res, 400, "job_id is required — a photo belongs to one job card");
    const { rows:job } = await q("select id, order_no, card from job_work where id = $1", [jobId]);
    if(!job.length) return fail(res, 404, "No such job card");
    const { rows } = await q(
      `insert into job_card_documents (job_id, card_no, order_no, image, note, uploaded_by)
       values ($1,$2,$3,$4,$5,$6) returning id, job_id, card_no, order_no, note, uploaded_by, created_at`,
      [jobId, String((job[0].card||{}).card_no||b.card_no||""), job[0].order_no, image,
       String(b.note||"").slice(0,300)||null, (req.user||{}).username||null]);
    return res.status(201).json(rows[0]);
  }
  if(req.method === "DELETE"){
    const id = Number((req.query||{}).id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const { rowCount } = await q("delete from job_card_documents where id = $1", [id]);
    if(!rowCount) return fail(res, 404, "That photo is no longer there");
    return res.status(200).json({ id, deleted:true });
  }
  return fail(res, 405, `${req.method} not allowed`);
}

export default wrap(async (req, res) => {
  const resource = String((req.query||{}).resource || (req.body && req.body.resource) || "");
  if(resource === "finished_stock") return finishedStockMoves(req, res);
  if(resource === "job_card_docs") return jobCardDocs(req, res);
  if(String((req.query||{}).resource||"") === "job_work"
     || (req.body && req.body.resource === "job_work"))
    return jobWork(req, res);

  if(String((req.query||{}).resource||"") === "repairs"
     || (req.body && req.body.resource === "repairs"))
    return repairs(req, res);

  if(String((req.query||{}).resource||"") === "production_actuals"
     || (req.body && req.body.resource === "production_actuals"))
    return productionActuals(req, res);

  if(req.method === "GET"){
    const { rows } = await q(
      /* gate_pass read through to_jsonb, NOT by name: a deployment that
         reaches the database before `gate_pass` has been added would
         otherwise fail this query — and with it the whole Dispatch Book. */
      `select id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order,
              packing_list, hidden, to_jsonb(dispatches) -> 'gate_pass' as gate_pass
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
      "select order_no, article_code, lines, pi from orders where order_no = $1 and active", [order_no]);
    if(!ord.length) return fail(res, 404, `no such order: ${order_no}`);

    // Never accept a dispatch for a combo the order doesn't contain, and never
    // more than remains outstanding — an over-dispatch would show as negative
    // pending and quietly corrupt the shortage figure.
    const ordered = {};
    for(const l of ord[0].lines) ordered[l.combo] = (ordered[l.combo] || 0) + Number(l.qty);

    /* Hidden rows are INCLUDED here on purpose: hiding takes a report off the
       history list, it does not un-ship the pairs. */
    const { rows: prev } = await q("select dispatched, packing_list from dispatches where order_no = $1", [order_no]);
    const already = {};
    for(const p of prev)
      for(const [c,v] of Object.entries(p.dispatched)) already[c] = (already[c] || 0) + Number(v);

    /* PAIRS ON THE REPAIR BENCH ARE NOT SHIPPABLE.
       They exist and they are not short — but sending one is how a customer
       receives the very shoe that failed inspection. Enforced HERE and not only
       on the screen, because the server is the only thing that enforces
       anything. Repair is recorded per SIZE and dispatch happens per RANGE, so
       a size that sits in two ranges on this order cannot be charged to either;
       `heldByCombo` returns those as `unattributed` and they are subtracted
       from the ORDER total instead of being guessed onto a range. */
    const { rows: repairRows } = await q(
      `select order_no, size, kind, qty from repairs where order_no = $1`, [order_no]);
    const held = heldByCombo(repairLedger(repairRows), ord[0]);

    const clean = {};
    for(const [combo, v] of Object.entries(dispatched)){
      const n = Number(v);
      if(!Number.isInteger(n) || n < 0) return fail(res, 400, `${combo}: pairs must be a whole number of 0 or more`);
      if(n === 0) continue;
      if(ordered[combo] == null) return fail(res, 400, `${combo} is not on order ${order_no}`);
      const outstanding = ordered[combo] - (already[combo] || 0);
      const onBench = held.by_combo[combo] || 0;
      const remaining = outstanding - onBench;
      if(n > remaining)
        return fail(res, 400, onBench > 0
          ? `${combo}: ${outstanding} pairs are outstanding but ${onBench} are on the repair bench, `
            + `so only ${Math.max(0, remaining)} can ship. Receive them back from repair first, or reject them.`
          : `${combo}: only ${remaining} pairs remain outstanding, cannot dispatch ${n}`);
      clean[combo] = n;
    }

    /* Held pairs that could not be attributed to a range still cannot ship, so
       they are checked against the order as a whole. */
    if(held.unattributed > 0){
      const shipping = Object.values(clean).reduce((a, n) => a + n, 0);
      const outstandingAll = Object.keys(ordered)
        .reduce((a, c) => a + ordered[c] - (already[c] || 0), 0);
      if(shipping > outstandingAll - held.unattributed)
        return fail(res, 400,
          `${held.unattributed} pair(s) are on the repair bench for a size that sits in more than one range, `
          + `so only ${Math.max(0, outstandingAll - held.unattributed)} pairs can ship on this order.`);
    }
    // A closing dispatch may ship nothing at all — writing the whole remaining
    // balance off short is legitimate. Any other dispatch must ship something.
    if(!Object.keys(clean).length && !closes_order) return fail(res, 400, "nothing to dispatch");

    const remainingAfter=Object.keys(ordered).reduce((sum,c)=>sum+ordered[c]-(already[c]||0)-(clean[c]||0),0);
    if(kind==="full"&&remainingAfter>0) return fail(res,400,`full dispatch still leaves ${remainingAfter} pairs outstanding`);
    if(closes_order&&remainingAfter>0&&!String(note||"").trim())
      return fail(res,400,"a reason is required when closing an order with a shortage");
    const k = closes_order ? "shortage" : remainingAfter===0 ? "full" : "partial";

    const {rows:refRows}=await q("select value from reference_data where id = 1");
    setReference(refRows[0]?.value?.articles?refRows[0].value:INPUTS);
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
      /* Range by range and size by size against the ORDER, not only the grand
         total — a sheet that moved pairs between ranges, or packed a size the
         customer never ordered, used to pass as long as the sum matched. */
      const againstOrder = checkAgainstOrder(req.body.packing_list, ord[0], clean, prev);
      if(againstOrder.length) return fail(res, 400, againstOrder.slice(0,5).join("; "));
      sheet = req.body.packing_list;
    }

    /* CARTONS ARE COUNTED, NEVER DERIVED.
       This used to store `pairs / packing rate` — 4.166666666666667 cartons,
       which cannot go on a lorry, and is wrong anyway whenever sizes inside one
       range pack at different rates. It ignored the packer's own count even
       when a packing list was supplied. The count now comes off the SHEET,
       which has already been reconciled against the dispatched pairs above; a
       dispatch with no sheet has NOT been counted, so it stores nothing rather
       than a fraction nobody measured. */
    const cleanCartons = {};
    if(sheet)
      for(const line of buildPackingList(sheet).lines)
        if(line.combo) cleanCartons[line.combo] = (cleanCartons[line.combo] || 0) + line.cartons;

    /* MOVE TO STOCK. An MTS order is made for the shelf, not for a lorry, so
       "dispatching" it means the pairs leave the order book AND land in
       finished stock — in ONE transaction, so the two can never disagree.
       Sizes are required: finished stock is counted per size. */
    const toStock = !!(req.body && req.body.to_stock);
    let stockRows = [];
    if(toStock){
      if(!/\bMTS\b/i.test(String((ord[0].pi||{}).order_nature||"")))
        return fail(res, 400, `${order_no} is not an MTS order, so it cannot be moved into stock — record a dispatch instead`);
      if(closes_order) return fail(res, 400, "Moving to stock cannot also close the order short");
      const sizes = (req.body.stock_sizes && typeof req.body.stock_sizes === "object") ? req.body.stock_sizes : {};
      for(const [combo, n] of Object.entries(clean)){
        const bySize = sizes[combo] || {};
        let sum = 0;
        for(const [size, v] of Object.entries(bySize)){
          const pairs = Number(v);
          if(!Number.isInteger(pairs) || pairs < 0) return fail(res, 400, `${combo} size ${size}: pairs must be a whole number`);
          if(!pairs) continue;
          sum += pairs;
          stockRows.push({ size:String(size), qty:pairs });
        }
        if(sum !== n) return fail(res, 400, `${combo}: the sizes moved to stock add up to ${sum}, not ${n}`);
      }
    }

    const insertSql = `insert into dispatches (order_no, dispatched, cartons, kind, note, dispatched_on, closes_order, packing_list)
         values ($1,$2,$3,$4,$5, coalesce($6::date, current_date), $7, $8)
         returning id, order_no, dispatched, cartons, kind, note, dispatched_on, closes_order, packing_list`;
    const insertArgs = [order_no, JSON.stringify(clean), JSON.stringify(cleanCartons), k,
         (toStock ? `Moved to finished stock${note ? ` — ${note}` : ""}` : note) || null,
         dispatched_on || null, !!closes_order, sheet ? JSON.stringify(sheet) : null];
    if(!toStock){
      const { rows } = await q(insertSql, insertArgs);
      return res.status(201).json(rows[0]);
    }
    const client = await db().connect();
    try{
      await client.query("begin");
      const { rows } = await client.query(insertSql, insertArgs);
      for(const m of stockRows)
        await client.query(
          `insert into finished_stock (article, size, qty, kind, order_no, dispatch_id, note, moved_on, created_by)
           values ($1,$2,$3,'from_order',$4,$5,$6, coalesce($7::date, current_date), $8)`,
          [ord[0].article_code, m.size, m.qty, order_no, rows[0].id, "MTS order moved to stock",
           dispatched_on || null, (req.user||{}).username || null]);
      await client.query("commit");
      return res.status(201).json({ ...rows[0], moved_to_stock: stockRows.reduce((a,m)=>a+m.qty,0) });
    }catch(e){ await client.query("rollback"); throw e; }
    finally{ client.release(); }
  }

  /* THE HAND-WRITTEN PART OF THE GATE PASS — SR. No, transporter, city.
     Nothing else on the slip can be written here: every figure on it comes
     from the packing list already stored with this dispatch. The column is
     added on first use, the same way dispatches_removed is created, so this
     works before db/schema.sql has been re-run. */
  if(req.method === "PATCH"){
    const id = Number((req.query||{}).id);
    if(!Number.isInteger(id)) return fail(res, 400, "id is required");
    const keys = Object.keys(req.body || {});
    if(keys.length !== 1 || keys[0] !== "gate_pass")
      return fail(res, 400, "Only the gate pass fields of a dispatch can be changed here");
    await q("alter table dispatches add column if not exists gate_pass jsonb");
    const { rows: used } = await q(
      `select order_no, dispatched_on, gate_pass ->> 'serial_no' as serial_no
         from dispatches where id <> $1 and coalesce(gate_pass ->> 'serial_no','') <> ''`, [id]);
    const check = cleanGatePassFields(req.body.gate_pass || {}, used.map(u => ({ ...u,
      dispatched_on: u.dispatched_on instanceof Date ? u.dispatched_on.toISOString().slice(0,10) : u.dispatched_on })));
    if(!check.ok) return fail(res, 400, check.problems.join("; "));
    const value = { ...check.value, saved_by: (req.user && req.user.username) || null,
                    saved_at: new Date().toISOString() };
    const { rows } = await q(
      `update dispatches set gate_pass = $2 where id = $1
       returning id, order_no, gate_pass`, [id, JSON.stringify(value)]);
    if(!rows.length) return fail(res, 404, "That dispatch is not on record — it may have been undone. Reload the list.");
    return res.status(200).json(rows[0]);
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
      /* An MTS dispatch put pairs on the shelf; undoing it takes them off again. */
      await client.query("delete from finished_stock where dispatch_id = $1", [id]);
      await client.query("delete from dispatches where id = $1", [id]);
      await client.query("commit");
      const pairs = Object.values(d.dispatched || {}).reduce((a,b)=>a+(Number(b)||0), 0);
      return res.status(200).json({ removed:id, order_no:d.order_no, pairs_returned:pairs });
    }catch(e){ try{ await client.query("rollback"); }catch(_){ } throw e; }
    finally{ client.release(); }
  }

  return fail(res, 405, `${req.method} not allowed`);
});
