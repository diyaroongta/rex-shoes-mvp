import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { ensurePiTable, syncPiMaster } from "./_lib/pis.js";
import { INPUTS as SEED } from "../shared/inputs.js";
import { remainingForOrder, releasedBySource, buildRunLines, nextRunNo } from "../shared/pi-split.js";
import { ordersFromPiSnapshot } from "../shared/pi-schedule.js";

async function reference(){
  const {rows}=await q("select value from reference_data where id = 1");
  if(rows.length&&rows[0].value&&rows[0].value.articles) return rows[0].value;
  return SEED;
}

export default wrap(async (req,res)=>{
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
