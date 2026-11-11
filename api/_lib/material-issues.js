/* Material issues — the store's log of which material went to which job card.
 *
 * Served from /api/reference?resource=material_issues, for the twelve-function
 * reason purchase orders are: the helper lives under _lib/, which Vercel does
 * not count. It is NOT reference data. Its own table holds one row per
 * movement, and every write books the same quantity onto the stock register in
 * the SAME transaction, inside the reference row lock — so the log and the
 * register cannot disagree, and two people issuing at once both land.
 *
 * NO reference_data_history SNAPSHOT IS TAKEN HERE, deliberately. A snapshot
 * is the whole reference document, and an issue is the store's most frequent
 * write: one per hand-over, all day. That is how the database reached its
 * storage cap once already. The movement row IS the history, and a wrong one
 * is undone by its own action.
 */
import { db, q } from "./db.js";
import { fail } from "./http.js";
import { INPUTS } from "../../shared/inputs.js";
import { validateMovement, releaseLines, bookMovements, undoProblem,
         cardLedger, movementWarnings } from "../../shared/material-issues.js";

/* Created on first use, like the purchase-order tables, so the feature does
   not wait on somebody running schema.sql against the live database. One
   statement string: a single round trip. Mirrored in db/schema.sql. */
const TABLE_SQL = `
  create table if not exists material_issues (
    id           bigserial primary key,
    job_id       bigint      not null references job_work(id) on delete restrict,
    material_key text        not null,
    name         text        not null,
    uom          text        not null,
    type         text        not null check (type in ('issue','return')),
    basis        text        not null check (basis in ('job_order','on_demand')),
    qty          numeric     not null check (qty > 0),
    moved_on     date        not null,
    note         text        not null default '',
    moved_by     text,
    created_at   timestamptz not null default now()
  );
  create index if not exists material_issues_job_idx on material_issues (job_id, id);
  create index if not exists material_issues_material_idx on material_issues (material_key, id)`;
export const ensureMaterialIssueTable = (run = q) => run(TABLE_SQL);

/* `moved_on` is formatted IN SQL. node-postgres hands a `date` back as a Date
   at local midnight, and toISOString() on that rolls it to the day before
   anywhere east of Greenwich. */
const COLUMNS = `id, job_id, material_key, name, uom, type, basis, qty,
  to_char(moved_on,'YYYY-MM-DD') as moved_on, note, moved_by, created_at`;
const rowOut = r => ({ ...r, id:Number(r.id), job_id:Number(r.job_id), qty:Number(r.qty) });

