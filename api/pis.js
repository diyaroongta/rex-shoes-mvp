import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { ensurePiTable, syncPiMaster } from "./_lib/pis.js";
import { INPUTS as SEED } from "../shared/inputs.js";
import { remainingForOrder, releasedBySource, buildRunLines, nextRunNo } from "../shared/pi-split.js";
import { ordersFromPiSnapshot } from "../shared/pi-schedule.js";
import { quoteNo, canMoveTo, validateQuotation, STATUSES } from "../shared/quotation.js";

async function reference(){
  const {rows}=await q("select value from reference_data where id = 1");
  if(rows.length&&rows[0].value&&rows[0].value.articles) return rows[0].value;
  return SEED;
}


/* QUOTATIONS — a priced offer, before there is an order.
 *
 * Served from this file for the same reason job work is served from
 * api/dispatches.js: Vercel's Hobby plan builds one function per file under
 * api/ and allows 12, and the project is at exactly 12. The neighbour is the
 * right one — a quotation is the same document as a PI, one step earlier, and
 * the permission that governs invoices should govern the offer that becomes
 * one.
 *
 * Nothing here releases work. A quotation holds its own snapshot and touches
 * no order, no schedule and no material, until somebody converts it and files
 * the PI through the existing flow.
 */
async function ensureQuotations(){
  await q(`create table if not exists quotations (
    quote_no text primary key, quote_date date, party text, city text,
    status text not null default 'draft', valid_days integer,
    pairs integer not null default 0, total numeric not null default 0,
    converted_pi_no text, note text, snapshot jsonb not null default '{}'::jsonb,
    created_by text, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now())`);
}
const quotationRow = r => ({ ...r,
  quote_date: r.quote_date instanceof Date ? r.quote_date.toISOString().slice(0,10) : String(r.quote_date||""),
  pairs: Number(r.pairs), total: Number(r.total) });

async function quotations(req,res){
  await ensureQuotations();

  if(req.method==="GET"){
    const { rows } = await q(`select quote_no, quote_date, party, city, status, valid_days,
      pairs, total, converted_pi_no, note, snapshot, created_by, created_at, updated_at
      from quotations order by created_at desc, quote_no desc`);
    return res.status(200).json(rows.map(quotationRow));
  }

  if(req.method==="POST"){
    const b = req.body || {};
    /* A number is issued when a quotation is SAVED, never when the screen is
       opened: allocating on mount burned a PI number per page load once, and
       the same sequence would burn a quotation number the same way. */
    const quotation = {
      party: String(b.party||"").trim(), city: String(b.city||"").trim(),
      quote_date: String(b.quote_date||"").slice(0,10) || null,
      valid_days: b.valid_days==null||b.valid_days==="" ? null : Number(b.valid_days),
      discount_pct: b.discount_pct==null||b.discount_pct==="" ? null : Number(b.discount_pct),
      items: Array.isArray(b.items) ? b.items : [],
      note: String(b.note||"").trim(),
    };
    const check = validateQuotation(quotation);
    if(!check.ok) return fail(res,400,check.problems.join(" "));

    const { rows:[seq] } = await q("select nextval('quotation_no_seq') as n");
    const no = quoteNo(seq.n);
    const { rows } = await q(`insert into quotations
      (quote_no, quote_date, party, city, status, valid_days, pairs, total, note, snapshot, created_by)
      values ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10)
      returning quote_no, quote_date, party, city, status, valid_days, pairs, total,
                converted_pi_no, note, snapshot, created_by, created_at, updated_at`,
      [no, quotation.quote_date, quotation.party, quotation.city, quotation.valid_days,
       Math.round(check.pairs), Number(check.totals.total||0), quotation.note,
       JSON.stringify(quotation), (req.user&&req.user.username)||null]);
    return res.status(201).json(quotationRow(rows[0]));
  }

  if(req.method==="PATCH"){
    const b = req.body || {};
    const no = String(b.quote_no||"").trim();
    if(!no) return fail(res,400,"quote_no is required");
    const to = String(b.status||"").trim();
    if(!STATUSES.includes(to)) return fail(res,400,`unknown quotation status: ${to}`);

    const { rows:[current] } = await q("select status from quotations where quote_no=$1",[no]);
    if(!current) return fail(res,404,`no such quotation: ${no}`);
    if(current.status===to) return fail(res,400,`${no} is already ${to}.`);
    if(!canMoveTo(current.status,to))
      return fail(res,400, current.status==="converted"
        ? `${no} has already been converted to a PI. Raise a new quotation rather than reopening this one.`
        : `${no} cannot go from ${current.status} to ${to}.`);
    /* Converted is recorded WITH the invoice it became, or the trail from the
       offer to the order is lost. */
    const piNo = String(b.converted_pi_no||"").trim();
    if(to==="converted" && !piNo)
      return fail(res,400,"Converting needs the PI number the quotation became.");

    const { rows } = await q(`update quotations set status=$2,
        converted_pi_no=case when $2='converted' then $3 else converted_pi_no end,
        updated_at=now() where quote_no=$1
      returning quote_no, quote_date, party, city, status, valid_days, pairs, total,
                converted_pi_no, note, snapshot, created_by, created_at, updated_at`,
      [no,to,piNo||null]);
    return res.status(200).json(quotationRow(rows[0]));
  }

  return fail(res,405,`${req.method} not allowed for quotations`);
}

