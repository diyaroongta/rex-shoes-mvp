import React, { useMemo, useState } from "react";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { planRemoval } from "../shared/bom-removal.js";
import * as api from "./lib/client.js";

/* Bulk BOM removal.
 *
 * Three levels in one panel, because "remove it from the BOM" means three
 * different things: the whole article, one of its size ranges, or one material
 * inside a range. Selections at all three levels accumulate and are removed in
 * a single confirmed action — removing them one at a time did not scale past a
 * handful, which is what this replaces.
 *
 * The running count comes from the SAME pure planner the server uses, so the
 * number on the button is the number that will actually go, including the
 * ranges that get promoted because their last material was selected.
 */

const rangesOf = a => (INPUTS.articles?.[a]?.combo_order) || Object.keys(INPUTS.articles?.[a]?.combos || {});
const ratesOf  = (a, c) => Object.entries(INPUTS.articles?.[a]?.combos?.[c]?.rates || {})
  .flatMap(([stage, mats]) => Object.entries(mats || {}).map(([material, rate]) => ({ stage, material, rate })));
const rateTotal = a => rangesOf(a).reduce((n, c) => n + ratesOf(a, c).length, 0);

const SEP = "|||";   // cannot occur in an article code or a size range
const mKey = m => [m.article,m.combo,m.stage,m.material].join(SEP);

