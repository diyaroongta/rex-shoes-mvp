import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { ensurePiTable, syncPiMaster } from "./_lib/pis.js";
import { INPUTS as SEED } from "../shared/inputs.js";
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
    const { rows } = await q(`select pi_no, pi_date, party, status, revision, snapshot, created_at, updated_at
      from proforma_invoices order by pi_date desc, pi_no desc`);
    return res.status(200).json(rows.map(r=>({
      ...r,
      pi_date:r.pi_date instanceof Date?r.pi_date.toISOString().slice(0,10):String(r.pi_date||""),
    })));
  }

  if(req.method==="POST"){
    const piNo=String((req.body&&req.body.pi_no)||"").trim();
    if(!piNo) return fail(res,400,"pi_no is required");
    await ensurePiTable();
    const {rows}=await q("select snapshot from proforma_invoices where pi_no = $1",[piNo]);
    if(!rows.length) return fail(res,404,`no such PI: ${piNo}`);
    const restored=ordersFromPiSnapshot(rows[0].snapshot,await reference());
    if(restored.errors.length) return fail(res,409,restored.errors.join("; "));

    const client=await db().connect();
    const inserted=[],reactivated=[],already=[];
    try{
      await client.query("begin");
      const ids=restored.orders.map(o=>o.order_no);
      const existingRows=ids.length ? (await client.query(
        "select order_no, active, coalesce(pi->>'pi_no','') as pi_no from orders where order_no = any($1::text[]) for update",[ids])).rows : [];
      const conflicts=existingRows.filter(r=>r.pi_no&&r.pi_no!==piNo);
      if(conflicts.length){
        await client.query("rollback");
        return fail(res,409,`Order number already belongs to another PI: ${conflicts.map(r=>r.order_no).join(", ")}`);
      }
      const byNo=new Map(existingRows.map(r=>[r.order_no,r]));
      for(const order of restored.orders){
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
    return res.status(200).json({pi_no:piNo,restored:inserted,reactivated,already_linked:already});
  }

  return fail(res,405,`${req.method} not allowed`);
});
