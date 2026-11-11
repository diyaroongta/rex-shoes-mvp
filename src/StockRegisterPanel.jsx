import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import * as api from "./lib/client.js";
import { sizeRank } from "../shared/upper-store.js";

const fmt = n => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const input = "border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white";
const LABEL = { FG:"finished goods", UPPER:"upper stock" };

/* ON HAND, RESERVED, FREE — the three numbers behind every stock decision.
 *
 *   on hand   what the store's own ledger adds up to
 *   reserved  spoken for by an order and not yet dispatched / issued
 *   free      on hand less reserved, less what is kept for a party
 *
 * Only FREE stock is ever offered to a new order. Nothing here is typed over:
 * on hand comes from the store's movements, reserved from the reservation
 * ledger, and both are worked out on the server. The one thing set on this
 * screen is a PARTY LOCK — stock kept for one customer and offered to that
 * customer's orders only.
 */
export default function StockRegisterPanel({ store, canLock = false, active = true }){
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [locking, setLocking] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load(){
    try{ setPlan(await api.getStockPlan()); setErr(""); }
    catch(e){ setErr(String(e.message || e)); }
  }
  useEffect(() => { if(active) load(); }, [active, store]);

  const rows = useMemo(() => {
    const list = ((plan && plan.register && plan.register[store]) || [])
      .filter(r => !filter || `${r.article} ${r.colour}`.toUpperCase().includes(filter.toUpperCase()));
    const rank = s => { const r = sizeRank(s); return r == null ? 999 : r; };
    return [...list].sort((a, z) => a.article.localeCompare(z.article) || a.colour.localeCompare(z.colour)
      || rank(a.size) - rank(z.size) || String(a.size).localeCompare(String(z.size), undefined, { numeric:true }));
  }, [plan, store, filter]);
  const total = f => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);

  function exportXlsx(){
    const header = ["Article", ...(store === "UPPER" ? ["Colour"] : []), "Size", "On hand", "Reserved", "Reserved for", "Kept for party", "Free"];
    const body = rows.map(r => [r.article, ...(store === "UPPER" ? [r.colour] : []), r.size, r.on_hand, r.reserved,
      r.orders.map(o => `${o.order_no} ${o.pairs}`).join(", "),
      r.party_locks.map(l => `${l.party} ${l.qty}`).join(", "), r.free]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), store === "FG" ? "FINISHED GOODS" : "UPPER STOCK");
    XLSX.writeFile(wb, store === "FG" ? "finished-goods-reserved-free.xlsx" : "upper-stock-reserved-free.xlsx");
  }

  async function saveLock(){
    setBusy(true); setErr("");
    try{
      await api.lockStockForParty({ store, article:locking.row.article, colour:locking.row.colour, size:locking.row.size,
        party:locking.party, qty:Number(locking.qty) || 0 });
      setLocking(null); await load();
    }catch(e){ setErr(String(e.message || e).replace(/^\d+ — /, "")); }
    finally{ setBusy(false); }
  }

  if(!plan) return <div className="text-sm text-slate-500 py-6 text-center">{err || "Loading the register…"}</div>;
  return <div>
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by article" aria-label="Filter by article"
        className={`${input} w-56`} />
      <span className="text-xs text-slate-500">On hand <b className="mono text-slate-800">{fmt(total(r => r.on_hand))}</b></span>
      <span className="text-xs text-slate-500">Reserved <b className="mono text-amber-700">{fmt(total(r => r.reserved))}</b></span>
      <span className="text-xs text-slate-500">Kept for a party <b className="mono text-sky-700">{fmt(total(r => r.locked))}</b></span>
      <span className="text-xs text-slate-500">Free <b className="mono text-emerald-700">{fmt(total(r => r.free))}</b></span>
      <button onClick={exportXlsx} disabled={!rows.length}
        className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50">Export .xlsx</button>
    </div>
    <p className="text-xs text-slate-500 mb-3">
      Only <b>free</b> {LABEL[store]} is offered to a new order. Reserved pairs belong to the order named beside them until they are
      {store === "FG" ? " dispatched" : " issued to moulding"}, the order is cancelled or closed short, or the planner changes the decision.
      {store === "UPPER" && " Uppers stitched for an order still in work are held for that order."}</p>
    {err && <div role="alert" className="mb-2 text-xs font-semibold text-rose-700">{err}</div>}
    {!rows.length
      ? <div className="text-sm text-slate-500 text-center py-8">Nothing on hand{filter ? " matches that filter" : ""}.</div>
      : <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm" aria-label={`${LABEL[store]} — on hand, reserved and free`}>
          <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
            <th className="text-left px-3 py-2">Article</th>{store === "UPPER" && <th className="text-left px-3 py-2">Colour</th>}
            <th className="text-left px-3 py-2">Size</th><th className="text-right px-3 py-2">On hand</th>
            <th className="text-right px-3 py-2">Reserved</th><th className="text-left px-3 py-2">Reserved for</th>
            <th className="text-left px-3 py-2">Kept for party</th><th className="text-right px-3 py-2">Free</th>
            {canLock && <th className="px-3 py-2" />}</tr></thead>
          <tbody>{rows.map(r => <React.Fragment key={r.key}>
            <tr className="border-t border-slate-100 align-top">
              <td className="px-3 py-1.5">{r.article}</td>{store === "UPPER" && <td className="px-3 py-1.5 text-xs">{r.colour || "—"}</td>}
              <td className="px-3 py-1.5 mono">{r.size}</td>
              <td className="px-3 py-1.5 mono text-right">{fmt(r.on_hand)}</td>
              <td className="px-3 py-1.5 mono text-right text-amber-700">{r.reserved ? fmt(r.reserved) : "—"}</td>
              <td className="px-3 py-1.5 text-xs mono text-slate-600">{r.orders.map(o => `${o.order_no} · ${fmt(o.pairs)}`).join(", ") || "—"}</td>
              <td className="px-3 py-1.5 text-xs text-sky-800">{r.party_locks.map(l => `${l.party} · ${fmt(l.qty)}`).join(", ") || "—"}</td>
              <td className="px-3 py-1.5 mono text-right font-semibold text-emerald-700">{fmt(r.free)}</td>
              {canLock && <td className="px-3 py-1.5 text-right">
                <button onClick={() => setLocking(locking && locking.row.key === r.key ? null
                    : { row:r, party:(r.party_locks[0] || {}).party || "", qty:(r.party_locks[0] || {}).qty || "" })}
                  className="text-xs font-semibold text-indigo-700 hover:underline">
                  {locking && locking.row.key === r.key ? "Cancel" : r.party_locks.length ? "Change lock" : "Keep for a party"}</button></td>}
            </tr>
            {locking && locking.row.key === r.key && <tr><td colSpan={store === "UPPER" ? 9 : 8} className="px-3 pb-3">
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 flex items-end gap-3 flex-wrap">
                <label className="text-xs text-slate-600">Party
                  <input value={locking.party} onChange={e => setLocking({ ...locking, party:e.target.value })}
                    aria-label="Party the stock is kept for" className={`${input} block w-56 mt-0.5`} /></label>
                <label className="text-xs text-slate-600">Pairs to keep (0 removes the lock)
                  <input type="number" min="0" value={locking.qty} onChange={e => setLocking({ ...locking, qty:e.target.value })}
                    aria-label="Pairs kept for the party" className={`${input} block w-28 mt-0.5`} /></label>
                <button disabled={busy || !locking.party.trim()} onClick={saveLock}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-700 text-white disabled:opacity-50">Save lock</button>
                <span className="text-xs text-slate-500">Kept stock is offered to that party's orders only.</span>
              </div></td></tr>}
          </React.Fragment>)}</tbody>
        </table></div>}
    {store === "FG" && !!(plan.fg_sizes_unknown || []).length && <p className="mt-2 text-xs text-amber-800">
      Not listed: {plan.fg_sizes_unknown.map(a => `${fmt(a.pairs)} pairs of ${a.article}`).join(", ")} came back on a part-received stock card,
      so their sizes are not known yet and they cannot be offered to an order.</p>}
  </div>;
}
