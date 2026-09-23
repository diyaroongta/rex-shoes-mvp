import React, { useMemo, useState } from "react";
import { catalogueTree, searchTree, filterTree, facetsOf } from "../shared/catalogue-tree.js";
import { articlePhoto } from "../shared/catalogue-seed.js";

/* BROWSING the catalogue, as against editing it.
   "Have they had Jack?" comes before "which Jack?", so the first screen is
   shoes — not the flat list of every article, where eighteen of them are
   Jacks and the one you want is between Glamour and Thunder. */

const SECTION_SUGGESTIONS = ["Toddler","MTO","Regular"];

export default function CatalogueBrowser({ articles, codes = {}, catalogue = {},
                                           canEdit = false, onSetSection, onOpenArticle }){
  const [query, setQuery] = useState("");
  const [sole, setSole] = useState("");
  const [section, setSection] = useState("");
  const [open, setOpen] = useState(null);

  const tree = useMemo(()=>catalogueTree(articles, { codes }), [articles, codes]);
  const facets = useMemo(()=>facetsOf(tree), [tree]);
  const shown = useMemo(
    ()=>searchTree(filterTree(tree, { sole, section }), query),
    [tree, sole, section, query]);
  const family = open ? shown.find(f => f.family === open) || tree.find(f => f.family === open) : null;

  const photoFor = v => (catalogue[v.article]||{}).image || articlePhoto(v.article) || null;

  return <div>
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <input value={query} onChange={e=>setQuery(e.target.value)}
        placeholder="Search a shoe, colour, closure or code — 'jack velcro', 'gola black'"
        aria-label="Search the catalogue"
        className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2" style={{minWidth:260}} />
      {query && <button onClick={()=>setQuery("")} className="text-xs text-slate-500 underline">clear</button>}
    </div>

    {/* TWO filter rows, never one. The factory's own catalogue mixes them —
        Thunder is in the Kindergarten section and has an EVA sole — so a
        single row would have to put Thunder in one place and be wrong in the
        other. */}
    <FilterRow label="Material" value={sole} onChange={setSole} options={facets.soles} />
    <FilterRow label="Section" value={section} onChange={setSection} options={facets.sections}
      empty={facets.sections.length
        ? null
        : "No article has been put in a section yet. Set one on any shoe below and its tab appears here."} />
    {facets.unsectioned > 0 && facets.sections.length > 0 &&
      <div className="text-xs text-amber-700 mb-2">
        {facets.unsectioned} of {facets.total} variants have no section set, so they appear only under “All”.</div>}

    {!family && <>
      <div className="text-xs text-slate-500 mb-2">
        {shown.length} shoe{shown.length===1?"":"s"} ·{" "}
        {shown.reduce((a,f)=>a+f.variants,0)} variant{shown.reduce((a,f)=>a+f.variants,0)===1?"":"s"}
      </div>
      <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))"}}>
        {shown.map(fam=>{
          const lead = fam.colours[0] && fam.colours[0].variants[0];
          return <button key={fam.family} onClick={()=>setOpen(fam.family)}
            className="text-left bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:border-indigo-300">
            <div className="h-28 bg-slate-100 flex items-center justify-center">
              {lead && photoFor(lead)
                ? <img src={photoFor(lead)} alt={fam.label} className="w-full h-full object-cover" />
                : <span className="text-xs text-slate-400">No photo</span>}
            </div>
            <div className="p-2.5">
              <div className="text-sm font-semibold text-slate-800">{fam.label}</div>
              <div className="text-xs text-slate-500">
                {fam.variants} variant{fam.variants===1?"":"s"} ·{" "}
                {fam.colours.length} colour{fam.colours.length===1?"":"s"}</div>
              <div className="mono text-[11px] text-slate-400">
                {[fam.code_prefix, ...fam.sole_types].filter(Boolean).join(" · ")}</div>
              {fam.without_bom>0 && <div className="text-[11px] text-amber-700 mt-0.5">
                {fam.without_bom} without a BOM</div>}
            </div>
          </button>;})}
      </div>
      {!shown.length && <div className="text-sm text-slate-500">
        Nothing matches “{query}”{sole||section?" in this filter":""}.</div>}
    </>}

    {family && <div>
      <button onClick={()=>setOpen(null)} className="text-xs font-semibold text-indigo-700 mb-2">← All shoes</button>
      <div className="text-lg serif text-slate-800">{family.label}</div>
      <div className="text-xs text-slate-500 mb-3">
        {family.variants} variant{family.variants===1?"":"s"} ·{" "}
        {[family.code_prefix, ...family.sole_types].filter(Boolean).join(" · ")}</div>

      {family.colours.map(colour=>(
        <div key={colour.label} className="mb-4">
          <div className="text-sm font-semibold text-slate-700 mb-1.5">{colour.label}</div>
          <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))"}}>
            {colour.variants.map(v=>(
              <div key={v.article} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="h-24 bg-slate-100 flex items-center justify-center">
                  {photoFor(v)
                    ? <img src={photoFor(v)} alt={v.article} className="w-full h-full object-cover" />
                    : <span className="text-xs text-slate-400">No photo</span>}
                </div>
                <div className="p-2">
                  <div className="text-xs font-semibold text-slate-800">
                    {v.closure_label || "No closure on record"}
                    {v.note && <span className="text-slate-400 font-normal"> · {v.note}</span>}</div>
                  <div className="mono text-[11px] text-slate-500 truncate" title={v.article}>{v.article}</div>
                  <div className="mono text-[11px] text-slate-400">
                    {[v.code, v.sole_type, `${v.ranges} range${v.ranges===1?"":"s"}`].filter(Boolean).join(" · ")}</div>
                  {!v.has_bom && <div className="text-[11px] text-amber-700">No BOM — cannot be ordered</div>}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {canEdit
                      ? <SectionPicker value={v.section||""} suggestions={SECTION_SUGGESTIONS}
                          existing={facets.sections}
                          onChange={next=>onSetSection && onSetSection(v.article, next)} />
                      : <span className="text-[11px] text-slate-500">{v.section || "No section set"}</span>}
                    {onOpenArticle && <button onClick={()=>onOpenArticle(v.article)}
                      className="text-[11px] font-semibold text-indigo-700 underline">edit</button>}
                  </div>
                </div>
              </div>))}
          </div>
        </div>))}
    </div>}
  </div>;
}

function FilterRow({ label, value, onChange, options, empty }){
  return <div className="flex items-center gap-1.5 flex-wrap mb-2">
    <span className="text-xs text-slate-500" style={{width:62}}>{label}</span>
    <button onClick={()=>onChange("")}
      className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${value===""
        ?"bg-indigo-600 text-white border-indigo-600":"bg-white text-slate-600 border-slate-300"}`}>All</button>
    {options.map(o=>(
      <button key={o} onClick={()=>onChange(value===o?"":o)}
        className={`text-xs font-semibold rounded-lg px-2.5 py-1 border ${value===o
          ?"bg-indigo-600 text-white border-indigo-600":"bg-white text-slate-600 border-slate-300"}`}>{o}</button>))}
    {empty && <span className="text-xs text-slate-400">{empty}</span>}
  </div>;
}

/* The section is the factory's own word, so the three the client named are
   offered and anything already in use is offered beside them — but typing a
   new one is allowed, because their printed catalogue uses different words
   again and this screen is not the place to overrule them. */
function SectionPicker({ value, suggestions, existing, onChange }){
  const options = [...new Set([...suggestions, ...existing])];
  return <select value={value} onChange={e=>onChange(e.target.value)}
    aria-label="Catalogue section"
    className="text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white">
    <option value="">No section</option>
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>;
}
