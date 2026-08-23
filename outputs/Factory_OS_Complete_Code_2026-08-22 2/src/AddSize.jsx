import React, { useState, useMemo } from "react";
import { sizeCatalog, resolveSize, addSizeToLines } from "../shared/sizes.js";
import { singlePackQty, articleTypeCombos, comboSizesForArticle } from "../shared/bridge.js";
import { REF as INPUTS } from "./lib/refdata.js";

/* Add one specific size to an order, instead of a whole size range.

   The BOM prices material per RANGE, so a single size has to borrow a range's
   rates. Where that choice is ambiguous, or the size isn't in any range, or
   there is no pack quantity on file, this says so and asks — it never guesses,
   because a wrong pack quantity changes the pair count, the material and the
   dispatch date together. */
export default function AddSize({ articleCode, articleType, lines, onChange }){
  const article = INPUTS.articles[articleCode];
  const [size,setSize]=useState("");
  const [combo,setCombo]=useState("");
  const [unit,setUnit]=useState("pairs");
  const [amount,setAmount]=useState("");
  const [manualPpc,setManualPpc]=useState("");

  const scopedArticle=useMemo(()=>article?{...article,combo_order:articleTypeCombos(articleCode,articleType)}:null,[article,articleCode,articleType]);
  const sizeResolver=c=>comboSizesForArticle(articleCode,c,articleType);
  const catalog = useMemo(()=> scopedArticle ? sizeCatalog(scopedArticle,sizeResolver) : [], [scopedArticle, articleCode, articleType]);
  const res = useMemo(()=> (article && size)
    ? resolveSize(articleCode, scopedArticle, size, INPUTS.packing || {},
        (code,oneSize)=>singlePackQty(code,oneSize,articleType), combo || null,sizeResolver)
    : null, [article, scopedArticle, articleCode, articleType, size, combo]);

  if(!article) return null;

  const ppc = res ? (res.ppc ?? (Number(manualPpc) || null)) : null;
  const pairs = unit === "pairs"
    ? Math.max(0, Math.round(Number(amount) || 0))
    : (ppc ? Math.round((Number(amount) || 0) * ppc) : 0);
  const chosenCombo = combo || (res && res.combo) || "";
  const canAdd = !!chosenCombo && pairs > 0;

  function add(){
    if(!canAdd) return;
    onChange(addSizeToLines(lines, { combo: chosenCombo, size, qty: pairs }));
    setSize(""); setCombo(""); setAmount(""); setManualPpc("");
  }

  return <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/60">
    <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">Add a specific size</div>

    <div className="flex gap-2 flex-wrap items-end">
      <label className="text-xs text-slate-600">Size
        <input list={`sizes-${articleCode}`} value={size}
          onChange={e=>{ setSize(e.target.value); setCombo(""); }}
          placeholder="e.g. 8s or 3"
          className="block mt-1 w-24 text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono" />
        <datalist id={`sizes-${articleCode}`}>
          {catalog.map(c=><option key={c.size} value={c.size} />)}
        </datalist></label>

      {res && (res.ambiguous || !res.inBom) && (
        <label className="text-xs text-slate-600">Take material from
          <select value={combo} onChange={e=>setCombo(e.target.value)}
            className="block mt-1 text-sm border rounded-lg px-2 py-1.5 bg-white"
            style={{borderColor: combo ? "#e2e8f0" : "#f59e0b"}}>
            <option value="">Choose a size range…</option>
            {(res.candidates||[]).map(c=><option key={c} value={c}>{c}</option>)}
          </select></label>
      )}

      <label className="text-xs text-slate-600">Quantity
        <div className="flex gap-1 mt-1">
          <input type="number" min={0} value={amount} onChange={e=>setAmount(e.target.value)}
            className="w-24 text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono" />
          <select value={unit} onChange={e=>setUnit(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-1.5 py-1.5 bg-white">
            <option value="pairs">pairs</option>
            <option value="cartons">cartons</option>
          </select>
        </div></label>

      {unit === "cartons" && res && res.ppc == null && (
        <label className="text-xs text-amber-800">Pairs per carton
          <input type="number" min={1} value={manualPpc} onChange={e=>setManualPpc(e.target.value)}
            placeholder="not on file"
            className="block mt-1 w-28 text-sm border border-amber-300 rounded-lg px-2 py-1.5 mono bg-amber-50" /></label>
      )}

      <button disabled={!canAdd} onClick={add}
        className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
        Add size</button>
    </div>

    {res && (
      <div className="mt-2 text-xs space-y-1">
        {res.ppc != null && (
          <div className="text-slate-500">
            Packs {res.ppc}/carton <span className="text-slate-400">({res.ppcSource})</span>
            {chosenCombo && <> · material from <b className="mono">{chosenCombo}</b></>}
            {unit === "cartons" && pairs > 0 && <> · {amount} cartons = <b>{pairs}</b> pairs</>}
          </div>
        )}
        {res.issues.map((iss,i)=>(
          <div key={i} className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{iss}</div>
        ))}
        {!res.inBom && chosenCombo && (
          <div className="text-slate-500">
            Size {res.size} isn&rsquo;t in {articleCode}&rsquo;s ranges, so its material will be costed
            at <b className="mono">{chosenCombo}</b> rates. Check that&rsquo;s the right consumption.
          </div>
        )}
      </div>
    )}
  </div>;
}
