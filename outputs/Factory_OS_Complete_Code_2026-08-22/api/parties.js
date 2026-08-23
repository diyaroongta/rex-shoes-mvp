import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";

/* Party master. Commercial terms live here so a PI cannot deviate from them:
   the invoice screen reads these and shows them read-only. */
export default wrap(async (req, res) => {
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
      if(b[k] == null) continue;
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
