import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { allocationSummary } from "../shared/stock-plan.js";

const fmt = n => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const num = v => Math.max(0, Math.round(Number(v) || 0));
const input = "w-16 text-right mono text-xs border border-slate-300 rounded px-1 py-0.5 bg-white";

/* STOCK FIRST — on the Order Book, above the orders.
 *
 * A new order that something on the shelf matches stops here until the planner
 * decides: use the ready stock (finished goods first, then uppers) or ignore
 * it and make everything. Until then no job card can be raised for it, because
 * nobody yet knows how many pairs are to be made.
 *
 * The figures are the SERVER's, read fresh when a panel opens, and checked
 * again inside the transaction that reserves them — so two planners reaching
 * for the same 40 pairs cannot both be told yes. The second is shown the
 * numbers as they now stand.
 */
export default function StockDecisions({ orders = [], canDecide = false, onChanged }){
  const waiting = useMemo(() => orders.filter(o => o.stock_status === "awaiting"), [orders]);
  const using = useMemo(() => orders.filter(o => o.stock_allocation && o.stock_allocation.mode === "use"), [orders]);
  const [summary, setSummary] = useState({});
  const [open, setOpen] = useState(null);
  const [showUsing, setShowUsing] = useState(false);
  const [msg, setMsg] = useState("");
  const key = waiting.map(o => o.order_no).join("|");

  /* Only asked for when something is actually waiting: an Order Book with no
     decisions pending makes no request at all. */
  useEffect(() => {
    if(!waiting.length){ setSummary({}); return; }
    let live = true;
    Promise.resolve().then(() => api.getStockPlan()).then(plan => {
      if(live) setSummary(Object.fromEntries(((plan && plan.awaiting) || []).map(r => [r.order_no, r])));
    }).catch(() => { /* the panel itself reports a failure; the badge just stays plain */ });
    return () => { live = false; };
  }, [key]);

  if(!waiting.length && !using.length) return null;
  const done = async text => { setOpen(null); setMsg(text); if(onChanged) await onChanged(); };

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-4" data-noprint>
    {!!waiting.length && <>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-semibold text-slate-700">Needs a stock decision</div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
          aria-label={`${waiting.length} order${waiting.length === 1 ? "" : "s"} awaiting a stock decision`}>{waiting.length}</span>
        <div className="text-xs text-slate-500">Ready stock matches these orders. Decide before a job order is raised — only the balance is produced.</div>
      </div>
      <div className="mt-2 divide-y divide-slate-100">
        {waiting.map(o => {
          const s = summary[o.order_no];
          return <div key={o.order_no} className="py-2">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="mono font-semibold text-slate-800">{o.order_no}</span>
              <span className="text-slate-600">{o.party}</span>
              <span className="text-slate-500">{o.article_code}</span>
              {s && <span className="font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Ready stock: {fmt(s.ready_pairs)} pairs · {s.sizes_with_stock} of {s.sizes} sizes</span>}
              <button onClick={() => setOpen(open === o.order_no ? null : o.order_no)}
                className="cta-row ml-auto">
                {open === o.order_no ? "Close" : canDecide ? "Decide" : "View"}</button>
            </div>
            {open === o.order_no && <StockDecisionPanel order={o} canDecide={canDecide} onDone={done} />}
          </div>;
        })}
      </div>
    </>}

    {!!using.length && <div className={waiting.length ? "mt-3 pt-3 border-t border-slate-100" : ""}>
      <button onClick={() => setShowUsing(v => !v)} className="text-xs font-semibold text-slate-600 hover:underline">
        {showUsing ? "Hide" : "Show"} {using.length} order{using.length === 1 ? "" : "s"} using ready stock</button>
      {showUsing && <div className="mt-2 divide-y divide-slate-100">
        {using.map(o => {
          const a = allocationSummary(o);
          return <div key={o.order_no} className="py-2">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="mono font-semibold text-slate-800">{o.order_no}</span>
              <span className="text-slate-600">{o.party}</span>
              <span className="text-slate-500">{o.article_code}</span>
              <span className="mono text-slate-700">{fmt(a.ordered)} ordered · <b className="text-emerald-700">{fmt(a.fg)}</b> from finished goods
                · <b className="text-sky-700">{fmt(a.upper)}</b> from uppers (start at moulding) · <b>{fmt(a.produce)}</b> to produce in full</span>
              {canDecide && <button onClick={() => setOpen(open === o.order_no ? null : o.order_no)}
                className="ml-auto font-semibold text-indigo-700 hover:underline">{open === o.order_no ? "Close" : "Change"}</button>}
            </div>
            {open === o.order_no && <StockDecisionPanel order={o} canDecide={canDecide} onDone={done} />}
          </div>;
        })}
      </div>}
    </div>}
    {msg && <div role="status" className="mt-2 text-xs text-emerald-800">{msg}</div>}
  </div>;
}

/* One row per ordered size: what is free, what to use, what is left to make.
   The Use boxes start at the most that can be used — finished goods first,
   then uppers of the same size, then uppers one size larger — and are the
   planner's to change. */
export function StockDecisionPanel({ order, canDecide, onDone }){
  const [check, setCheck] = useState(null);
  const [use, setUse] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load(){
    try{
      const c = await api.getStockCheck(order.order_no);
      setCheck(c);
      setUse(Object.fromEntries(c.rows.map(r => [r.size, { fg:r.use_fg, upper:{ ...r.use_upper } }])));
    }catch(e){ setErr(String(e.message || e)); }
  }
  useEffect(() => { load(); }, [order.order_no]);

  if(!check) return <div className="mt-2 text-xs text-slate-500">{err || "Checking finished goods and upper stock…"}</div>;

  const key = s => String(s).toLowerCase();
  const of = r => use[r.size] || { fg:0, upper:{} };
  const upperOf = (r, from) => num((of(r).upper || {})[key(from)]);
  const set = (r, patch) => setUse(u => ({ ...u, [r.size]:{ ...of(r), ...patch } }));
  const setUpper = (r, from, v) => set(r, { upper:{ ...(of(r).upper || {}), [key(from)]:v } });
  const used = r => num(of(r).fg) + Object.values(of(r).upper || {}).reduce((a, n) => a + num(n), 0);
  const totals = check.rows.reduce((t, r) => ({
    fg:t.fg + num(of(r).fg), upper:t.upper + used(r) - num(of(r).fg), produce:t.produce + (r.ordered - used(r)) }),
    { fg:0, upper:0, produce:check.unsized || 0 });
  const over = check.rows.filter(r => used(r) > r.ordered);

  async function decide(ignore){
    setBusy(true); setErr("");
    try{
      const sizes = Object.fromEntries(check.rows.map(r => [r.size, { fg:num(of(r).fg),
        upper:Object.fromEntries(Object.entries(of(r).upper || {}).map(([f, n]) => [f, num(n)]).filter(([, n]) => n > 0)) }]));
      const out = await api.decideStock(order.order_no, ignore ? { ignore:true } : { sizes });
      await onDone(ignore
        ? `${order.order_no}: stock ignored — the full ${fmt(check.totals.ordered)} pairs will be produced.`
        : `${order.order_no}: ${fmt(out.reserved_fg)} pairs reserved in finished goods, ${fmt(out.reserved_upper)} uppers reserved. `
          + `Raise job orders for the balance only.`);
    }catch(e){
      /* Refused because the stock moved: show why, then the figures as they
         now stand, with the boxes reset to what can still be used. */
      setErr(String(e.message || e).replace(/^\d+ — /, ""));
      await load();
    }finally{ setBusy(false); }
  }

  return <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
    <div className="text-xs text-slate-600 mb-2">
      <b>{check.article}</b>{check.colour ? <> · upper colour <b>{check.colour}</b></> : <> · <span className="text-amber-700">no upper colour on this order, so no uppers can be matched</span></>}
      {" "}· finished goods are used first, then uppers. An upper may be used for its own size or the size below.
    </div>
    <div className="overflow-x-auto">
      <table className="text-xs w-full" aria-label={`Stock decision for ${order.order_no}`}>
        <thead><tr className="text-slate-500 text-left">
          <th className="pr-3 py-1">Size</th><th className="pr-3 text-right">Ordered</th>
          <th className="pr-3 text-right">FG free</th><th className="pr-3 text-right">Use FG</th>
          <th className="pr-3 text-right">Upper free</th><th className="pr-3 text-right">Use upper</th>
          <th className="pr-3 text-right">Upper free, one size up</th><th className="pr-3 text-right">Use</th>
          <th className="text-right">To produce</th></tr></thead>
        <tbody>{check.rows.map(r => {
          const left = r.ordered - used(r);
          return <tr key={r.size} className="border-t border-indigo-100">
            <td className="pr-3 py-1 mono font-semibold">{r.size}</td>
            <td className="pr-3 text-right mono">{fmt(r.ordered)}</td>
            <td className="pr-3 text-right mono">{fmt(r.fg_free + r.held_fg)}</td>
            <td className="pr-3 text-right"><input type="number" min="0" disabled={!canDecide || busy} className={input}
              aria-label={`Use finished goods for size ${r.size}`} value={of(r).fg}
              onChange={e => set(r, { fg:e.target.value })} /></td>
            <td className="pr-3 text-right mono">{fmt(r.upper_free_own + num(r.held_upper[key(r.size)]))}</td>
            <td className="pr-3 text-right"><input type="number" min="0" disabled={!canDecide || busy} className={input}
              aria-label={`Use size ${r.size} uppers for size ${r.size}`} value={(of(r).upper || {})[key(r.size)] ?? 0}
              onChange={e => setUpper(r, r.size, e.target.value)} /></td>
            <td className="pr-3 text-right mono">{r.upper_size_up
              ? <>{fmt(r.upper_free_up + num(r.held_upper[key(r.upper_size_up)]))} <span className="text-slate-400">size {r.upper_size_up}</span></>
              : <span className="text-slate-300">—</span>}</td>
            <td className="pr-3 text-right">{r.upper_size_up
              ? <input type="number" min="0" disabled={!canDecide || busy} className={input}
                  aria-label={`Use size ${r.upper_size_up} uppers for size ${r.size}`} value={(of(r).upper || {})[key(r.upper_size_up)] ?? 0}
                  onChange={e => setUpper(r, r.upper_size_up, e.target.value)} />
              : <span className="text-slate-300">—</span>}</td>
            <td className="text-right mono font-semibold" style={{ color:left < 0 ? "#be123c" : undefined }}>{fmt(left)}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr className="border-t-2 border-indigo-200 font-semibold">
          <td className="pr-3 py-1">Total</td><td className="pr-3 text-right mono">{fmt(check.totals.ordered)}</td>
          <td /><td className="pr-3 text-right mono text-emerald-700">{fmt(totals.fg)}</td>
          <td /><td colSpan={3} className="pr-3 text-right mono text-sky-700">{fmt(totals.upper)} from uppers</td>
          <td className="text-right mono">{fmt(totals.produce)}</td></tr></tfoot>
      </table>
    </div>
    {check.unsized > 0 && <div className="mt-2 text-xs text-amber-800">
      {fmt(check.unsized)} pairs are on a size range with no sizes named, so they cannot be matched to stock that is counted per size. They are produced in full.</div>}
    {!!(check.upper_other_colours || []).length && <div className="mt-1 text-xs text-slate-500">
      Not offered — uppers of this article in another colour: {check.upper_other_colours.map(c => `${c.colour} ${fmt(c.pairs)}`).join(", ")}.</div>}
    {!!over.length && <div className="mt-2 text-xs font-semibold text-rose-700">
      More than was ordered is set against size {over.map(r => r.size).join(", ")}.</div>}
    {err && <div role="alert" className="mt-2 text-xs font-semibold text-rose-700">{err}</div>}
    {canDecide
      ? <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button disabled={busy || over.length > 0} onClick={() => decide(false)}
            className="cta">Use selected stock</button>
          <button disabled={busy} onClick={() => decide(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50">Ignore stock, plan full order</button>
          <span className="text-xs text-slate-500">Used stock is reserved for {order.order_no}; job orders are raised for the balance only.</span>
        </div>
      : <div className="mt-2 text-xs text-slate-500">Only the Production Planner or an administrator can decide this.</div>}
  </div>;
}
