import React, { useEffect, useRef, useState } from "react";
import GatePass, { gatePassFor } from "./GatePass.jsx";
import { cleanGatePassFields, GATE_PASS_LIMITS } from "../shared/gate-pass.js";
import { REF as INPUTS } from "./lib/refdata.js";
import { todayIso } from "./lib/today.js";
import { printDocument } from "./lib/print-document.js";
import * as api from "./lib/client.js";

/* GATE PASSES — what security checks as each lorry leaves.
 *
 * Its own screen because its reader is different: the gate works from the
 * day's lorries, newest first, while the Dispatch Book is organised order by
 * order. Every figure on a slip comes from the packing list stored with the
 * dispatch; only the three things written by hand — the SR. No off the
 * pre-printed book, the transporter and the city — are entered here, and they
 * are SAVED with the dispatch so a reprint reads the same as the slip that
 * left. Printing waits for a save for exactly that reason.
 */

const fmt = n => n == null ? "—" : Number(n).toLocaleString("en-IN");
const niceDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-IN", { day:"numeric", month:"short" }) : "—";
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const RANGES = [["today","Today"],["week","Last 7 days"],["all","All"]];

export default function GatePassTab({ dispatches = [], orders = [], onChanged, focusId = null }){
  const [range, setRange] = useState(focusId ? "all" : "week");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(focusId);
  const [fields, setFields] = useState({ serial_no:"", transporter:"", city:"" });
  const [saved, setSaved] = useState({});        // id -> gate_pass saved in this session
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const openRef = useRef(null);

  /* Arriving from the Dispatch Book with a dispatch in hand opens that one. */
  useEffect(() => { if(focusId){ setRange("all"); setOpenId(focusId); } }, [focusId]);

  const orderOf = no => (orders || []).find(o => o.order_no === no) || {};
  const gateOf = d => saved[d.id] || d.gate_pass || {};

  const printable = (dispatches || []).filter(d => d.packing_list && !d.hidden);
  const unprintable = (dispatches || []).filter(d => !d.packing_list && !d.hidden).length;

  const today = todayIso();
  const rows = printable
    .filter(d => range === "all" || (range === "today"
      ? d.dispatched_on === today
      : daysBetween(d.dispatched_on, today) <= 6 && daysBetween(d.dispatched_on, today) >= 0))
    .filter(d => {
      const s = search.trim().toLowerCase();
      if(!s) return true;
      const o = orderOf(d.order_no);
      return [d.order_no, o.party, (d.packing_list || {}).customer, gateOf(d).serial_no]
        .some(v => String(v || "").toLowerCase().includes(s));
    })
    .sort((a, z) => String(z.dispatched_on).localeCompare(String(a.dispatched_on)) || z.id - a.id);

  const open = printable.find(d => d.id === openId) || null;

  /* Opening a slip loads what was written on it before. */
  useEffect(() => {
    if(!open) return;
    const g = gateOf(open);
    setFields({ serial_no:g.serial_no || "", transporter:g.transporter || "", city:g.city || "" });
    setErr(""); setMsg("");
    if(openRef.current && openRef.current.scrollIntoView)
      openRef.current.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }, [openId]);

  const storedFields = open ? gateOf(open) : {};
  const dirty = !!open && ["serial_no","transporter","city"]
    .some(k => String(fields[k] || "").trim() !== String(storedFields[k] || "").trim());
  /* The same rule the server applies, so a clash is shown before Save. */
  const used = printable.filter(d => open && d.id !== open.id)
    .map(d => ({ serial_no: gateOf(d).serial_no, order_no: d.order_no, dispatched_on: d.dispatched_on }))
    .filter(u => u.serial_no);
  const check = cleanGatePassFields(fields, used);

  async function save(){
    if(!open || !check.ok) return;
    setBusy(true); setErr(""); setMsg("");
    try{
      const r = await api.saveGatePass(open.id, check.value);
      setSaved(s => ({ ...s, [open.id]: (r && r.gate_pass) || check.value }));
      setMsg(`Gate pass for ${open.order_no} saved${check.value.serial_no ? ` as SR. No ${check.value.serial_no}` : ""}.`);
      if(onChanged) await onChanged();
    }catch(e){ setErr(String(e.message || e)); }
    finally{ setBusy(false); }
  }

  function print(){
    if(!printDocument(".gate-pass", `Gate pass ${storedFields.serial_no || ""} ${open ? open.order_no : ""}`))
      setErr("Popup blocked — allow popups to print the gate pass.");
  }

  const written = rows.filter(d => gateOf(d).serial_no).length;

  return <div>
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs" role="group" aria-label="Which dispatches">
          {RANGES.map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} aria-pressed={range === k}
              className={`px-3 py-1.5 font-semibold ${range === k ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}>
              {label}</button>))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search gate passes"
          placeholder="Party, order or SR. No"
          className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 w-56" />
        <div className="ml-auto text-xs text-slate-500">
          <b className="mono text-slate-700">{rows.length}</b> dispatch{rows.length === 1 ? "" : "es"}
          {" · "}<b className="mono text-slate-700">{written}</b> with an SR. No
        </div>
      </div>

      {!rows.length
        ? <div className="text-sm text-slate-400 py-8 text-center">
            {printable.length ? "No dispatches in this range." : "No dispatch with a packing list has been recorded yet."}
          </div>
        : <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth:560, borderCollapse:"collapse" }}>
            <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="text-left py-2 pr-3 font-semibold">Date</th>
              <th className="text-left py-2 pr-3 font-semibold">SR. No</th>
              <th className="text-left py-2 pr-3 font-semibold">Party</th>
              <th className="text-left py-2 pr-3 font-semibold">Order</th>
              <th className="text-right py-2 pr-3 font-semibold">Cartons</th>
              <th className="text-right py-2 pr-3 font-semibold">Pairs</th>
              <th></th>
            </tr></thead>
            <tbody>{rows.map(d => {
              const o = orderOf(d.order_no), g = gateOf(d), isOpen = d.id === openId;
              const pass = gatePassFor(d, o, g, INPUTS);
              return <React.Fragment key={d.id}>
                <tr className="border-t border-slate-100 align-top" style={{ background:isOpen ? "#F5F9FE" : undefined }}>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-slate-700">{niceDate(d.dispatched_on)}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {g.serial_no
                      ? <span className="mono font-semibold text-slate-800">{g.serial_no}</span>
                      : <span className="text-xs text-amber-700">not written</span>}</td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-slate-800">{pass.party || "—"}</div>
                    {pass.city && <div className="text-[11px] text-slate-500">{pass.city}</div>}</td>
                  <td className="py-2.5 pr-3 mono text-slate-700">{d.order_no}</td>
                  <td className="py-2.5 pr-3 text-right mono">{fmt(pass.total_cartons)}</td>
                  <td className="py-2.5 pr-3 text-right mono">{fmt(pass.total_pairs)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setOpenId(isOpen ? null : d.id)}
                      aria-label={`${isOpen ? "Close" : "Open"} gate pass for ${d.order_no} on ${d.dispatched_on}`}
                      className="text-xs font-semibold text-indigo-700 hover:underline">{isOpen ? "Close" : "Open"}</button>
                  </td>
                </tr>
                {isOpen && <tr><td colSpan={7} className="pb-4">
                  <div ref={openRef} className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-1">
                    <div data-noprint className="flex gap-3 flex-wrap items-end mb-3">
                      {[["serial_no","SR. No from the book","w-32 mono"],["transporter","Transporter","w-48"],["city","City","w-40"]]
                        .map(([k, label, w]) => (
                        <label key={k} className="text-xs text-slate-600">{label}
                          <input value={fields[k]} maxLength={GATE_PASS_LIMITS[k]}
                            aria-label={label}
                            placeholder={k === "city" ? ((o.pi || {}).customer_city || "") : ""}
                            onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}
                            className={`block mt-0.5 text-sm border border-slate-300 rounded px-2 py-1 bg-white ${w}`} /></label>))}
                      <button onClick={save} disabled={busy || !dirty || !check.ok}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                        {busy ? "Saving…" : "Save"}</button>
                      <button onClick={print} disabled={dirty}
                        title={dirty ? "Save first, so a reprint reads the same as this slip" : "Print or save as PDF"}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-40">
                        Print / Save PDF</button>
                      {dirty && <span className="text-[11px] text-amber-700">Unsaved — save before printing.</span>}
                    </div>
                    {!check.ok && <div role="alert" className="text-xs text-rose-700 mb-2">{check.problems.join("; ")}</div>}
                    {err && <div role="alert" className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-2">{err}</div>}
                    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-2">{msg}</div>}
                    <div className="bg-white rounded-lg p-2 overflow-x-auto">
                      <GatePass data={gatePassFor(d, o, fields, INPUTS)} />
                    </div>
                  </div>
                </td></tr>}
              </React.Fragment>;
            })}</tbody>
          </table>
        </div>}

      {unprintable > 0 && <p className="text-[11px] text-slate-400 mt-3">
        {unprintable} dispatch{unprintable === 1 ? " was" : "es were"} recorded without a packing list, so no
        gate pass can be printed for {unprintable === 1 ? "it" : "them"} — the slip's figures come from the packing list.
      </p>}
    </div>
  </div>;
}