export default wrap(async (req,res)=>{
  if(String(req.query?.resource||"")==="quotations") return quotations(req,res);

  if(req.method==="GET"){
    await syncPiMaster();
    if(req.query?.history){
      const piNo=String(req.query.pi_no||"").trim();
      if(!piNo) return fail(res,400,"pi_no is required for revision history");
      const {rows:past}=await q(`select id, pi_no, revision, status, snapshot, recorded_at, false as current
        from proforma_invoice_revisions where pi_no=$1 order by recorded_at, id`,[piNo]);
      const {rows:latest}=await q(`select null::bigint as id, pi_no, revision, status, snapshot,
        updated_at as recorded_at, true as current from proforma_invoices where pi_no=$1`,[piNo]);
      if(!latest.length&&!past.length) return fail(res,404,`no such PI: ${piNo}`);
      return res.status(200).json([...past,...latest]);
    }
    /* Archived PIs are hidden from the working list but never lost. `?archived=1`
       shows only those, so restoring one is possible without a database query. */
    const archived = String(req.query?.archived||"")==="1";
    const { rows } = await q(`select pi_no, pi_date, party, status, revision, snapshot, archived, created_at, updated_at
      from proforma_invoices where archived = $1 order by pi_date desc, pi_no desc`,[archived]);
    return res.status(200).json(rows.map(r=>({
      ...r,
      pi_date:r.pi_date instanceof Date?r.pi_date.toISOString().slice(0,10):String(r.pi_date||""),
    })));
  }

  if(req.method==="POST"){
    /* Allocating the next PI number lives here rather than in its own endpoint
       because Vercel's Hobby plan allows 12 serverless functions and this
       project had grown to 13. It belongs with the PIs in any case, and it is
       handled BEFORE the pi_no check below — a number being allocated is
       precisely the request that does not have one yet.

       Central allocation matters: a browser-side random number has only a few
       hundred possibilities and eventually merges unrelated commercial records. */
    if(String((req.body&&req.body.action)||"").trim()==="next_number"){
      await q("create sequence if not exists pi_no_seq start 1");
      const {rows}=await q("select nextval('pi_no_seq') as n");
      const year=new Date().getUTCFullYear();
      return res.status(201).json({pi_no:`PI-${year}-${String(rows[0].n).padStart(6,"0")}`});
    }

    const piNo=String((req.body&&req.body.pi_no)||"").trim();
    if(!piNo) return fail(res,400,"pi_no is required");

    /* Archive / restore. A PI is a commercial record, so hiding it is the safe
       operation and it takes its orders with it — an archived PI must not keep
       occupying machine time on the schedule, and restoring it must put that
       work back exactly as it was. */
    const action=String((req.body&&req.body.action)||"").trim();
    if(action==="archive"||action==="restore"){
      const archiving=action==="archive";
      const client=await db().connect();
      try{
        await client.query("begin");
        const {rowCount}=await client.query(
          "update proforma_invoices set archived=$2, updated_at=now() where pi_no=$1",[piNo,archiving]);
        if(!rowCount){await client.query("rollback");return fail(res,404,`no such PI: ${piNo}`);}
        const {rows:touched}=await client.query(
          `update orders set active=$2, version=version+1, updated_at=now()
             where pi->>'pi_no' = $1 returning order_no`,[piNo,!archiving]);
        await client.query("commit");
        return res.status(200).json({pi_no:piNo,archived:archiving,orders:touched.map(r=>r.order_no)});
      }catch(e){try{await client.query("rollback");}catch(_){ }throw e;}
      finally{client.release();}
    }
    await ensurePiTable();
    const {rows}=await q("select snapshot from proforma_invoices where pi_no = $1",[piNo]);
    if(!rows.length) return fail(res,404,`no such PI: ${piNo}`);
    const restored=ordersFromPiSnapshot(rows[0].snapshot,await reference());
    if(restored.errors.length) return fail(res,409,restored.errors.join("; "));

    /* RELEASING PART OF A QUANTITY. A large order for one shoe is routinely
       made in several runs, so a PI order is a CEILING, not the thing that gets
       scheduled. Each run becomes its own production order carrying
       `pi.source_order`, and what is still owed is always DERIVED from the runs
       that exist — never stored, so it cannot drift out of step with them. */
    const parts=req.body&&req.body.parts;
    if(parts!=null){
      if(!Array.isArray(parts)||!parts.length) return fail(res,400,"parts must be a non-empty array");
      const bySnapshotNo=new Map(restored.orders.map(o=>[o.order_no,o]));
      const {rows:live}=await q(
        "select order_no, lines, pi from orders where pi->>'pi_no' = $1 and active",[piNo]);
      const released=releasedBySource(live,piNo);
      const runCount={};
      for(const o of live){
        const src=String((o.pi||{}).source_order||o.order_no);
        runCount[src]=(runCount[src]||0)+1;
      }

      const toCreate=[],errors=[];
      for(const part of parts){
        const base=String((part&&part.order_no)||"").trim();
        const snap=bySnapshotNo.get(base);
        if(!snap){ errors.push("not part of "+piNo+": "+(base||"(blank)")); continue; }
        const remaining=remainingForOrder(snap,released[base]||{});
        // No quantities named for this part means "everything still owed".
        const want=part.qty&&typeof part.qty==="object"
          ? part.qty
          : Object.fromEntries(remaining.lines.map(l=>[l.combo,l.remaining]));
        const built=buildRunLines(remaining,want);
        if(built.errors.length){ errors.push(...built.errors); continue; }
        const runNo=nextRunNo(base,runCount[base]||0);
        runCount[base]=(runCount[base]||0)+1;
        toCreate.push({snap,base,runNo,lines:built.lines});
      }
      if(errors.length) return fail(res,400,errors.join("; "));
      if(!toCreate.length) return fail(res,400,"nothing was selected to release");

      const client=await db().connect();
      const created=[];
      try{
        await client.query("begin");
        for(const {snap,base,runNo,lines} of toCreate){
          const pi={...snap.pi,pi_no:piNo,source_order:base,
            production_status:snap.pi.production_status||"produced"};
          const {rows:made}=await client.query(
            "insert into orders (order_no, order_date, article_code, priority, party, lines, pi)"
            +" values ($1,$2,$3,$4,$5,$6,$7) on conflict (order_no) do nothing returning order_no",
            [runNo,snap.order_date,snap.article_code,snap.priority,snap.party,
             JSON.stringify(lines),JSON.stringify(pi)]);
          if(made.length) created.push({order_no:made[0].order_no,source_order:base,
            pairs:lines.reduce((a,l)=>a+l.qty,0)});
        }
        await client.query(`select setval('order_no_seq', greatest(
          (select last_value from order_no_seq),
          coalesce((select max(substring(order_no from '([0-9]+)$')::bigint)
                      from orders where order_no ~ '[0-9]+$'),2000)), true)`);
        await syncPiMaster(client);
        await client.query("commit");
      }catch(e){await client.query("rollback");throw e;}
      finally{client.release();}

      /* What is STILL owed, recomputed from the rows that now exist, so the
         caller never has to guess whether more can be released. */
      const {rows:after}=await q(
        "select order_no, lines, pi from orders where pi->>'pi_no' = $1 and active",[piNo]);
      const now=releasedBySource(after,piNo);
      const outstanding=restored.orders
        .map(o=>remainingForOrder(o,now[o.order_no]||{}))
        .filter(r=>r.remaining>0)
        .map(r=>({order_no:r.order_no,article_code:r.article_code,remaining:r.remaining}));
      return res.status(200).json({pi_no:piNo,created,outstanding,partial:true});
    }

    /* PARTIAL SCHEDULING. A PI often carries several articles and the factory
       is ready to start only some of them — the rest are waiting on material,
       or on the customer. `order_nos` names the ones to release now; the rest
       stay in the PI master, untouched, and can be released later by sending
       the same request again. Omitting it releases the whole PI, which is what
       every existing caller does. */
    const asked=req.body&&req.body.order_nos;
    let selected=restored.orders, skipped=[];
    if(asked!=null){
      if(!Array.isArray(asked)) return fail(res,400,"order_nos must be an array of order numbers");
      const wanted=new Set(asked.map(n=>String(n||"").trim()).filter(Boolean));
      const unknown=[...wanted].filter(n=>!restored.orders.some(o=>o.order_no===n));
      if(unknown.length) return fail(res,400,`not part of ${piNo}: ${unknown.join(", ")}`);
      selected=restored.orders.filter(o=>wanted.has(o.order_no));
      if(!selected.length) return fail(res,400,"order_nos matched none of this PI's orders");
      skipped=restored.orders.filter(o=>!wanted.has(o.order_no)).map(o=>o.order_no);
    }

    const client=await db().connect();
    const inserted=[],reactivated=[],already=[];
    try{
      await client.query("begin");
      const ids=selected.map(o=>o.order_no);
      const existingRows=ids.length ? (await client.query(
        "select order_no, active, coalesce(pi->>'pi_no','') as pi_no from orders where order_no = any($1::text[]) for update",[ids])).rows : [];
      const conflicts=existingRows.filter(r=>r.pi_no&&r.pi_no!==piNo);
      if(conflicts.length){
        await client.query("rollback");
        return fail(res,409,`Order number already belongs to another PI: ${conflicts.map(r=>r.order_no).join(", ")}`);
      }
      const byNo=new Map(existingRows.map(r=>[r.order_no,r]));
      for(const order of selected){
        const old=byNo.get(order.order_no);
        if(old){
          if(old.active) already.push(order.order_no);
          else{
            await client.query("update orders set active=true, version=version+1, updated_at=now() where order_no=$1",[order.order_no]);
            reactivated.push(order.order_no);
          }
          continue;
        }
        const pi={...order.pi,pi_no:piNo,production_status:order.pi.production_status||"produced"};
        const result=await client.query(
          `insert into orders (order_no, order_date, article_code, priority, party, lines, pi)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (order_no) do nothing returning order_no`,
          [order.order_no,order.order_date,order.article_code,order.priority,order.party,
           JSON.stringify(order.lines),JSON.stringify(pi)]);
        if(result.rows.length) inserted.push(order.order_no);
      }
      // Restored order numbers may be ahead of the sequence. Advance it so a
      // future new order cannot collide with a restored historical number.
      await client.query(`select setval('order_no_seq', greatest(
        (select last_value from order_no_seq),
        coalesce((select max(substring(order_no from '([0-9]+)$')::bigint)
                    from orders where order_no ~ '[0-9]+$'),2000)), true)`);
      await syncPiMaster(client);
      await client.query("commit");
    }catch(e){await client.query("rollback");throw e;}
    finally{client.release();}
    return res.status(200).json({pi_no:piNo,restored:inserted,reactivated,already_linked:already,
      skipped, partial:asked!=null});
  }

  /* Permanent deletion. Archiving is the safe operation and the default; this
     exists for a PI raised in error. It removes the PI, its revision history
     and its orders — but never dispatch evidence: an order that has shipped
     anything cannot be destroyed, and the refusal names the orders so the user
     can see why. Archive that PI instead. */
  if(req.method==="DELETE"){
    const piNo=String(req.query?.pi_no||"").trim();
    if(!piNo) return fail(res,400,"pi_no is required");
    if(String(req.query?.confirm||"")!=="1")
      return fail(res,400,`Deleting ${piNo} is permanent and cannot be undone. Archive it instead, or confirm the deletion.`);

    const client=await db().connect();
    try{
      await client.query("begin");
      const {rows:exists}=await client.query("select pi_no from proforma_invoices where pi_no=$1 for update",[piNo]);
      const {rows:orderRows}=await client.query(
        "select order_no from orders where pi->>'pi_no' = $1 order by order_no",[piNo]);
      if(!exists.length&&!orderRows.length){
        await client.query("rollback");
        return fail(res,404,`no such PI: ${piNo}`);
      }
      const orderNos=orderRows.map(r=>r.order_no);
      if(orderNos.length){
        const {rows:shipped}=await client.query(
          `select distinct order_no from dispatches where order_no = any($1::text[]) order by order_no`,[orderNos]);
        if(shipped.length){
          await client.query("rollback");
          return fail(res,409,`${piNo} cannot be deleted: ${shipped.map(r=>r.order_no).join(", ")} `
            +`${shipped.length===1?"has":"have"} recorded dispatches, and shipment records are never destroyed. `
            +`Archive this PI instead.`,409);
        }
        await client.query("delete from orders where order_no = any($1::text[])",[orderNos]);
      }
      await client.query("delete from proforma_invoice_revisions where pi_no=$1",[piNo]);
      await client.query("delete from proforma_invoices where pi_no=$1",[piNo]);
      await client.query("commit");
      return res.status(200).json({deleted:piNo,orders:orderNos});
    }catch(e){try{await client.query("rollback");}catch(_){ }throw e;}
    finally{client.release();}
  }

  return fail(res,405,`${req.method} not allowed`);
});
