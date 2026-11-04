import { q } from "./db.js";
import { mergePiSnapshot } from "../../shared/pi-schedule.js";

export async function ensurePiTable(client=null){
  const run=client?client.query.bind(client):q;
  await run(`create table if not exists proforma_invoices (
    pi_no text primary key,
    pi_date date,
    party text,
    status text not null default 'produced',
    revision integer not null default 0,
    snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await run(`create table if not exists proforma_invoice_revisions (
    id bigserial primary key,
    pi_no text not null,
    revision integer not null,
    status text not null,
    snapshot jsonb not null,
    recorded_at timestamptz not null default now()
  )`);
}

/* The uploaded PI's PHOTO stays on the order row, where the order screen
   shows it. It is NOT copied into the PI snapshot: one photo per order of a
   PI, in the snapshot and again in every revision, is how the database
   reached its size limit. */
export const withoutAttachment = pi => {
  if(!pi || typeof pi !== "object" || !("attachment" in pi)) return pi || {};
  const { attachment, ...rest } = pi;
  return rest;
};
export const stripSnapshot = snap => snap && typeof snap === "object" && Array.isArray(snap.orders)
  ? { ...snap, orders: snap.orders.map(o => o && typeof o === "object" ? { ...o, pi: withoutAttachment(o.pi) } : o) }
  : snap;
const cleanOrder = r => ({
  order_no:r.order_no,
  order_date:r.order_date instanceof Date ? r.order_date.toISOString().slice(0,10) : String(r.order_date),
  article_code:r.article_code, priority:r.priority, party:r.party, lines:r.lines, pi:withoutAttachment(r.pi),
});
const stable=value=>Array.isArray(value)?value.map(stable)
  :value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;

/* Materialise the PI master from the live order database. The snapshot remains
   after an order is removed, so issued PIs are an audit record rather than a
   temporary view of today's production queue.

   `only` names the PIs a change touched; the rest are not read or written.
   This used to rewrite EVERY PI on every call — and it was called on every
   load of the PI list and every order save, including a schedule Adjust — so
   each look at the app wrote every snapshot again. An unchanged PI is not
   written at all. Together they filled the database to its size limit, after
   which every save failed with "could not extend file". */
export async function syncPiMaster(client=null, only=null){
  const run=client?client.query.bind(client):q;
  const names=Array.isArray(only)?[...new Set(only.map(n=>String(n||"").trim()).filter(Boolean))]:null;
  if(names&&!names.length) return;
  await ensurePiTable(client);
  const { rows } = await run(`select order_no, order_date, article_code, priority, party, lines, pi
    from orders where nullif(pi->>'pi_no','') is not null
      and ($1::text[] is null or pi->>'pi_no' = any($1::text[])) order by order_no`,[names]);
  const groups = new Map();
  for(const raw of rows){
    const r=cleanOrder(raw), no=String(r.pi.pi_no);
    if(!groups.has(no)) groups.set(no,[]);
    groups.get(no).push(r);
  }
  for(const [no, orders] of groups){
    const first=orders[0], liveRevision=Math.max(...orders.map(o=>Number(o.pi.revision)||0));
    const status=orders.every(o=>o.pi.production_status==="produced")?"produced":"edited";
    const party=[...new Set(orders.map(o=>o.party))].join(", ");
    const {rows:prior}=await run("select snapshot, revision, status, party, pi_date from proforma_invoices where pi_no = $1 for update",[no]);
    const revision=Math.max(liveRevision,Number(prior[0]&&prior[0].revision)||0);
    const snapshot=stripSnapshot(mergePiSnapshot(prior[0]&&prior[0].snapshot,orders));
    const before=prior[0];
    const changed=!before || JSON.stringify(stable(before.snapshot))!==JSON.stringify(stable(snapshot));
    const priorDate=before&&(before.pi_date instanceof Date?before.pi_date.toISOString().slice(0,10):String(before.pi_date||""));
    if(before && !changed && before.status===status && Number(before.revision)===revision
       && before.party===party && priorDate===String(first.order_date)) continue;
    if(before && changed)
      await run(`insert into proforma_invoice_revisions (pi_no, revision, status, snapshot)
        values ($1,$2,$3,$4)`,[no,Number(before.revision)||0,before.status||"produced",JSON.stringify(stripSnapshot(before.snapshot))]);
    await run(`insert into proforma_invoices (pi_no, pi_date, party, status, revision, snapshot)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (pi_no) do update set pi_date=$2, party=$3, status=$4,
        revision=$5, snapshot=$6, updated_at=now()`,
      [no, first.order_date, party, status, revision, JSON.stringify(snapshot)]);
  }
}
