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

const cleanOrder = r => ({
  order_no:r.order_no,
  order_date:r.order_date instanceof Date ? r.order_date.toISOString().slice(0,10) : String(r.order_date),
  article_code:r.article_code, priority:r.priority, party:r.party, lines:r.lines, pi:r.pi||{},
});
const stable=value=>Array.isArray(value)?value.map(stable)
  :value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;

/* Materialise the PI master from the live order database. The snapshot remains
   after an order is removed, so issued PIs are an audit record rather than a
   temporary view of today's production queue. */
export async function syncPiMaster(client=null){
  const run=client?client.query.bind(client):q;
  await ensurePiTable(client);
  const { rows } = await run(`select order_no, order_date, article_code, priority, party, lines, pi
    from orders where nullif(pi->>'pi_no','') is not null order by order_no`);
  const groups = new Map();
  for(const raw of rows){
    const r=cleanOrder(raw), no=String(r.pi.pi_no);
    if(!groups.has(no)) groups.set(no,[]);
    groups.get(no).push(r);
  }
  for(const [no, orders] of groups){
    const first=orders[0], liveRevision=Math.max(...orders.map(o=>Number(o.pi.revision)||0));
    const status=orders.every(o=>o.pi.production_status==="produced")?"produced":"edited";
    const {rows:prior}=await run("select snapshot, revision, status from proforma_invoices where pi_no = $1 for update",[no]);
    const revision=Math.max(liveRevision,Number(prior[0]&&prior[0].revision)||0);
    const snapshot=mergePiSnapshot(prior[0]&&prior[0].snapshot,orders);
    if(prior.length && JSON.stringify(stable(prior[0].snapshot))!==JSON.stringify(stable(snapshot)))
      await run(`insert into proforma_invoice_revisions (pi_no, revision, status, snapshot)
        values ($1,$2,$3,$4)`,[no,Number(prior[0].revision)||0,prior[0].status||"produced",JSON.stringify(prior[0].snapshot)]);
    await run(`insert into proforma_invoices (pi_no, pi_date, party, status, revision, snapshot)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (pi_no) do update set pi_date=$2, party=$3, status=$4,
        revision=$5, snapshot=$6, updated_at=now()`,
      [no, first.order_date, [...new Set(orders.map(o=>o.party))].join(", "), status, revision,
       JSON.stringify(snapshot)]);
  }
}
