import { q, db } from "../_lib/db.js";
import { fail, wrap } from "../_lib/http.js";
import { INPUTS as SEED } from "../../shared/inputs.js";
import { ensurePiTable, syncPiMaster } from "../_lib/pis.js";
import { comboSizesForArticle, setReference } from "../../shared/bridge.js";

/* Validate against the reference data actually in use, not the bundled seed.
   An article uploaded through Data & BOM lives in the database — validating
   against the seed rejected orders for it as "unknown article_code", which is
   why a saved PI could vanish instead of reaching the order sheet. */
async function reference(){
  const { rows } = await q("select value from reference_data where id = 1");
  const ref=rows.length && rows[0].value && rows[0].value.articles?rows[0].value:SEED;
  setReference(ref);
  return ref;
}

const row = r => ({
  order_no: r.order_no,
  order_date: r.order_date instanceof Date ? r.order_date.toISOString().slice(0,10) : String(r.order_date),
  article_code: r.article_code,
  priority: r.priority,
  party: r.party,
  lines: r.lines,
  pi: r.pi,
  // Manual planning instructions for this order. The browser feeds them
  // straight back into compute(), so an override that is not mapped here is an
  // override the plan never sees.
  plan_override: r.plan_override || {},
  version: r.version,
});

function validDate(value){
  const s=String(value||""); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d]=s.split("-").map(Number), dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}

/* Reject anything the planner can't price. An unknown combo would consume
   machine capacity but order zero material — a silent under-buy. */
function validate(o, INPUTS){
  if(!o || typeof o !== "object") return "order must be an object";
  const art = INPUTS.articles[o.article_code];
  if(!art) return `unknown article_code: ${o.article_code}`;
  if(!validDate(o.order_date)) return "order_date must be a real date in YYYY-MM-DD";
  const p = Number(o.priority);
  if(!Number.isInteger(p) || p < 1 || p > 3) return "priority must be 1, 2 or 3";
  if(typeof o.party!=="string"||!o.party.trim()) return "party is required";
  if(!Array.isArray(o.lines) || !o.lines.length) return "at least one line is required";
  for(const l of o.lines){
    if(!art.combos[l.combo]) return `unknown combo "${l.combo}" for article ${o.article_code}`;
    if(!Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0) return `line ${l.combo}: qty must be a whole number above 0`;
    if(l.sizes != null){
      if(typeof l.sizes !== "object" || Array.isArray(l.sizes)) return `line ${l.combo}: sizes must be an object`;
      let exact=0;
      const allowed=new Set(comboSizesForArticle(o.article_code,l.combo,l.vl||o.pi?.vl));
      for(const [size,qty] of Object.entries(l.sizes)){
        if(!String(size).trim()) return `line ${l.combo}: size cannot be blank`;
        const n=Number(qty);
        if(!allowed.has(String(size))) return `line ${l.combo}: size ${size} is not inside that range (${[...allowed].join(", ")})`;
        if(!Number.isInteger(n)||n<0) return `line ${l.combo} size ${size}: qty must be a whole number of 0 or more`;
        exact+=n;
      }
      if(Math.abs(exact-Number(l.qty))>1e-6)
        return `line ${l.combo}: exact-size quantities total ${exact}, not ${Number(l.qty)}`;
    }
  }
  return null;
}

export default wrap(async (req, res) => {
  if(req.method === "GET"){
    const { rows } = await q(
      `select order_no, order_date, article_code, priority, party, lines, pi, plan_override
         , version from orders where active order by order_no`);
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
      const numbered=drafts.filter(d=>String(d.pi?.pi_no||"").trim());
      const partiesByPi=new Map();
      for(const d of numbered){
        const no=String(d.pi.pi_no).trim(), party=String(d.party).trim();
        if(partiesByPi.has(no)&&partiesByPi.get(no)!==party){
          await client.query("rollback");
          return fail(res,409,`PI ${no} cannot belong to both ${partiesByPi.get(no)} and ${party}`);
        }
        partiesByPi.set(no,party);
      }
      const piNos=[...partiesByPi.keys()];
      if(piNos.length){
        await ensurePiTable(client);
        // Serialise creators of the same human-visible PI number. Without this
        // lock two simultaneous browser tabs can both pass the existence check
        // and the PI materialiser then merges unrelated orders.
        for(const no of [...piNos].sort())
          await client.query("select pg_advisory_xact_lock(hashtext($1))",[no]);
        /* A collision is answered with WHAT IT COLLIDED WITH.
           "Request a new PI number" is right for one case — a genuinely new PI
           that happened to land on a taken number — and actively harmful for
           the far commoner one: re-saving a PI that has already been imported.
           Following that advice there files a SECOND copy of the same customer
           order under an invented number, and every pair is then counted twice
           in production, procurement and dispatch. So the answer names the
           customer, when it was filed and which orders it already created, and
           says plainly what saving again would do. */
        const {rows:used}=await client.query(`
          with hit as (
            select pi_no from proforma_invoices where pi_no = any($1::text[])
            union
            select distinct pi->>'pi_no' as pi_no from orders where pi->>'pi_no' = any($1::text[])
          )
          select h.pi_no, p.party, p.status, p.created_at,
                 (select count(*) from orders o where o.pi->>'pi_no' = h.pi_no) as order_count,
                 (select string_agg(o.order_no, ', ' order by o.order_no)
                    from orders o where o.pi->>'pi_no' = h.pi_no) as order_nos
          from hit h left join proforma_invoices p on p.pi_no = h.pi_no
          order by h.pi_no`,[piNos]);
        if(used.length){
          await client.query("rollback");
          return fail(res,409,piCollisionMessage(used));
        }
      }
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
      await syncPiMaster(client);
      await client.query("commit");
      return res.status(201).json(out);
    }catch(e){ await client.query("rollback"); throw e; }
    finally{ client.release(); }
  }

  if(req.method === "DELETE"){
    if(req.query.all !== "1") return fail(res, 400, "refusing to delete everything without ?all=1");
    await q("update orders set active=false, version=version+1, updated_at=now() where active");
    return res.status(200).json({ archived: "all" });
  }

  return fail(res, 405, `${req.method} not allowed`);
});

/* Written for the clerk looking at the screen, not for a log. */
function piCollisionMessage(rows){
  const one = rows.length === 1;
  const parts = rows.map(r => {
    const bits = [`${r.pi_no} is already on the system`];
    if(r.party) bits.push(`for ${r.party}`);
    if(r.created_at){
      const d = new Date(r.created_at);
      if(!isNaN(d)) bits.push(`filed ${d.toISOString().slice(0,10)}`);
    }
    const n = Number(r.order_count) || 0;
    let line = bits.join(" ") + ".";
    if(n) line += ` It already created ${n} order${n===1?"":"s"}${r.order_nos?` (${r.order_nos})`:""}.`;
    return line;
  });
  const anyOrders = rows.some(r => Number(r.order_count) > 0);
  const tail = anyOrders
    ? " Nothing has been saved. If this is the same PI you already imported, it is done — open it in the PI database. "
      + "Saving it again under a different number would file a SECOND copy of the same order, and every pair would be "
      + "counted twice in production, procurement and dispatch. Only change the number if this is genuinely a different PI."
    : " Nothing has been saved. Use a different PI number, or open the existing one in the PI database.";
  return (one ? parts[0] : `These PI numbers are already on the system. ${parts.join(" ")}`) + tail;
}
