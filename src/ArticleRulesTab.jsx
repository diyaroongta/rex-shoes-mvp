import React, { useMemo, useState } from "react";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import { articleTypes, articleTypeCombos, comboSizesForArticle, comboType, pairsPerCarton, packingRuleSource, singlePackingRule } from "../shared/bridge.js";
import * as api from "./lib/client.js";

const rateRows = (article, combos) => {
  const byStage={};
  for(const combo of combos){
    const stages=((((INPUTS.articles||{})[article]||{}).combos||{})[combo]||{}).rates||{};
    for(const [stage,materials] of Object.entries(stages)){
      for(const [material,rate] of Object.entries(materials||{})){
        const key=stage+"||"+material;
        if(!byStage[key]) byStage[key]={stage,material,rates:{}};
        byStage[key].rates[combo]=rate;
      }
    }
  }
  return Object.values(byStage);
};

export function ArticleRules({article,type,compact=false,editable=false,packingEdits={},onPackingEdit,
  singleEdits={},onSingleEdit}){
  const combos=articleTypeCombos(article,type);
  const rows=useMemo(()=>rateRows(article,combos),[article,combos.join("|")]);
  const packingSources=[...new Set(combos.map(c=>packingRuleSource(article,c).article))];
  const sizeEntries=combos.reduce((n,combo)=>n+comboSizesForArticle(article,combo,comboType(article,combo)).length,0);
  if(!article || !INPUTS.articles[article]) return null;
  return <div className={compact?"":"bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"}>
    {!compact&&<div className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div>
        <div className="text-base font-semibold text-slate-900">{article} packing chart</div>
        <div className="text-xs text-slate-500 mt-0.5">
          {combos.length} packing combination{combos.length===1?"":"s"} · {sizeEntries} size entries · {rows.length} BOM material/stage rules
        </div>
      </div>
      <div className="text-[11px] rounded-full border border-slate-200 bg-slate-50 text-slate-600 px-3 py-1">
        Showing {type&&type!=="ALL"?type:"all article types"}
      </div>
    </div>}
    <div className="text-xs font-semibold text-slate-700 mb-1.5">Combination packing</div>
    <div className="overflow-x-auto">
      <table className="w-full text-xs mb-3">
        <thead><tr className="text-slate-500 border-b border-slate-200">
          <th className="text-left py-1.5">Article</th><th className="text-left">Type</th>
          <th className="text-left">Packing combination</th><th className="text-left">Sizes packed in this combination</th>
          <th className="text-right">Pairs in one carton</th><th className="text-left px-2">Packing list used</th>
        </tr></thead>
        <tbody>{combos.map(combo=>{const source=packingRuleSource(article,combo);const rowType=comboType(article,combo)||"ALL";return <tr key={combo} className="border-b border-slate-100">
          <td className="py-1.5 font-semibold">{article}</td><td>{rowType}</td>
          <td className="mono font-semibold">{combo}</td>
          <td className="mono">{comboSizesForArticle(article,combo,rowType).join(", ")}</td>
          <td className="text-right mono font-semibold">{editable
            ? <input type="number" min="1" step="1"
                value={packingEdits[combo]??pairsPerCarton(article,combo)??""}
                onChange={e=>onPackingEdit&&onPackingEdit(combo,e.target.value)}
                aria-label={`${article} ${rowType} ${combo} pairs per carton`}
                className="w-20 text-right mono text-sm border border-slate-300 rounded px-2 py-1" />
            : pairsPerCarton(article,combo)??"Not set"}</td>
          <td className="px-2 text-slate-500">{source.article}{source.combo!==combo?` · ${source.combo}`:""}</td>
        </tr>})}</tbody>
      </table>
    </div>
    <details open={!compact} className="mb-3">
      <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Individual-size packing</summary>
      <div className="text-xs text-slate-500 mt-1 mb-2">
        A size uses its range&rsquo;s pairs/carton unless an individual override is shown. Enter a value to override;
        clear a saved override and save to return to the range default.
      </div>
      <div className="overflow-x-auto max-h-72 border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50"><tr>
            <th className="text-left px-2 py-1.5">Range</th><th className="text-left">Individual size</th>
            <th className="text-right">Pairs/carton</th><th className="text-left px-2">Source</th>
          </tr></thead>
          <tbody>{combos.flatMap(combo=>{const rowType=comboType(article,combo)||"ALL";return comboSizesForArticle(article,combo,rowType).map(size=>{
            const rule=singlePackingRule(article,size,rowType,combo);
            const editKey=`${rule.article}||${String(rule.size).toUpperCase()}`;
            const hasEdit=Object.prototype.hasOwnProperty.call(singleEdits,editKey);
            const shown=hasEdit?singleEdits[editKey].raw:(rule.kind==="individual override"?rule.ppc:"");
            const sourceLabel=hasEdit
              ? (singleEdits[editKey].raw===""?`Will inherit ${combo}`:"New individual override")
              : rule.kind==="range default"?`${rule.article} ${rule.combo} range default`
              : `${rule.article} ${rule.kind}`;
            return <tr key={`${combo}:${size}`} className="border-t border-slate-100">
              <td className="px-2 py-1.5 mono text-slate-500">{combo} · {rowType}</td><td className="mono font-semibold">{size}</td>
              <td className="text-right">{editable
                ? <input type="number" min="1" step="1" value={shown}
                    placeholder={rule.ppc??"Not set"}
                    onChange={e=>onSingleEdit&&onSingleEdit(rule.article,rule.size,e.target.value)}
                    aria-label={`${article} ${combo} size ${size} pairs per carton`}
                    className="w-20 text-right mono text-sm border border-slate-300 rounded px-2 py-1" />
                : rule.ppc??"Not set"}</td>
              <td className="px-2 text-slate-500">{sourceLabel}</td>
            </tr>;
          })})}</tbody>
        </table>
      </div>
    </details>
    {(packingSources.length!==1||packingSources[0]!==article) && <div className="text-xs rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 px-2 py-1.5 mb-3">
      {article} follows {packingSources.join(" / ")}'s packing list by matching range position. Editing these values updates the source list and every article that follows it.
    </div>}
    <details open={!compact}>
      <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Complete BOM used per pair ({rows.length} material/stage rules)</summary>
      <div className="text-xs text-slate-500 mt-1">Every stored size range is shown as a column. A dash means that material is not used for that range.</div>
      <div className="overflow-x-auto max-h-80 mt-2 border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50"><tr>
            <th className="text-left px-2 py-1.5">Stage</th><th className="text-left">Material / UOM</th>
            {combos.map(c=><th key={c} className="text-right px-2 mono">{c}</th>)}
          </tr></thead>
          <tbody>{rows.map(r=><tr key={r.stage+r.material} className="border-t border-slate-100">
            <td className="px-2 py-1 text-slate-500">{r.stage}</td><td>{r.material}</td>
            {combos.map(c=><td key={c} className="text-right px-2 mono">{r.rates[c]==null?"—":Number(r.rates[c]).toLocaleString("en-IN",{maximumFractionDigits:6})}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}

export default function ArticleRulesTab({onChanged,onUploadBom}){
  const articles=Object.keys(INPUTS.articles||{});
  const [article,setArticle]=useState(articles[0]||"");
  const types=articleTypes(article);
  const typeOptions=["ALL",...types.filter(t=>t!=="ALL")];
  const [chosenType,setChosenType]=useState("ALL");
  const [packingEdits,setPackingEdits]=useState({});
  const [singleEdits,setSingleEdits]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const type=typeOptions.includes(chosenType)?chosenType:"ALL";

  function clearEdits(){setPackingEdits({});setSingleEdits({});}
  function chooseArticle(next){setArticle(next);setChosenType("ALL");clearEdits();setMsg("");setErr("");}
  function chooseType(next){setChosenType(next);clearEdits();setMsg("");setErr("");}

  async function savePacking(){
    const changed=Object.entries(packingEdits);
    const changedSingles=Object.values(singleEdits);
    if(!changed.length&&!changedSingles.length) return;
    const groups={};
    const singleGroups={};
    try{
      for(const [combo,raw] of changed){
        const n=Number(raw);
        if(!Number.isInteger(n)||n<1) throw new Error(`${combo}: pairs per carton must be a whole number of 1 or more`);
        const source=packingRuleSource(article,combo);
        if(!groups[source.article]){
          const stored={...((INPUTS.packing||{})[source.article]||{})};
          const all=((INPUTS.articles||{})[source.article]?.combo_order)||[];
          for(const c of all){const current=pairsPerCarton(source.article,c);if(current!=null) stored[c]=current;}
          groups[source.article]=stored;
        }
        groups[source.article][source.combo]=n;
      }
      for(const {article:sourceArticle,size,raw} of changedSingles){
        if(!singleGroups[sourceArticle]) singleGroups[sourceArticle]={};
        if(raw==="") singleGroups[sourceArticle][size]=null;
        else{
          const n=Number(raw);
          if(!Number.isInteger(n)||n<1) throw new Error(`size ${size}: pairs per carton must be a whole number of 1 or more`);
          singleGroups[sourceArticle][size]=n;
        }
      }
      setBusy(true);setErr("");setMsg("");
      await api.patchReference({...(Object.keys(groups).length?{packing:groups}:{}),
        ...(Object.keys(singleGroups).length?{packing_singles:singleGroups}:{})});
      await reloadReference();
      clearEdits();
      const sources=[...new Set([
        ...changed.map(([combo])=>packingRuleSource(article,combo).article),
        ...changedSingles.map(item=>item.article),
      ])];
      setMsg(sources.length!==1||sources[0]!==article
        ? `Packing saved to ${sources.join(" / ")}, the source list ${article} follows. All linked articles now use the new values.`
        : `Packing saved for ${article}. Range defaults and individual overrides now apply to new and edited orders.`);
      onChanged&&onChanged();
    }catch(e){setErr("Could not save packing: "+(e.message||e));}
    finally{setBusy(false);}
  }

  return <div>
    <div className="flex gap-3 items-end flex-wrap mb-3">
      <label className="text-xs text-slate-500">Article
        <select value={article} onChange={e=>chooseArticle(e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {articles.map(a=><option key={a}>{a}</option>)}
        </select></label>
      <label className="text-xs text-slate-500">Article type
        <select value={type} onChange={e=>chooseType(e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {typeOptions.map(t=><option key={t} value={t}>{t==="ALL"?"All types":t}</option>)}
        </select></label>
      <button type="button" onClick={()=>onUploadBom&&onUploadBom(article)}
        className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-2 bg-white">
        Upload or replace BOM Excel
      </button>
    </div>
    <div className="text-xs text-slate-600 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 mb-3">
      This page is the current database view for the selected article. It shows every stored combination by default,
      the effective rule for every individual size, and the complete BOM. Packing quantities can be edited here;
      use the BOM Excel action for size-range or material changes.
    </div>
    <ArticleRules article={article} type={type} editable packingEdits={packingEdits}
      singleEdits={singleEdits}
      onPackingEdit={(combo,value)=>setPackingEdits(e=>({...e,[combo]:value}))}
      onSingleEdit={(sourceArticle,size,value)=>setSingleEdits(e=>({...e,
        [`${sourceArticle}||${String(size).toUpperCase()}`]:{article:sourceArticle,size:String(size).toUpperCase(),raw:value},
      }))}/>
    {err&&<div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3">{err}</div>}
    {msg&&<div className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-3">{msg}</div>}
    <div className="flex gap-2 mt-3">
      <button disabled={busy||(!Object.keys(packingEdits).length&&!Object.keys(singleEdits).length)} onClick={savePacking}
        className="text-xs font-semibold text-white rounded-lg px-4 py-2 bg-indigo-600 disabled:opacity-40">
        {busy?"Saving…":"Save packing changes"}</button>
      <button disabled={busy||(!Object.keys(packingEdits).length&&!Object.keys(singleEdits).length)} onClick={clearEdits}
        className="text-xs font-semibold border border-slate-300 rounded-lg px-4 py-2 bg-white disabled:opacity-40">Discard changes</button>
    </div>
  </div>;
}
