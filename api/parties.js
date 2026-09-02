import { q, db } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { ensurePiTable, syncPiMaster } from "./_lib/pis.js";
import { validateFabricator, DEFAULT_LINES } from "../shared/fabricators.js";

const termsOf = row => ({
  discount_pct: Number(row.discount_pct),
  deductions: Array.isArray(row.deductions) ? row.deductions : [],
  gst_pct: Number(row.gst_pct),
  payment_split_pct: Number(row.payment_split_pct),
  dispatch_timeline: row.dispatch_timeline || "45 days",
});

/* Party master. Commercial terms live here so a PI cannot deviate from them:
   the invoice screen reads these and shows them read-only. */
/* Fabricators share this endpoint rather than getting their own file: Vercel's
   Hobby plan builds one serverless function per file under api/ and allows 12,
   and this project is at exactly 12. They are a reasonable neighbour — parties
   are the customers work comes from, fabricators the people it goes to, and
   both are counterparty master data judged by the same admin-only policy. */
async function fabricators(req, res){
  if(req.method === "GET"){
    const { rows } = await q(
      `select name, type, rate, tat_days, contact_person, contact_phone,
              payable, active, note
         from fabricators order by active desc, type, name`);
    return res.status(200).json(rows.map(r => ({ ...r,
      rate: Number(r.rate), tat_days: Number(r.tat_days) })));
  }

  if(req.method === "PUT"){
    const b = req.body || {};
    /* Seeding the four internal lines is an explicit action, not something
       that happens on first read: a line the factory does not run should not
       appear because nobody had opened the screen yet. */
    if(b.seed_lines){
      const made = [];
      for(const line of DEFAULT_LINES){
        const { rowCount } = await q(
          `insert into fabricators (name, type, rate, tat_days, payable, active, note)
           values ($1,$2,$3,$4,$5,true,$6) on conflict (name) do nothing`,
          [line.name, line.type, line.rate, line.tat_days, line.payable, line.note]);
        if(rowCount) made.push(line.name);
      }
      return res.status(200).json({ seeded: made });
    }

    const check = validateFabricator(b);
    if(!check.ok) return fail(res, 400, check.problems.join("; "));
    const v = check.value;
    const { rows } = await q(
      `insert into fabricators (name, type, rate, tat_days, contact_person,
                                contact_phone, payable, active, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (name) do update set
         type=$2, rate=$3, tat_days=$4, contact_person=$5, contact_phone=$6,
         payable=$7, active=$8, note=$9, updated_at=now()
       returning name, type, rate, tat_days, contact_person, contact_phone, payable, active, note`,
      [v.name, v.type, v.rate, v.tat_days, v.contact_person, v.contact_phone,
       v.payable, v.active, v.note]);
    return res.status(200).json({ ...rows[0], rate:Number(rows[0].rate), tat_days:Number(rows[0].tat_days) });
  }

  /* No delete. A fabricator named on a past job card must stay resolvable, so
     retiring one deactivates it — it keeps its history and takes no new work. */
  if(req.method === "DELETE"){
    const name = String((req.query||{}).name || "").trim();
    if(!name) return fail(res, 400, "name is required");
    const { rowCount } = await q(
      "update fabricators set active=false, updated_at=now() where name=$1", [name]);
    if(!rowCount) return fail(res, 404, `no such fabricator: ${name}`);
    return res.status(200).json({ name, active:false,
      note:"Deactivated rather than deleted, so past job cards still make sense." });
  }

  return fail(res, 405, `${req.method} not allowed`);
}

