import React, { useEffect, useState } from "react";
import * as api from "./lib/client.js";
import { TYPES, TYPE_LABEL, TYPE_HELP, RULES, validateFabricator } from "../shared/fabricators.js";

/* Fabricators & lines — who work can be sent to.
 *
 * The factory's own stitching lines and outside job workers are one list,
 * separated by Type. That is what lets the job work issue screen ask "who is
 * doing this" once, whether the answer is Line 2 or a fabricator in the next
 * town.
 *
 * The form shows only the fields the chosen type actually needs, driven by the
 * same RULES the server validates against — so a field is never demanded in
 * one place and hidden in the other.
 */

const BLANK = { name:"", type:"external", rate:"", tat_days:"",
                contact_person:"", contact_phone:"", payable:true, active:true, note:"" };

export default function FabricatorsTab(){
  const [list, setList] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function reload(){
    try{ setList(await api.listFabricators()); setErr(""); }
    catch(e){ setErr(e.message || String(e)); setList([]); }
  }
  useEffect(()=>{ reload(); },[]);

  const rules = RULES[form.type] || {};
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  /* Checked here purely so the form can disable Save and show why; the server
     validates the same way and is the one that counts. */
  const check = validateFabricator(form);

  async function save(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const saved = await api.saveFabricator(form);
      await reload();
      setForm(BLANK); setEditing(null);
      setMsg(`${saved.name} saved.`);
    }catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  async function retire(name){
    if(!confirm(`Stop sending work to ${name}?\n\nIt stays in the list and keeps its history — `
      + `past job cards must still make sense — but it will not be offered for new work.`)) return;
    setBusy(true); setErr("");
    try{ await api.retireFabricator(name); await reload(); setMsg(`${name} deactivated.`); }
    catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  async function seed(){
    setBusy(true); setErr("");
    try{
      const out = await api.seedInternalLines();
      await reload();
      setMsg(out.seeded.length ? `Added ${out.seeded.join(", ")}.` : "The two starting options are already there.");
    }catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  if(list === null) return <div className="p-5 text-sm text-slate-500">Loading fabricators…</div>;

  const byType = t => list.filter(f => f.type === t);

  return <div className="p-4 md:p-5">
    {msg && <div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err && <div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">
        {editing ? `Edit ${editing}` : "Add a fabricator or line"}
      </div>
      <div className="text-xs text-slate-600 mb-3">{TYPE_HELP[form.type]}</div>

      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Type
          <select value={form.type} aria-label="Type"
            onChange={e=>set("type", e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Name
          <input value={form.name} aria-label="Name" disabled={!!editing}
            onChange={e=>set("name", e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm disabled:bg-slate-100" /></label>

        {rules.rate !== "none" && <label className="text-xs text-slate-600">
          {rules.rate === "flat" ? "Flat sample charge" : "Rate per piece"}
          <input type="number" min="0" step="0.01" value={form.rate}
            aria-label={rules.rate === "flat" ? "Flat sample charge" : "Rate per piece"}
            onChange={e=>set("rate", e.target.value)}
            className="block mt-1 w-32 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm mono" /></label>}

        <label className="text-xs text-slate-600">Turnaround (days)
          <input type="number" min="1" step="1" value={form.tat_days} aria-label="Turnaround (days)"
            onChange={e=>set("tat_days", e.target.value)}
            className="block mt-1 w-28 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm mono" /></label>

        {rules.contact !== "optional" && <>
          <label className="text-xs text-slate-600">Contact person
            <input value={form.contact_person} aria-label="Contact person"
              onChange={e=>set("contact_person", e.target.value)}
              className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" /></label>
          <label className="text-xs text-slate-600">Phone
            <input value={form.contact_phone} aria-label="Phone"
              onChange={e=>set("contact_phone", e.target.value)}
              className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm mono" /></label>
        </>}

        {rules.payable === "optional" && <label className="text-xs text-slate-600 flex items-center gap-2 pb-2">
          <input type="checkbox" checked={!!form.payable} aria-label="Payable"
            onChange={e=>set("payable", e.target.checked)} /> Payable</label>}
      </div>

      {/* Stated rather than left to be discovered: money never attaches to the
          factory's own line, whatever the form is filled in with. */}
      {rules.payable === "never" && <div className="text-[11px] text-slate-500 mt-2">
        Work on an internal line is not paid for, so no rate and nothing payable.</div>}

      {!check.ok && (form.name || form.rate || form.tat_days) &&
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          {check.problems.map((p,i)=><div key={i}>{p}</div>)}
        </div>}

      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={busy || !check.ok}
          className="text-xs font-semibold text-white rounded-lg px-3 py-2 bg-slate-800 disabled:opacity-40">
          {busy ? "Saving…" : editing ? "Save changes" : "Add"}
        </button>
        {editing && <button onClick={()=>{ setForm(BLANK); setEditing(null); }}
          className="text-xs font-semibold rounded-lg px-3 py-2 border border-slate-300 bg-white">Cancel</button>}
        {(!list.some(f=>f.name==="Rex Internal") || !list.some(f=>f.name==="New Durga Line")) &&
          <button onClick={seed} disabled={busy}
            className="ml-auto text-xs font-semibold rounded-lg px-3 py-2 border border-slate-300 bg-white">
            Add Rex Internal and New Durga Line</button>}
      </div>
    </div>

    {TYPES.map(t => {
      const rows = byType(t);
      if(!rows.length) return null;
      return <div key={t} className="mb-4">
        <div className="text-xs font-semibold text-slate-700 mb-1">{TYPE_LABEL[t]}</div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-right px-2">{RULES[t].rate === "flat" ? "Sample charge" : "Rate/piece"}</th>
              <th className="text-right px-2">TAT</th>
              <th className="text-left px-2">Contact</th>
              <th className="text-left px-2">Payable</th>
              <th className="text-left px-2">Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              {rows.map(f => <tr key={f.name} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-medium text-slate-800">{f.name}
                  {f.note && <div className="text-[10.5px] text-slate-500">{f.note}</div>}</td>
                <td className="text-right px-2 mono">{RULES[t].rate === "none" ? "—" : (f.rate > 0 ? f.rate : "Not set")}</td>
                <td className="text-right px-2 mono">{f.tat_days > 0 ? `${f.tat_days}d` : "Not set"}</td>
                <td className="px-2 text-slate-600">
                  {[f.contact_person, f.contact_phone].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-2">{f.payable
                  ? <span className="text-amber-800 font-semibold">Yes</span>
                  : <span className="text-slate-500">No</span>}</td>
                <td className="px-2">{f.active
                  ? <span className="text-emerald-700 font-semibold">Active</span>
                  : <span className="text-slate-400">Inactive</span>}</td>
                <td className="text-right px-3 whitespace-nowrap">
                  <button onClick={()=>{ setEditing(f.name);
                      setForm({ ...BLANK, ...f, rate:String(f.rate ?? ""), tat_days:String(f.tat_days ?? "") }); }}
                    className="text-indigo-700 font-semibold hover:underline">Edit</button>
                  {f.active && <button onClick={()=>retire(f.name)} disabled={busy}
                    className="ml-2 text-slate-600 hover:underline disabled:opacity-40">Deactivate</button>}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>;
    })}

    {!list.length && <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
      No options yet. Add Rex Internal and New Durga Line to start; complete New Durga Line's rate,
      contact and turnaround before settling its payment.
    </div>}
  </div>;
}
