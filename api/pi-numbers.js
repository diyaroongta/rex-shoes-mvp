import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";

/* Allocate PI numbers centrally. A browser-side random number has only a few
   hundred possibilities and eventually merges unrelated commercial records. */
export default wrap(async (req,res)=>{
  if(req.method!=="POST") return fail(res,405,`${req.method} not allowed`);
  await q("create sequence if not exists pi_no_seq start 1");
  const {rows}=await q("select nextval('pi_no_seq') as n");
  const year=new Date().getUTCFullYear();
  const n=String(rows[0].n).padStart(6,"0");
  return res.status(201).json({pi_no:`PI-${year}-${n}`});
});