const lockReference = async client => {
  const { rows } = await client.query("select value from reference_data where id = 1 for update");
  return JSON.parse(JSON.stringify(rows.length ? rows[0].value : INPUTS));
};
const writeReference = (client, ref) => client.query(
  `insert into reference_data (id, value) values (1, $1)
   on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(ref)]);

/* One INSERT for every line of a movement. Names and units come from the
   material register, never from the browser. */
const insertLines = (client, { job_id, type, basis, moved_on, note, by, lines }) => client.query(
  `insert into material_issues (job_id, material_key, name, uom, type, basis, qty, moved_on, note, moved_by)
   select $1::bigint, x.material_key, x.name, x.uom, $2::text, $3::text, x.qty,
          coalesce($4::date, current_date), $5::text, $6::text
     from jsonb_to_recordset($7::jsonb) as x(material_key text, name text, uom text, qty numeric)
   returning ${COLUMNS}`,
  [job_id, type, basis, moved_on || null, note || "", by || null, JSON.stringify(lines)]);

async function inTransaction(work){
  const client = await db().connect();
  try{
    await client.query("begin");
    const out = await work(client);
    await client.query(out && out.rollback ? "rollback" : "commit");
    return out;
  }catch(e){
    try{ await client.query("rollback"); }catch(_){ }
    throw e;
  }finally{ client.release(); }
}

/* RAISING A JOB CARD RELEASES ITS BY-JOB-ORDER MATERIALS.
   Called by the job-order endpoint straight after the card is stored. The
   quantities are derived HERE from the stored card and the BOM — the browser
   used to send a new running Issued total built from its own copy of the
   register, so two cards raised from two screens overwrote each other. An
   on-demand material is left alone and named in the answer. */
export async function releaseForJob(job, issuedOn, username){
  const cardLines = ((job || {}).card || {}).lines || [];
  if(!cardLines.length) return { ok:true, released:0, on_demand:0, no_card:true };
  return inTransaction(async client => {
    await ensureMaterialIssueTable(client.query.bind(client));
    const ref = await lockReference(client);
    const { released, on_demand } = releaseLines(cardLines, (ref.articles || {})[job.article],
      ref.stock_meta || {}, ref.materials || {});
    const known = released.filter(line => (ref.materials || {})[line.material_key]);
    if(known.length){
      bookMovements(ref, "issue", known);
      await writeReference(client, ref);
      await insertLines(client, { job_id:job.id, type:"issue", basis:"job_order", moved_on:issuedOn,
        note:`Released with job card ${job.id}`, by:username, lines:known });
    }
    /* A BOM material the register does not hold cannot be booked out of it.
       Counted and named rather than dropped, so the card's message says so. */
    const unknown = released.filter(line => !(ref.materials || {})[line.material_key]);
    return { ok:true, released:known.length, on_demand:on_demand.length,
      on_demand_materials:on_demand.slice(0, 30).map(line => line.name),
      ...(unknown.length ? { not_on_register:unknown.slice(0, 30).map(line => line.name) } : {}) };
  });
}

/* DELETING A MIS-KEYED JOB CARD takes its automatic release back with it: the
   card "should never have existed", so the material never left. Anything the
   store issued or took back BY HAND against it is a real event somebody
   recorded, and blocks the delete until it is undone on purpose. */
export async function undoReleaseForJob(jobId){
  let rows;
  try{
    ({ rows } = await q(`select id, basis from material_issues where job_id = $1`, [jobId]));
  }catch(e){
    if(e && e.code === "42P01") return { ok:true, reversed:0 };   // no log yet, so nothing to take back
    throw e;
  }
  if(!rows.length) return { ok:true, reversed:0 };
  const byHand = rows.filter(r => r.basis !== "job_order").length;
  if(byHand) return { ok:false, error:`${byHand} material issue${byHand === 1 ? " was" : "s were"} recorded by hand `
    + `against job card ${jobId}. Undo ${byHand === 1 ? "it" : "them"} on Issue Material first — `
    + `deleting the card would leave that material booked out against nothing.` };
  return inTransaction(async client => {
    const { rows:gone } = await client.query(
      `delete from material_issues where job_id = $1 and basis = 'job_order'
       returning material_key, qty`, [jobId]);
    const ref = await lockReference(client);
    bookMovements(ref, "return", gone.map(r => ({ material_key:r.material_key, qty:Number(r.qty) })));
    await writeReference(client, ref);
    return { ok:true, reversed:gone.length };
  });
}

export async function materialIssues(req, res){
  const query = req.query || {}, body = req.body || {};

  if(req.method === "GET"){
    await ensureMaterialIssueTable();
    const jobId = query.job_id == null || query.job_id === "" ? null : Number(query.job_id);
    if(jobId != null && !Number.isInteger(jobId)) return fail(res, 400, "job_id must be a job card number");
    const key = query.material_key == null || query.material_key === "" ? null : String(query.material_key);
    const { rows } = await q(
      `select m.id, m.job_id, m.material_key, m.name, m.uom, m.type, m.basis, m.qty,
              to_char(m.moved_on,'YYYY-MM-DD') as moved_on, m.note, m.moved_by, m.created_at,
              j.fabricator, j.article, j.order_no
         from material_issues m left join job_work j on j.id = m.job_id
        where ($1::bigint is null or m.job_id = $1::bigint)
          and ($2::text is null or m.material_key = $2::text)
        order by m.id desc limit 5000`, [jobId, key]);
    return res.status(200).json(rows.map(rowOut));
  }

  /* The store hands material over, or takes it back, against a job card. */
  if(req.method === "POST"){
    const jobId = Number(body.job_id);
    if(!Number.isInteger(jobId) || jobId <= 0) return fail(res, 400, "Choose the job card this material is for");
    const out = await inTransaction(async client => {
      await ensureMaterialIssueTable(client.query.bind(client));
      /* The job row is locked first, so two entries against one card are
         checked one after the other — a return is bounded by what the card
         holds, and that has to be the figure after the other entry landed. */
      const { rows:[job] } = await client.query(
        `select id, article, order_no, fabricator, card, coalesce(cancelled,false) as cancelled
           from job_work where id = $1 for update`, [jobId]);
      if(!job) return { rollback:true, status:404,
        error:`No job card ${jobId} was found. It may have been deleted — reload the list.` };
      const { rows:prior } = await client.query(
        `select id, material_key, type, qty from material_issues where job_id = $1`, [jobId]);
      const ref = await lockReference(client);
      const checked = validateMovement(body, { job:{ ...job, id:jobId }, materials:ref.materials || {}, prior });
      if(!checked.ok) return { rollback:true, status:400, error:checked.problems.slice(0, 10).join("; ") };
      const v = checked.value;
      /* Worked out BEFORE the booking, against the stock the keeper was
         looking at — after it, "more than the register shows" could not fire. */
      const warnings = movementWarnings(v,
        cardLedger(job, (ref.articles || {})[job.article], prior, ref.stock_meta || {}, ref.materials || {}),
        ref.materials || {}, ref.stock_meta || {});
      bookMovements(ref, v.type, v.lines);
      await writeReference(client, ref);
      const { rows } = await insertLines(client, { job_id:jobId, type:v.type, basis:"on_demand",
        moved_on:v.moved_on, note:v.note, by:req.user?.username, lines:v.lines });
      return { movements:rows.map(rowOut).sort((a, z) => a.id - z.id), warnings };
    });
    if(out.error) return fail(res, out.status, out.error);
    return res.status(201).json(out);
  }

  /* A mis-keyed entry is UNDONE, not overtyped: the row goes and the register
     gets the quantity back, in one transaction. */
  if(req.method === "DELETE"){
    const id = Number(query.id ?? body.id);
    if(!Number.isInteger(id) || id <= 0) return fail(res, 400, "id is required");
    const out = await inTransaction(async client => {
      await ensureMaterialIssueTable(client.query.bind(client));
      const { rows:[row] } = await client.query(
        `select id, job_id, material_key, name, uom, type, qty from material_issues where id = $1 for update`, [id]);
      if(!row) return { rollback:true, status:404,
        error:`No such entry: ${id}. It may already have been undone — reload the list.` };
      const { rows:sameJob } = await client.query(
        `select id, material_key, type, qty from material_issues where job_id = $1`, [row.job_id]);
      const problem = undoProblem(row, sameJob);
      if(problem) return { rollback:true, status:409, error:problem };
      const ref = await lockReference(client);
      const { missing } = bookMovements(ref, row.type === "return" ? "issue" : "return",
        [{ material_key:row.material_key, qty:Number(row.qty) }]);
      await writeReference(client, ref);
      await client.query(`delete from material_issues where id = $1`, [id]);
      return { id, undone:true, note: missing.length
        ? `Undone. ${row.name} is no longer on the material register, so no stock figure was changed.`
        : `Undone. ${Number(row.qty)} ${row.uom} of ${row.name} ${row.type === "return" ? "is out against the card again" : "is back on the register"}.` };
    });
    if(out.error) return fail(res, out.status, out.error);
    return res.status(200).json(out);
  }

  return fail(res, 405, `${req.method} not allowed`);
}