export default function BomRemovalPanel({ onDone, onCancel }){
  const articles = Object.keys(INPUTS.articles || {});
  const [level, setLevel] = useState("articles");
  const [article, setArticle] = useState(articles[0] || "");

  const [pickedArticles, setPickedArticles] = useState([]);        // ["SPIKE"]
  const [pickedRanges, setPickedRanges]     = useState([]);        // ["SPIKE|||8X12"]
  const [pickedMaterials, setPickedMaterials] = useState([]);      // [{article,combo,stage,material}]

  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [overrideOrders, setOverrideOrders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selection = useMemo(() => ({
    articles: pickedArticles,
    ranges: pickedRanges.map(k => { const [a, c] = k.split(SEP); return { article:a, combo:c }; }),
    materials: pickedMaterials,
  }), [pickedArticles, pickedRanges, pickedMaterials]);

  /* Planned locally purely to keep the running total honest as boxes are
     ticked. Nothing is deleted on this number — the server re-plans against
     the row it locks. */
  const localPlan = useMemo(() => planRemoval(INPUTS, selection), [selection]);

  function reset(){ setPreview(null); setConfirmed(false); setOverrideOrders(false); setErr(""); }
  const toggle = (list, set, value) =>
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

  async function runPreview(){
    setBusy(true); setErr(""); setPreview(null); setConfirmed(false); setOverrideOrders(false);
    try{ setPreview(await api.previewBomRemoval(selection)); }
    catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  async function commit(){
    setBusy(true); setErr("");
    try{
      const out = await api.removeBom(selection, overrideOrders);
      await reloadReference();
      setPickedArticles([]); setPickedRanges([]); setPickedMaterials([]);
      reset();
      onDone && onDone(out);
    }catch(e){ setErr(e.message || String(e)); }
    finally{ setBusy(false); }
  }

  const atRisk = preview?.orders_at_risk || [];
  const blocked = atRisk.length > 0 && !overrideOrders;

  return <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 mb-3">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div className="text-sm font-semibold text-slate-800">Remove from the BOM</div>
        <div className="text-xs text-slate-600 mt-0.5">
          Tick anything at any level — whole articles, single size ranges, individual materials —
          and remove it all in one action. Everything here can be restored from Data &amp; BOM history.
        </div>
      </div>
      {onCancel && <button type="button" onClick={onCancel}
        className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white">Close</button>}
    </div>

    <div className="flex gap-1 mt-3 mb-3">
      {[["articles","Whole articles"],["ranges","Size ranges"],["materials","Materials"]].map(([k, label]) =>
        <button key={k} type="button" onClick={()=>{ setLevel(k); reset(); }}
          className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${
            level===k ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-300"}`}>
          {label}
        </button>)}
    </div>

    {level !== "articles" && <label className="text-xs text-slate-600 block mb-2">Article
      <select value={article} onChange={e=>{ setArticle(e.target.value); reset(); }} aria-label="Article"
        className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
        {articles.map(a => <option key={a}>{a}</option>)}
      </select></label>}

    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
      {level === "articles" && articles.map(a => {
        const gone = localPlan.articles.some(x => x.article === a);
        const promoted = localPlan.emptied_articles.includes(a);
        return <label key={a} className="flex items-center gap-2 text-xs py-1 px-1 hover:bg-slate-50 rounded">
          <input type="checkbox" checked={pickedArticles.includes(a)}
            onChange={()=>{ toggle(pickedArticles, setPickedArticles, a); reset(); }} />
          <span className="font-medium text-slate-800">{a}</span>
          <span className="text-slate-500">{rangesOf(a).length} range{rangesOf(a).length===1?"":"s"} · {rateTotal(a)} rates</span>
          {gone && promoted && <span className="ml-auto text-[10px] rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
            goes anyway — all its ranges are selected</span>}
        </label>;
      })}

      {level === "ranges" && rangesOf(article).map(c => {
        const key = (article + SEP + c);
        const promoted = localPlan.emptied_ranges.some(r => r.article === article && r.combo === c);
        const swallowed = pickedArticles.includes(article);
        return <label key={c} className={`flex items-center gap-2 text-xs py-1 px-1 rounded ${swallowed?"opacity-45":"hover:bg-slate-50"}`}>
          <input type="checkbox" disabled={swallowed}
            checked={swallowed || pickedRanges.includes(key)}
            onChange={()=>{ toggle(pickedRanges, setPickedRanges, key); reset(); }} />
          <span className="font-medium text-slate-800">{c}</span>
          <span className="text-slate-500">{ratesOf(article, c).length} rates</span>
          {swallowed && <span className="ml-auto text-[10px] text-slate-500">the whole article is selected</span>}
          {!swallowed && promoted && <span className="ml-auto text-[10px] rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
            goes anyway — its last material is selected</span>}
        </label>;
      })}

      {level === "materials" && rangesOf(article).map(c => {
        const rows = ratesOf(article, c);
        const swallowed = pickedArticles.includes(article) || pickedRanges.includes((article + SEP + c));
        return <div key={c} className="mb-2">
          <div className="text-[11px] font-semibold text-slate-500 px-1 mt-1">{c}</div>
          {rows.map(r => {
            const item = { article, combo:c, stage:r.stage, material:r.material };
            const on = pickedMaterials.some(m => mKey(m) === mKey(item));
            return <label key={r.stage + r.material}
              className={`flex items-center gap-2 text-xs py-1 px-1 rounded ${swallowed?"opacity-45":"hover:bg-slate-50"}`}>
              <input type="checkbox" disabled={swallowed} checked={swallowed || on}
                onChange={()=>{ setPickedMaterials(on ? pickedMaterials.filter(m => mKey(m) !== mKey(item))
                                                     : [...pickedMaterials, item]); reset(); }} />
              <span className="text-slate-700">{r.stage}</span>
              <span className="font-medium text-slate-800">{r.material}</span>
              <span className="text-slate-500">{r.rate}/pair</span>
            </label>;
          })}
          {!rows.length && <div className="text-[11px] text-slate-400 px-1">no materials</div>}
        </div>;
      })}
    </div>

    <div className="flex items-center gap-2 flex-wrap mt-3">
      <div className="text-xs text-slate-700" data-testid="removal-total">
        {localPlan.empty ? "Nothing selected"
          : <>Selected: <b>{localPlan.totals.articles}</b> article{localPlan.totals.articles===1?"":"s"},
             {" "}<b>{localPlan.totals.ranges}</b> size range{localPlan.totals.ranges===1?"":"s"},
             {" "}<b>{localPlan.totals.rates}</b> material rate{localPlan.totals.rates===1?"":"s"}</>}
      </div>
      {(pickedArticles.length || pickedRanges.length || pickedMaterials.length) ?
        <button type="button" className="text-xs underline text-slate-600"
          onClick={()=>{ setPickedArticles([]); setPickedRanges([]); setPickedMaterials([]); reset(); }}>
          Clear selection</button> : null}
      <button type="button" disabled={busy || localPlan.empty} onClick={runPreview}
        className="ml-auto text-xs font-semibold rounded-lg px-3 py-2 bg-white border border-slate-300 disabled:opacity-50">
        {busy && !preview ? "Checking…" : "Check what will be removed"}
      </button>
    </div>

    {(localPlan.emptied_ranges.length > 0 || localPlan.emptied_articles.length > 0) && !preview &&
      <div className="mt-2 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
        {localPlan.emptied_ranges.length > 0 && <div>
          Selecting every material in a range removes the range itself:{" "}
          {localPlan.emptied_ranges.map(r => `${r.article} ${r.combo}`).join(", ")}. A range with no
          materials would still take machine capacity while needing no material at all.
        </div>}
        {localPlan.emptied_articles.length > 0 && <div className="mt-1">
          And selecting every range of an article removes the article: {localPlan.emptied_articles.join(", ")}.
        </div>}
      </div>}

    {err && <div role="alert" className="mt-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    {preview && <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-800 mb-1">This will be removed</div>
      <div className="text-xs text-slate-700">
        <b>{preview.plan.totals.articles}</b> article{preview.plan.totals.articles===1?"":"s"} ·{" "}
        <b>{preview.plan.totals.ranges}</b> size range{preview.plan.totals.ranges===1?"":"s"} ·{" "}
        <b>{preview.plan.totals.rates}</b> material rate{preview.plan.totals.rates===1?"":"s"}
      </div>
      {preview.plan.articles.length > 0 && <div className="text-[11px] text-rose-800 mt-1">
        Articles: {preview.plan.articles.map(a => a.article).join(", ")}</div>}
      {preview.plan.ranges.length > 0 && <div className="text-[11px] text-rose-800 mt-1">
        Ranges: {preview.plan.ranges.map(r => `${r.article} ${r.combo}`).join(", ")}</div>}
      {preview.plan.materials.length > 0 && <div className="text-[11px] text-rose-800 mt-1">
        Materials: {preview.plan.materials.map(m => `${m.article} ${m.combo} ${m.material}`).join(", ")}</div>}

      {atRisk.length > 0 && <div className="mt-3 rounded-lg bg-rose-50 border border-rose-300 px-3 py-2">
        <div className="text-xs font-semibold text-rose-900">
          {atRisk.length} live order{atRisk.length===1?"":"s"} depend{atRisk.length===1?"s":""} on this
        </div>
        <div className="text-[11px] text-rose-800 mt-1">
          {atRisk.slice(0, 12).map(r => <div key={r.order_no}>{r.order_no} — {r.detail}</div>)}
          {atRisk.length > 12 && <div>and {atRisk.length - 12} more</div>}
        </div>
        <div className="text-[11px] text-rose-900 mt-2">
          These orders stay on the sheet and keep their quantities, but cannot be planned — they will
          show on the board as unplanned until their article is restored or they are re-articled.
        </div>
        <label className="flex gap-2 items-start text-[11px] text-rose-900 mt-2">
          <input type="checkbox" checked={overrideOrders} onChange={e=>setOverrideOrders(e.target.checked)} />
          I understand these orders will become unplannable, and want to remove it anyway.
        </label>
      </div>}

      <label className="flex gap-2 items-start text-xs text-slate-800 mt-3">
        <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />
        I have checked the list above and want to remove it.
      </label>

      <div className="flex gap-2 mt-3">
        <button type="button" disabled={busy || !confirmed || blocked} onClick={commit}
          className="text-xs font-semibold rounded-lg px-3 py-2 bg-rose-600 text-white disabled:opacity-50">
          {busy ? "Removing…" : `Remove ${preview.plan.totals.rates} material rate${preview.plan.totals.rates===1?"":"s"}`}
        </button>
        <button type="button" disabled={busy} onClick={reset}
          className="text-xs font-semibold rounded-lg px-3 py-2 bg-white border border-slate-300">Back</button>
      </div>
    </div>}
  </div>;
}
