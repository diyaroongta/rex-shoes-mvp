import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { syncPiMaster } from "./_lib/pis.js";

export default wrap(async (req,res)=>{
  if(req.method!=="GET") return fail(res,405,`${req.method} not allowed`);
  await syncPiMaster();
  const { rows } = await q(`select pi_no, pi_date, party, status, revision, snapshot, created_at, updated_at
    from proforma_invoices order by pi_date desc, pi_no desc`);
  return res.status(200).json(rows.map(r=>({
    ...r,
    pi_date:r.pi_date instanceof Date?r.pi_date.toISOString().slice(0,10):String(r.pi_date||""),
  })));
});

