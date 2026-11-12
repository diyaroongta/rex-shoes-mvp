/* The Raw Material Store's day register — what was received and issued, and
 * on which day. Served from /api/reference?resource=store_register for the
 * twelve-function reason purchase orders and material issues are.
 *
 * The client's stock sheet has a REC. / ISSUE pair for every day of the month;
 * the register only ever kept running totals, so "50 issued on the 2nd" had
 * nowhere to go. Each entry here is a row, and — exactly as material issues
 * do — it books the same quantity onto the register in the SAME transaction,
 * inside the reference row lock, so the day register and the stock figure
 * cannot disagree and two people entering at once both land.
 *
 * NO reference_data_history SNAPSHOT, deliberately: a snapshot is the whole
 * reference document and this is the store's most frequent write. The row IS
 * the history, and a wrong one is undone by its own action.
 *
 * GET with ?month=YYYY-MM answers every DATED movement on or after that
 * month's first day, from all three places stock moves: this register,
 * job-card issues and returns, and purchase-order receipts. The month sheet
 * (shared/store-register.js) needs the later ones too, to take them back off
 * today's balance.
 */
import { db, q } from "./db.js";
import { fail } from "./http.js";
import { INPUTS } from "../../shared/inputs.js";
import { validateStoreEntry, bookStoreEntry, entryWarnings } from "../../shared/store-register.js";
import { ensureMaterialIssueTable } from "./material-issues.js";

const TABLE_SQL = `
  create table if not exists store_movements (
    id           bigserial primary key,
    material_key text        not null,
    name         text        not null,
    uom          text        not null,
    type         text        not null check (type in ('rec','issue')),
    qty          numeric     not null check (qty > 0),
    moved_on     date        not null,
    note         text        not null default '',
    moved_by     text,
    created_at   timestamptz not null default now()
  );
  create index if not exists store_movements_day_idx on store_movements (moved_on, id);
  create index if not exists store_movements_material_idx on store_movements (material_key, id)`;
export const ensureStoreMovementTable = (run = q) => run(TABLE_SQL);

const COLUMNS = `id, material_key, name, uom, type, qty, to_char(moved_on,'YYYY-MM-DD') as moved_on,
  note, moved_by, created_at`;
const rowOut = r => ({ ...r, id:Number(r.id), qty:Number(r.qty) });

const lockReference = async client => {
  const { rows } = await client.query("select value from reference_data where id = 1 for update");
  return JSON.parse(JSON.stringify(rows.length ? rows[0].value : INPUTS));
};
const writeReference = (client, ref) => client.query(
  `insert into reference_data (id, value) values (1, $1)
   on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(ref)]);

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

/* A table that does not exist yet has no rows — that is all 42P01 means here. */
const orNone = async run => { try{ return (await run()).rows; }catch(e){ if(e && e.code === "42P01") return []; throw e; } };

export async function storeRegister(req, res){
  const query = req.query || {}, body = req.body || {};

  if(req.method === "GET"){
    const month = String(query.month || "");
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(res, 400, "month must be YYYY-MM");
    const first = `${month}-01`;
    await ensureStoreMovementTable();
    const { rows:entries } = await q(
      `select ${COLUMNS} from store_movements where moved_on >= $1::date order by moved_on, id`, [first]);
    await ensureMaterialIssueTable();
    const jobIssues = await orNone(() => q(
      `select material_key, type, qty, to_char(moved_on,'YYYY-MM-DD') as moved_on, job_id
         from material_issues where moved_on >= $1::date`, [first]));
    const receipts = await orNone(() => q(
      `select po_no, to_char(received_on,'YYYY-MM-DD') as received_on, lines
         from purchase_order_receipts where received_on >= $1::date`, [first]));
    const movements = [
      ...entries.map(r => ({ source:"register", id:Number(r.id), material_key:r.material_key, type:r.type,
                             qty:Number(r.qty), moved_on:r.moved_on })),
      ...jobIssues.map(r => ({ source:"job_card", job_id:Number(r.job_id), material_key:r.material_key,
                               type:r.type, qty:Number(r.qty), moved_on:r.moved_on })),
      ...receipts.flatMap(r => (Array.isArray(r.lines) ? r.lines : []).map(l => ({ source:"purchase_order", po_no:r.po_no,
          material_key:l.material_key, type:"rec", qty:Number(l.quantity ?? l.qty) || 0, moved_on:r.received_on }))),
    ];
    return res.status(200).json({ month, entries:entries.map(rowOut), movements });
  }

  /* One day's entry: received or issued, against one or more items. */
  if(req.method === "POST"){
    const out = await inTransaction(async client => {
      await ensureStoreMovementTable(client.query.bind(client));
      const ref = await lockReference(client);
      const checked = validateStoreEntry(body, ref.materials || {});
      if(!checked.ok) return { rollback:true, status:400, error:checked.problems.slice(0, 10).join("; ") };
      const v = checked.value;
      /* Against the balance the keeper was looking at — after booking,
         "more than the register shows" could never fire. */
      const { warnings, reorder } = entryWarnings(v, ref.materials || {}, ref.stock_meta || {});
      bookStoreEntry(ref, v.type, v.lines);
      await writeReference(client, ref);
      const { rows } = await client.query(
        `insert into store_movements (material_key, name, uom, type, qty, moved_on, note, moved_by)
         select x.material_key, x.name, x.uom, $1::text, x.qty, $2::date, $3::text, $4::text
           from jsonb_to_recordset($5::jsonb) as x(material_key text, name text, uom text, qty numeric)
         returning ${COLUMNS}`,
        [v.type, v.moved_on, v.note || "", req.user?.username || null, JSON.stringify(v.lines)]);
      return { entries:rows.map(rowOut), warnings, reorder };
    });
    if(out.error) return fail(res, out.status, out.error);
    return res.status(201).json(out);
  }

  /* A mis-keyed entry is UNDONE, not overtyped. */
  if(req.method === "DELETE"){
    const id = Number(query.id ?? body.id);
    if(!Number.isInteger(id) || id <= 0) return fail(res, 400, "id is required");
    const out = await inTransaction(async client => {
      await ensureStoreMovementTable(client.query.bind(client));
      const { rows:[row] } = await client.query(`select ${COLUMNS} from store_movements where id = $1 for update`, [id]);
      if(!row) return { rollback:true, status:404,
        error:`No such entry: ${id}. It may already have been undone — reload the list.` };
      const ref = await lockReference(client);
      const { missing } = bookStoreEntry(ref, row.type, [{ material_key:row.material_key, qty:Number(row.qty) }], -1);
      await writeReference(client, ref);
      await client.query(`delete from store_movements where id = $1`, [id]);
      return { id, undone:true, note: missing.length
        ? `Undone. ${row.name} is no longer on the register, so no stock figure was changed.`
        : `Undone. ${Number(row.qty)} ${row.uom} of ${row.name} ${row.type === "rec" ? "is off the register again" : "is back on the register"}.` };
    });
    if(out.error) return fail(res, out.status, out.error);
    return res.status(200).json(out);
  }

  return fail(res, 405, `${req.method} not allowed`);
}
