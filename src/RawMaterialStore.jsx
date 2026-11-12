import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import { todayIso } from "./lib/today.js";
import { stockRows } from "./StockTab.jsx";
import { monthSheet, storeDashboard, monthSheetAoa, byCategory, jobMaterialAlerts,
         STORE_MOVE_LABEL } from "../shared/store-register.js";

const fmt = n => (n==null||isNaN(n)) ? "" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:2});
const money = n => n ? "₹" + fmt(Math.round(n)) : "—";
const monthName = m => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"});
const shiftMonth = (m, by) => { const [y, n] = m.split("-").map(Number); const d = new Date(Date.UTC(y, n - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const catOf = r => r.category || "UNCATEGORISED";

/* THE STORE'S SUB-PAGES, one strip on every page of one store. Each entry is
   a menu screen of its own (so permissions and deep links are unchanged); the
   strip is what makes them read as ONE store. */
export function StoreStrip({ title, items }){
  return <div className="mb-3">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{title}</div>
    <div role="tablist" aria-label={title} className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 gap-0.5">
      {items.map(it => <button key={it.label} role="tab" aria-selected={it.on} onClick={it.onClick}
        className="text-sm font-semibold rounded-lg px-4 py-1.5 transition-colors"
        style={it.on ? { background:"#fff", color:"#1e293b", boxShadow:"0 1px 2px rgba(15,23,42,.12)" }
                     : { background:"transparent", color:"#64748b" }}>{it.label}</button>)}
    </div>
  </div>;
}

/* JOB ORDERS WAITING ON MATERIAL — the notification the client asked for
   when a job order is raised against material that is not in the store.
   Derived live (shared/store-register.js), so it clears itself when the
   delivery is booked. */
export function StoreAlerts({ jobs = [], version = 0 }){
  const [issues, setIssues] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { let live = true;
    api.listMaterialIssues().then(r => { if(live){ setIssues(r || []); setErr(""); } })
      .catch(e => live && setErr(String(e.message || e)));
    return () => { live = false; }; }, [version, jobs]);
  const out = useMemo(() => issues ? jobMaterialAlerts(jobs, INPUTS.articles || {}, INPUTS.materials || {},
    INPUTS.stock_meta || {}, issues) : null, [issues, jobs, version]);
  if(err) return <div className="text-[11px] text-slate-500 mb-3">Could not check job orders against stock: {err}</div>;
  if(!out || !out.alerts.length) return null;
  return <div role="alert" className="mb-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
    <b>{out.alerts.length} material{out.alerts.length === 1 ? " is" : "s are"} short for open job orders.</b>{" "}
    Raise a purchase order, or book the delivery in the Issue Register when it arrives — the alert clears itself.
    <ul className="mt-1.5 space-y-0.5">
      {out.alerts.slice(0, 10).map(a => <li key={a.material_key}>
        <b>{a.name}</b> — short <b className="mono">{fmt(a.short)} {a.uom}</b>
        <span className="text-rose-800"> (shelf {fmt(a.balance)}, still to issue {fmt(a.outstanding)}) · job card{a.jobs.length === 1 ? "" : "s"}{" "}
          {a.jobs.slice(0, 6).map(j => `${j.job_id}${j.order_no ? ` (${j.order_no})` : ""}`).join(", ")}{a.jobs.length > 6 ? ` +${a.jobs.length - 6}` : ""}</span>
      </li>)}
      {out.alerts.length > 10 && <li>…and {out.alerts.length - 10} more.</li>}
    </ul>
    {out.uncounted > 0 && <div className="mt-1 text-[11px] text-rose-800">
      {out.uncounted} more material{out.uncounted === 1 ? "" : "s"} needed by open job orders {out.uncounted === 1 ? "has" : "have"} never been
      counted (no opening, receipt or minimum), so {out.uncounted === 1 ? "it is" : "they are"} not called short. Load the stock sheet to fix that.</div>}
  </div>;
}

/* RM STOCK — the factory's STOCK MASTER sheet, month by month. */
export function RmStockSheet({ version = 0 }){
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [cat, setCat] = useState("DASHBOARD");
  const [onlyOrder, setOnlyOrder] = useState(false);
  const [days, setDays] = useState(true);
  const [q, setQ] = useState("");
  useEffect(() => { let live = true; setData(null); setErr("");
    api.storeMonth(month).then(d => live && setData(d)).catch(e => live && setErr(String(e.message || e)));
    return () => { live = false; }; }, [month, version]);

  const rows = useMemo(stockRows, [version, INPUTS.materials, INPUTS.stock_meta]);
  const sheet = useMemo(() => data ? monthSheet(rows, data.movements || [], month) : null, [rows, data, month]);
  const dash = useMemo(() => sheet ? storeDashboard(sheet.rows) : null, [sheet]);
  const cats = useMemo(() => [...new Set(rows.map(catOf))].sort(byCategory), [rows]);
  const future = month > todayIso().slice(0, 7);

  function download(){
    const wb = XLSX.utils.book_new();
    const d = [["STOCK INVENTORY - SUMMARY", "", "", monthName(month).toUpperCase()], [],
      ["CATEGORY","ITEMS","OPENING VALUE","RECEIVED VALUE","ISSUED VALUE","BALANCE VALUE","OPENING QTY","RECEIVED QTY","ISSUED QTY","BALANCE QTY","UNITS","MAKE ORDER"],
      ...dash.categories.map(c => [c.category, c.items, c.opening_value, c.receive_value, c.issue_value, c.balance_value,
        c.units === "MIXED" ? "" : c.opening, c.units === "MIXED" ? "" : c.rec, c.units === "MIXED" ? "" : c.issue,
        c.units === "MIXED" ? "" : c.balance, c.units, c.below_min]),
      ["GRAND TOTAL", dash.totals.items, dash.totals.opening_value, dash.totals.receive_value, dash.totals.issue_value, dash.totals.balance_value]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d), "DASHBOARD");
    for(const c of cats){
      const ws = XLSX.utils.aoa_to_sheet(monthSheetAoa({ ...sheet, rows:sheet.rows.map(r => ({ ...r, category:catOf(r) })) }, c));
      XLSX.utils.book_append_sheet(wb, ws, `${c} MASTER`.slice(0, 31));
    }
    XLSX.writeFile(wb, `stock-sheet-${month}.xlsx`);
  }

  const needle = q.trim().toLowerCase();
  const shown = sheet ? sheet.rows.filter(r => catOf(r) === cat && (!onlyOrder || r.alert === "MAKE ORDER")
    && (!needle || `${r.name} ${r.sku}`.toLowerCase().includes(needle))) : [];
  const TH = "px-2 py-1.5 text-[10.5px] uppercase tracking-wide text-slate-500 font-semibold whitespace-nowrap border-b border-slate-200 bg-slate-50";
  const TD = "px-2 py-1 border-b border-slate-100 whitespace-nowrap";
  const sticky = left => ({ position:"sticky", left, zIndex:1, background:"#fff" });

  return <div>
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month"
        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">◀</button>
      <div className="text-sm font-semibold text-slate-800 min-w-36 text-center">{monthName(month)}</div>
      <button onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month"
        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">▶</button>
      <span className="text-[11px] text-slate-500">Opening + Rec. − Issue = Balance, for the month. Days come from the Issue Register, job-card issues and PO receipts.</span>
      <button onClick={download} disabled={!sheet}
        className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white disabled:opacity-50">Download month (.xlsx)</button>
    </div>
    {future && <div className="text-xs text-slate-500 mb-2">This month has not started; the figures are today's.</div>}
    <div role="tablist" aria-label="Stock sheet" className="flex flex-wrap gap-1 mb-3">
      {["DASHBOARD", ...cats].map(c => {
        const n = c === "DASHBOARD" ? 0 : (sheet ? sheet.rows.filter(r => catOf(r) === c && r.alert === "MAKE ORDER").length : 0);
        return <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 border"
          style={cat === c ? { background:"#0F2233", color:"#fff", borderColor:"#0F2233" } : { background:"#fff", color:"#334155", borderColor:"#cbd5e1" }}>
          {c}{n > 0 && <span className="ml-1.5 rounded-full px-1.5 text-[10px] text-white" style={{ background:"#be123c" }}>{n}</span>}</button>;
      })}
    </div>
    {err && <div role="alert" className="text-xs text-rose-700 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 mb-3">{err}</div>}
    {!sheet && !err && <div className="text-sm text-slate-500">Loading {monthName(month)}…</div>}

    {sheet && cat === "DASHBOARD" && <div>
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))" }}>
        {[["Opening value", dash.categories.reduce((n, c) => n + c.opening_value, 0)], ["Received value", dash.totals.receive_value],
          ["Issued value", dash.totals.issue_value], ["Total stock value (bal.)", dash.totals.balance_value]].map(([l, v]) =>
          <div key={l} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</div>
            <div className="mono text-xl font-semibold text-slate-800">{money(v)}</div></div>)}
        <button onClick={() => { setOnlyOrder(true); setCat(cats.find(c => sheet.rows.some(r => catOf(r) === c && r.alert === "MAKE ORDER")) || "DASHBOARD"); }}
          className="text-left rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Make order</div>
          <div className="mono text-xl font-semibold text-rose-700">{fmt(dash.totals.below_min)}</div></button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm" style={{ borderCollapse:"collapse" }} aria-label="Category-wise stock summary">
          <thead><tr>{["Category","Items","Opening value","Received value","Issued value","Balance value","Opening qty","Received qty","Issued qty","Balance qty","Units","Make order"]
            .map(h => <th key={h} className={TH + (h === "Category" || h === "Units" ? " text-left" : " text-right")}>{h}</th>)}</tr></thead>
          <tbody>{dash.categories.map(c => <tr key={c.category} className="hover:bg-slate-50 cursor-pointer" onClick={() => setCat(c.category)}>
            <td className={TD + " font-semibold"}>{c.category}</td><td className={TD + " text-right mono"}>{c.items}</td>
            {["opening_value","receive_value","issue_value","balance_value"].map(f => <td key={f} className={TD + " text-right mono"}>{money(c[f])}</td>)}
            {["opening","rec","issue","balance"].map(f => <td key={f} className={TD + " text-right mono text-slate-600"}>{c.units === "MIXED" ? "—" : fmt(c[f])}</td>)}
            <td className={TD + " text-slate-500"}>{c.units}</td>
            <td className={TD + " text-right mono " + (c.below_min ? "text-rose-700 font-semibold" : "text-slate-400")}>{c.below_min || "—"}</td></tr>)}
          </tbody>
          <tfoot><tr className="font-semibold"><td className={TD}>Grand total</td><td className={TD + " text-right mono"}>{dash.totals.items}</td>
            {["opening_value","receive_value","issue_value","balance_value"].map(f => <td key={f} className={TD + " text-right mono"}>
              {money(f === "opening_value" ? dash.categories.reduce((n, c) => n + c.opening_value, 0) : dash.totals[f])}</td>)}
            <td colSpan={6} className={TD}/></tr></tfoot>
        </table>
      </div>
      <div className="text-[11px] text-slate-500 mt-2">Quantities are added up only where a category is counted in one unit; a category mixing pairs, kilos and metres shows "—".</div>
    </div>}

    {sheet && cat !== "DASHBOARD" && <div>
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search an item or code…" aria-label="Search the stock sheet"
          className="text-sm border border-slate-300 rounded-lg px-3 py-1.5" style={{ flex:"1 1 200px", maxWidth:300 }}/>
        <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={onlyOrder} onChange={e => setOnlyOrder(e.target.checked)}/> Make order only</label>
        <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={days} onChange={e => setDays(e.target.checked)}/> Daily REC./ISSUE columns</label>
        <span className="text-xs text-slate-500 ml-auto">{shown.length} item{shown.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200" style={{ maxHeight:"70vh" }}>
        <table className="text-xs" style={{ borderCollapse:"separate", borderSpacing:0 }} aria-label={`${cat} stock master`}>
          <thead style={{ position:"sticky", top:0, zIndex:2 }}>
            <tr>
              <th rowSpan={2} className={TH} style={{ ...sticky(0), background:"#f8fafc" }}>S.N</th>
              <th rowSpan={2} className={TH + " text-left"} style={{ ...sticky(36), background:"#f8fafc" }}>Item description</th>
              {["Size","Item code","Opening stock","Min. stock","Rec.","Issue","Balance","UOM","Rate","Opening value","Issue value","Receive value","Balance value","Alert","Order qty"]
                .map(h => <th key={h} rowSpan={2} className={TH + (["Size","Item code","UOM","Alert"].includes(h) ? " text-left" : " text-right")}>{h}</th>)}
              {days && Array.from({ length:sheet.days }, (_, i) => <th key={i} colSpan={2} className={TH + " text-center border-l border-slate-200"}>{i + 1}</th>)}
            </tr>
            <tr>{days && Array.from({ length:sheet.days }, (_, i) => <React.Fragment key={i}>
              <th className={TH + " border-l border-slate-200"}>Rec.</th><th className={TH}>Issue</th></React.Fragment>)}</tr>
          </thead>
          <tbody>{shown.map((r, i) => <tr key={r.key}>
            <td className={TD + " text-slate-400 mono"} style={sticky(0)}>{i + 1}</td>
            <td className={TD + " font-medium text-slate-800"} style={{ ...sticky(36), maxWidth:260, overflow:"hidden", textOverflow:"ellipsis" }} title={r.name}>{r.description || r.name}</td>
            <td className={TD}>{r.size || ""}</td><td className={TD + " mono text-slate-500"}>{r.sku || ""}</td>
            <td className={TD + " text-right mono"}>{fmt(r.opening)}</td><td className={TD + " text-right mono text-slate-500"}>{r.min ? fmt(r.min) : ""}</td>
            <td className={TD + " text-right mono"}>{r.rec ? fmt(r.rec) : ""}</td><td className={TD + " text-right mono"}>{r.issue ? fmt(r.issue) : ""}</td>
            <td className={TD + " text-right mono font-semibold"}>{fmt(r.balance)}</td><td className={TD + " text-slate-500"}>{r.uom}</td>
            <td className={TD + " text-right mono text-slate-500"}>{r.rate ? fmt(r.rate) : ""}</td>
            {["opening_value","issue_value","receive_value","balance_value"].map(f => <td key={f} className={TD + " text-right mono text-slate-600"}>{r.rate ? fmt(r[f]) : ""}</td>)}
            <td className={TD}><span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5"
              style={r.alert === "MAKE ORDER" ? { background:"#fee2e2", color:"#991b1b" } : { background:"#ecfdf5", color:"#065f46" }}>{r.alert}</span></td>
            <td className={TD + " text-right mono " + (r.order_qty ? "text-rose-700 font-semibold" : "text-slate-300")}>{r.order_qty ? fmt(r.order_qty) : "0"}</td>
            {days && Array.from({ length:sheet.days }, (_, d) => { const x = r.daily[d + 1]; return <React.Fragment key={d}>
              <td className={TD + " text-right mono border-l border-slate-100 text-emerald-700"}>{x && x.rec ? fmt(x.rec) : ""}</td>
              <td className={TD + " text-right mono text-rose-700"}>{x && x.issue ? fmt(x.issue) : ""}</td></React.Fragment>; })}
          </tr>)}
          {!shown.length && <tr><td colSpan={17} className="px-3 py-6 text-center text-sm text-slate-500">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-slate-500 mt-2">ALERT follows the sheet's own rule: MAKE ORDER when the balance is below MIN. STOCK, and ORDER QTY is the difference.
        An item with no minimum never says MAKE ORDER — set one on the Item Register.</div>
    </div>}
  </div>;
}

/* THE ISSUE REGISTER — what the store received and issued today. Each entry
   books straight onto the register (auto-deducts) and says which items it
   has left below their minimum (the reorder alert). Material handed to a job
   card is booked on Issue Material instead, where the card is named. */
export function IssueRegister({ canWrite = true, onChanged }){
  const [date, setDate] = useState(() => todayIso());
  const [type, setType] = useState("issue");
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [entries, setEntries] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true;
    api.storeMonth(month).then(d => live && setEntries(d.entries || [])).catch(e => live && setErr(String(e.message || e)));
    return () => { live = false; }; }, [month, tick]);

  const rows = useMemo(stockRows, [tick, INPUTS.materials, INPUTS.stock_meta]);
  const byKey = useMemo(() => new Map(rows.map(r => [r.key, r])), [rows]);
  const needle = q.trim().toLowerCase();
  const matches = needle ? rows.filter(r => !lines.some(l => l.key === r.key)
    && `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(needle)).slice(0, 8) : [];
  const ready = canWrite && /^\d{4}-\d{2}-\d{2}$/.test(date) && lines.length && lines.every(l => Number(l.qty) > 0);

  async function save(){
    setBusy(true); setErr(""); setResult(null);
    try{
      const out = await api.addStoreEntry({ type, moved_on:date, note,
        lines:lines.map(l => ({ material_key:l.key, qty:Number(l.qty) })) });
      await reloadReference();
      setResult({ type, count:out.entries.length, warnings:out.warnings || [], reorder:out.reorder || [] });
      setLines([]); setNote(""); setMonth(date.slice(0, 7)); setTick(t => t + 1);
      if(onChanged) await onChanged();
    }catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }
  async function undo(e){
    if(!window.confirm(`Undo: ${STORE_MOVE_LABEL[e.type].toLowerCase()} ${fmt(e.qty)} ${e.uom} of ${e.name} on ${e.moved_on}?`)) return;
    setErr("");
    try{ const out = await api.undoStoreEntry(e.id); setResult({ note:out.note }); await reloadReference(); setTick(t => t + 1); if(onChanged) await onChanged(); }
    catch(x){ setErr(x.message || String(x)); setTick(t => t + 1); }
  }

  const byDay = (entries || []).slice().sort((a, z) => z.moved_on.localeCompare(a.moved_on) || z.id - a.id);
  return <div>
    {canWrite && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 mb-4">
      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-xs text-slate-600">Date
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Entry date"
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/></label>
        <div role="radiogroup" aria-label="Received or issued" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          {[["issue","Issued"],["rec","Received"]].map(([k, l]) => <button key={k} role="radio" aria-checked={type === k} onClick={() => setType(k)}
            className="text-sm font-semibold rounded-md px-3 py-1"
            style={type === k ? { background:k === "issue" ? "#be123c" : "#047857", color:"#fff" } : { color:"#475569" }}>{l}</button>)}
        </div>
        <label className="text-xs text-slate-600 relative" style={{ flex:"1 1 240px" }}>Item
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, code or category…" aria-label="Find an item"
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-full"/>
          {matches.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
            {matches.map(r => <button key={r.key} onClick={() => { setLines(ls => [...ls, { key:r.key, qty:"" }]); setQ(""); }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
              {r.sku && <span className="mono text-slate-500">{r.sku} · </span>}{r.name}
              <span className="text-slate-400 text-xs"> · {r.category || "no category"} · {fmt(r.stock)} {r.uom} in stock</span></button>)}
          </div>}
        </label>
      </div>
      {lines.length > 0 && <table className="text-sm mt-3 w-full max-w-3xl">
        <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500"><th className="text-left py-1">Item</th>
          <th className="text-right">In stock</th><th className="text-right">Min.</th><th className="text-right px-2">Quantity</th><th/></tr></thead>
        <tbody>{lines.map(l => { const r = byKey.get(l.key) || {}; const after = (r.stock || 0) + (type === "rec" ? 1 : -1) * (Number(l.qty) || 0);
          return <tr key={l.key} className="border-t border-slate-200">
            <td className="py-1.5">{r.name}<span className="text-xs text-slate-400"> · {r.uom}</span></td>
            <td className="text-right mono">{fmt(r.stock)}</td><td className="text-right mono text-slate-500">{r.min ? fmt(r.min) : "—"}</td>
            <td className="text-right px-2"><input type="number" min="0" step="any" value={l.qty} aria-label={`Quantity of ${r.name}`}
              onChange={e => setLines(ls => ls.map(x => x.key === l.key ? { ...x, qty:e.target.value } : x))}
              className="w-24 border border-slate-300 rounded px-2 py-1 text-right mono bg-white"/>
              {Number(l.qty) > 0 && <div className={"text-[11px] mono " + (r.min && after < r.min ? "text-rose-700" : "text-slate-500")}>
                → {fmt(after)}{r.min && after < r.min ? " · below min" : ""}</div>}</td>
            <td><button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={`Remove ${r.name}`}
              className="text-slate-400 hover:text-rose-700 px-2">×</button></td></tr>; })}</tbody></table>}
      <div className="flex items-end gap-3 flex-wrap mt-3">
        <label className="text-xs text-slate-600" style={{ flex:"1 1 260px" }}>Note (optional)
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={type === "issue" ? "Issued to… (line, department)" : "Supplier, bill no."}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-full"/></label>
        <button onClick={save} disabled={!ready || busy}
          className="text-sm font-semibold text-white rounded-lg px-4 py-2 disabled:opacity-50"
          style={{ background:type === "issue" ? "#be123c" : "#047857" }}>{busy ? "Saving…" : type === "issue" ? "Record issue" : "Record receipt"}</button>
      </div>
      <div className="text-[11px] text-slate-500 mt-2">Material for a job card is issued on <b>Issue Material</b>, so the card is named. This register is for everything else the store hands out or takes in.</div>
    </div>}

    {err && <div role="alert" className="text-xs text-rose-700 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 mb-3">{err}</div>}
    {result && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">
      {result.note || <>{result.count} {result.type === "issue" ? "issue" : "receipt"}{result.count === 1 ? "" : "s"} recorded and booked onto the register.</>}
      {(result.warnings || []).map(w => <div key={w} className="text-amber-800">⚠ {w}</div>)}
      {(result.reorder || []).length > 0 && <div className="mt-1 text-rose-800"><b>Reorder alert — MAKE ORDER:</b>{" "}
        {result.reorder.map(r => `${r.name}: ${fmt(r.balance)} left, minimum ${fmt(r.min)}, order ${fmt(r.order_qty)} ${r.uom}`).join("; ")}.</div>}
    </div>}

    <div className="flex items-center gap-2 mb-2">
      <div className="text-sm font-semibold text-slate-800">Register — {monthName(month)}</div>
      <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month" className="text-xs px-2 py-1 rounded border border-slate-300 bg-white">◀</button>
      <button onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month" className="text-xs px-2 py-1 rounded border border-slate-300 bg-white">▶</button>
    </div>
    {entries === null ? <div className="text-sm text-slate-500">Loading…</div>
      : !byDay.length ? <div className="text-sm text-slate-500">Nothing recorded in {monthName(month)}.</div>
      : <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-sm" style={{ borderCollapse:"collapse" }}>
        <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
          <th className="text-left px-3 py-2">Date</th><th className="text-left px-2">Item</th><th className="text-left px-2">Entry</th>
          <th className="text-right px-2">Quantity</th><th className="text-left px-2">Note</th><th className="text-left px-2">By</th><th/></tr></thead>
        <tbody>{byDay.map(e => <tr key={e.id} className="border-t border-slate-100">
          <td className="px-3 py-1.5 mono whitespace-nowrap">{e.moved_on}</td><td className="px-2">{e.name}</td>
          <td className="px-2"><span className={e.type === "issue" ? "text-rose-700" : "text-emerald-700"}>{STORE_MOVE_LABEL[e.type]}</span></td>
          <td className="px-2 text-right mono">{fmt(e.qty)} <span className="text-slate-400 text-xs">{e.uom}</span></td>
          <td className="px-2 text-slate-600">{e.note}</td><td className="px-2 text-slate-500 text-xs">{e.moved_by || ""}</td>
          <td className="px-2 text-right">{canWrite && <button onClick={() => undo(e)} className="text-xs font-semibold text-slate-500 hover:text-rose-700">Undo</button>}</td>
        </tr>)}</tbody></table></div>}
  </div>;
}