export default wrap(async (req, res) => {
  /* One endpoint, two masters. */
  if(String((req.query||{}).resource||"") === "fabricators"
     || (req.body && req.body.resource === "fabricators"))
    return fabricators(req, res);

  if(req.method === "GET"){
    const { rows } = await q(
      `select name, city, discount_pct, deductions, gst_pct, payment_split_pct,
              dispatch_timeline, order_nature, active
         from parties where active order by name`);
    return res.status(200).json(rows.map(r => ({
      ...r,
      discount_pct: Number(r.discount_pct),
      gst_pct: Number(r.gst_pct),
      payment_split_pct: Number(r.payment_split_pct),
    })));
  }

  if(req.method === "PUT"){
    const b = req.body || {};
    if(!b.name || !String(b.name).trim()) return fail(res, 400, "name is required");
    for(const k of ["discount_pct","gst_pct","payment_split_pct"]){
      if(b[k] == null) continue;                     // omitted: the default applies
      // A CLEARED field is not a zero. Blanking the discount box used to store
      // 0%, which prices every future PI for that customer at full MRP without
      // anyone being told. An agreed figure has to be stated, not inferred.
      if(String(b[k]).trim() === "")
        return fail(res, 400, `${k} cannot be blank — enter the agreed figure, or 0 if that is the agreement`);
      const n = Number(b[k]);
      if(!isFinite(n) || n < 0 || n > 100) return fail(res, 400, `${k} must be between 0 and 100`);
    }
    const ded = Array.isArray(b.deductions) ? b.deductions : [];
    for(const d of ded){
      const n = Number(d.pct);
      if(!d.label || !isFinite(n) || n < 0 || n > 100)
        return fail(res, 400, "each deduction needs a label and a percentage between 0 and 100");
    }
    const { rows } = await q(
      `insert into parties (name, city, discount_pct, deductions, gst_pct,
                            payment_split_pct, dispatch_timeline, order_nature, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,true)
       on conflict (name) do update set
         city=$2, discount_pct=$3, deductions=$4, gst_pct=$5,
         payment_split_pct=$6, dispatch_timeline=$7, order_nature=$8,
         active=true, updated_at=now()
       returning name`,
      [String(b.name).trim(), b.city || null, Number(b.discount_pct ?? 40),
       JSON.stringify(ded), Number(b.gst_pct ?? 5), Number(b.payment_split_pct ?? 50),
       b.dispatch_timeline || "45 days", b.order_nature || null]);
    return res.status(200).json(rows[0]);
  }

  /* Re-apply a party's CURRENT terms to the orders already raised for them.
     Deliberately an explicit action, never a side effect of saving the party:
     an issued PI is a commercial record, and silently restating the money on
     invoices the customer has already seen is not a refresh, it is a revision.
     `preview` reports what would change without touching anything. */
  if(req.method === "POST"){
    const name = String((req.body && req.body.name) || "").trim();
    if(!name) return fail(res, 400, "name is required");

    const { rows: party } = await q(
      `select discount_pct, deductions, gst_pct, payment_split_pct, dispatch_timeline
         from parties where name = $1`, [name]);
    if(!party.length) return fail(res, 404, `no such party: ${name}`);
    const terms = termsOf(party[0]);

    const { rows: affected } = await q(
      `select order_no, coalesce(pi->>'pi_no','') as pi_no,
              (pi->>'discount_pct')::numeric as discount_pct
         from orders where party = $1 order by order_no`, [name]);

    if(req.body.preview){
      return res.status(200).json({
        name, terms,
        orders: affected.length,
        pis: [...new Set(affected.map(r => r.pi_no).filter(Boolean))],
        changing: affected.filter(r => Number(r.discount_pct) !== terms.discount_pct).length,
      });
    }

    // jsonb || jsonb merges at the top level, so pi_no, remarks, the attachment
    // and every other field on the blob survive untouched.
    const client=await db().connect();
    let rowCount=0;
    try{
      await client.query("begin");
      await ensurePiTable(client);
      const payload=JSON.stringify({terms,discount_pct:terms.discount_pct});
      const piNos=[...new Set(affected.map(r=>r.pi_no).filter(Boolean))].sort();
      for(const piNo of piNos){
        const {rows:master}=await client.query("select revision from proforma_invoices where pi_no=$1 for update",[piNo]);
        const next=(Number(master[0]?.revision)||0)+1;
        const result=await client.query(
          `update orders set pi = coalesce(pi,'{}'::jsonb) || $3::jsonb ||
            jsonb_build_object('revision',$2::integer,'production_status','edited','revised_at',now()::text),
            version=version+1, updated_at=now()
            where party = $1 and pi->>'pi_no'=$4 and active`,[name,next,payload,piNo]);
        rowCount+=result.rowCount;
      }
      if(affected.some(r=>!r.pi_no)){
        const result=await client.query(
          `update orders set pi=coalesce(pi,'{}'::jsonb) || $2::jsonb,
             version=version+1, updated_at=now()
             where party=$1 and nullif(pi->>'pi_no','') is null and active`,[name,payload]);
        rowCount+=result.rowCount;
      }
      await syncPiMaster(client);
      await client.query("commit");
    }catch(e){await client.query("rollback");throw e;}finally{client.release();}
    return res.status(200).json({
      name, terms, updated: rowCount,
      pis: [...new Set(affected.map(r => r.pi_no).filter(Boolean))],
    });
  }

  if(req.method === "DELETE"){
    const name = req.query.name;
    if(!name) return fail(res, 400, "name is required");
    // deactivate rather than delete — old orders still reference the party
    const { rowCount } = await q("update parties set active=false where name=$1", [name]);
    if(!rowCount) return fail(res, 404, "no such party");
    return res.status(200).json({ deactivated: name });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
