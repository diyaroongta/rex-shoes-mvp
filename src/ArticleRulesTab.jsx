import React, { useMemo, useState } from "react";
import { REF as INPUTS } from "./lib/refdata.js";
import { articleTypes, articleTypeCombos, comboSizesForArticle, pairsPerCarton } from "../shared/bridge.js";

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

export function ArticleRules({article,type,compact=false}){
  const combos=articleTypeCombos(article,type);
  const rows=useMemo(()=>rateRows(article,combos),[article,combos.join("|")]);
  if(!article || !INPUTS.articles[article]) return null;
  return <div className={compact?"":"bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"}>
    <div className="overflow-x-auto">
      <table className="w-full text-xs mb-3">
        <thead><tr className="text-slate-500 border-b border-slate-200">
          <th className="text-left py-1.5">Article</th><th className="text-left">Type</th>
          <th className="text-left">Size range</th><th className="text-left">PI sizes</th>
          <th className="text-right">Pairs/carton</th>
        </tr></thead>
        <tbody>{combos.map(combo=><tr key={combo} className="border-b border-slate-100">
          <td className="py-1.5 font-semibold">{article}</td><td>{type||"All"}</td>
          <td className="mono">{combo}</td>
          <td className="mono">{comboSizesForArticle(article,combo,type).join(", ")}</td>
          <td className="text-right mono font-semibold">{pairsPerCarton(article,combo)??"Not set"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {article==="SPIKE" && <div className="text-xs rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 px-2 py-1.5 mb-3">
      SPIKE follows ARMOUR's packing list by matching range position. If ARMOUR's packing is updated, SPIKE updates with it.
    </div>}
    <details open={!compact}>
      <summary className="text-xs font-semibold text-slate-700 cursor-pointer">BOM rates used per pair ({rows.length} material/stage rules)</summary>
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

export default function ArticleRulesTab(){
  const articles=Object.keys(INPUTS.articles||{});
  const [article,setArticle]=useState(articles[0]||"");
  const types=articleTypes(article);
  const [chosenType,setChosenType]=useState(types[0]||"ALL");
  const type=types.includes(chosenType)?chosenType:types[0];
  return <div>
    <div className="flex gap-3 items-end flex-wrap mb-3">
      <label className="text-xs text-slate-500">Article
        <select value={article} onChange={e=>{setArticle(e.target.value);setChosenType(articleTypes(e.target.value)[0]);}}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {articles.map(a=><option key={a}>{a}</option>)}
        </select></label>
      <label className="text-xs text-slate-500">Article type
        <select value={type} onChange={e=>setChosenType(e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {types.map(t=><option key={t}>{t}</option>)}
        </select></label>
    </div>
    <ArticleRules article={article} type={type}/>
  </div>;
}
