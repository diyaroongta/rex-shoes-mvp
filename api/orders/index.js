import { q, db } from "../_lib/db.js";
import { fail, wrap } from "../_lib/http.js";
import { INPUTS as SEED } from "../../shared/inputs.js";

/* Validate against the reference data actually in use, not the bundled seed.
   An article uploaded through Data & BOM lives in the database — validating
   against the seed rejected orders for it as "unknown article_code", which is
   why a saved PI could vanish instead of reaching the order sheet. */
async function reference(){
  try{
    const { rows } = await q("select value from reference_data where id = 1");
    if(rows.length && rows[0].value && rows[0].value.articles) return rows[0].value;
  }catch(e){ /* fall through to the seed */ }
  return SEED;
}

const row = r => ({
  order_no: r.order_no,
  order_date: r.order_date instanceof Date ? r.order_date.toISOString().slice(0,10) : String(r.order_date),
  article_code: r.article_code,
  priority: r.priority,
  party: r.party,
  lines: r.lines,
  pi: r.pi,
});

/* Reject anything the planner can't price. An unknown combo would consume
   machine capacity but order zero material — a silent under-buy. */
function validate(o, INPUTS){
  if(!o || typeof o !== "object") return "order must be an object";
  const art = INPUTS.articles[o.article_code];
  if(!art) return `unknown article_code: ${o.article_code}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(o.order_date||""))) return "order_date must be YYYY-MM-DD";
  const p = Number(o.priority);
  if(!Number.isInteger(p) || p < 1) return "priority must be an integer >= 1";
  if(!Array.isArray(o.lines) || !o.lines.length) return "at least one line is required";
  for(const l of o.lines){
    if(!art.combos[l.combo]) return `unknown combo "${l.combo}" for article ${o.article_code}`;
    if(!(Number(l.qty) > 0)) return `line ${l.combo}: qty must be > 0`;
    if(l.sizes != null && typeof l.sizes !== "object") return `line ${l.combo}: sizes must be an object`;
  }
  return null;
}

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q(
      `select order_no, order_date, article_code, priority, party, lines, pi
         from orders order by order_no`);
    return res.status(200).json(rows.map(row));
  }

  if(req.method === "POST"){
    const drafts = (req.body && req.body.orders) || [];
    if(!Array.isArray(drafts) || !drafts.length) return fail(res, 400, "body must be { orders: [...] }");
    const ref = await reference();
    for(const d of drafts){
      const bad = validate(d, ref);
      if(bad) return fail(res, 400, bad);
    }
    const client = await db().connect();
    try{
      await client.query("begin");
      const out = [];
      for(const d of drafts){
        const { rows } = await client.query(
          `insert into orders (order_no, order_date, article_code, priority, party, lines, pi)
           values ('JO' || nextval('order_no_seq'), $1, $2, $3, $4, $5, $6)
           returning order_no, order_date, article_code, priority, party, lines, pi`,
          [d.order_date, d.article_code, Number(d.priority), d.party || "—",
           JSON.stringify(d.lines),
           JSON.stringify({ ...(d.pi || {}),
             stitching: d.stitching || "inhouse",
             printing: !!d.printing })]);
        out.push(row(rows[0]));
      }
      await client.query("commit");
      return res.status(201).json(out);
    }catch(e){ await client.query("rollback"); throw e; }
    finally{ client.release(); }
  }

  if(req.method === "DELETE"){
    if(req.query.all !== "1") return fail(res, 400, "refusing to delete everything without ?all=1");
    await q("delete from orders");
    return res.status(200).json({ deleted: "all" });
  }

  return fail(res, 405, `${req.method} not allowed`);
});
