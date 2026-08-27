import React, { useState, useMemo, useRef, useEffect } from "react";
import { REF as INPUTS, catalogue as CATALOGUE, reload as reloadReference, source as refSource } from "./lib/refdata.js";
import { compute, fromDay, dayIndex } from "../shared/engine.js";
import { DEFAULT_PRICES, inr, matchArticle, singlePackQty, pairsPerCarton, readPrompt, articleTypes, articleTypeCombos, comboSizesForArticle, comboType } from "../shared/bridge.js";
import { buildPhotoCards } from "../shared/intake.js";
import * as api from "./lib/client.js";
import DataTab from "./DataTab.jsx";
import CatalogueTab from "./CatalogueTab.jsx";
import PiDocument from "./PiDocument.jsx";
import BulkOrderTab from "./BulkOrderTab.jsx";
import StockTab from "./StockTab.jsx";
import DispatchTab from "./DispatchTab.jsx";
import PartiesTab from "./PartiesTab.jsx";
import AddSize from "./AddSize.jsx";
import ArticleRulesTab, { ArticleRules } from "./ArticleRulesTab.jsx";
import MISDashboard from "./MISDashboard.jsx";
import { articlePhoto } from "../shared/catalogue-seed.js";
import { comboSizes, mrpForSize } from "../shared/pi.js";

/* ------------- UI helpers (shared) ------------- */
const SOLE_COLOR = {PVC:"#4f46e5",PU:"#0f9d6b",EVA:"#c2410c","STUCK-ON":"#7c3aed"};
const SLA_COLOR = {on_track:"#0f9d6b",at_risk:"#c2410c",breach:"#dc2626"};
const SLA_LABEL = {on_track:"On track",at_risk:"At risk",breach:"Breach"};
const STAGE_ABBR = {CUTTING:"CUT",STITCHING:"STI",MOLDING:"MLD",ASSEMBLY:"ASM",PACKING:"PCK"};
const fmt = (n,d=0)=>n==null||isNaN(n)?"—":Number(n).toLocaleString("en-IN",{maximumFractionDigits:d});
const niceDate = iso => iso ? new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : "—";

/* ------------- App shell ------------- */
export default function App(){
  const [orders, setOrders] = useState(null);   // null = loading
  const [dispatches, setDispatches] = useState([]);
  const [dispatchLoading, setDispatchLoading] = useState(true);
  const [dispatchErr, setDispatchErr] = useState("");
  const [caps, setCaps] = useState(()=>{const c={};for(const[k,w]of Object.entries(INPUTS.workcenters))c[k]=w.capacity_per_day;return c;});
  const [tab, setTab] = useState("mis");
  const [selected, setSelected] = useState(null);
  const [aiQ, setAiQ] = useState(""); const [aiA, setAiA] = useState(""); const [aiBusy, setAiBusy] = useState(false);

  const [loadErr, setLoadErr] = useState("");
  const [refTick, setRefTick] = useState(0);   // bumped when reference data is re-uploaded
  const [catalogueTick, setCatalogueTick] = useState(0);
  const [targets, setTargets] = useState(null);

  useEffect(()=>{ (async()=>{
    try{
      const [list, settings] = await Promise.all([api.listOrders(), api.getSettings()]);
      setOrders(list);
      if(settings && settings.capacities) setCaps(c=>({...c, ...settings.capacities}));
      if(settings && settings.sla_targets) setTargets(settings.sla_targets);
    }catch(e){ setLoadErr(e.message||String(e)); setOrders([]); }
  })(); },[]);

  useEffect(()=>{ (async()=>{
    try{ setDispatches(await api.listDispatches()); setDispatchErr(""); }
    catch(e){ setDispatchErr(e.message||String(e)); }
    finally{ setDispatchLoading(false); }
  })(); },[]);

  // The executive view is intended to stay open on a management screen. Pull
  // fresh orders and dispatch events once a minute so another clerk's update
  // appears without requiring a full browser reload.
  useEffect(()=>{
    const timer=setInterval(()=>{
      api.listOrders().then(setOrders).catch(()=>{});
      api.listDispatches().then(rows=>{setDispatches(rows);setDispatchErr("");}).catch(()=>{});
    },60000);
    return ()=>clearInterval(timer);
  },[]);

  // The server is the source of truth. Mutate, then re-read the list.
  const refresh = async ()=>{ try{ setOrders(await api.listOrders()); }catch(e){ setLoadErr(e.message||String(e)); } };
  const refreshDispatches = async ()=>{
    try{ setDispatchLoading(true); setDispatches(await api.listDispatches()); setDispatchErr(""); }
    catch(e){ setDispatchErr(e.message||String(e)); }
    finally{ setDispatchLoading(false); }
  };
  const bump = async (no,dir)=>{
    const cur=(orders||[]).find(o=>o.order_no===no); if(!cur)return;
    const next=Math.max(1,cur.priority+dir);
    setOrders(os=>os.map(o=>o.order_no===no?{...o,priority:next}:o));   // optimistic
    try{ await api.setPriority(no,next); }catch(e){ setLoadErr(e.message||String(e)); }
    refresh();
  };
  const removeOrder = async no =>{
    setOrders(os=>os.filter(o=>o.order_no!==no));                       // optimistic
    try{ await api.deleteOrder(no); }catch(e){ setLoadErr(e.message||String(e)); }
    refresh();
  };
  const editOrder = async (no, patch) => {
    await api.patchOrder(no, patch);     // server re-validates; errors surface in the panel
    await refresh();
  };
  // Returns the created rows so the intake screen can show the assigned order numbers.
  const addOrders = async drafts =>{
    const created = await api.createOrders(drafts);
    await refresh(); setTab("orders"); return created;
  };
  const clearAll = async ()=>{
    if(!window.confirm(`Remove all ${(orders||[]).length} live orders? PI snapshots remain in the PI database, but the production schedule will be emptied.`)) return;
    try{ await api.deleteAllOrders(); }catch(e){ setLoadErr(e.message||String(e)); }
    refresh();
  };

  // Capacities are shared config, not a per-browser preference — persist them (debounced).
  const capsLoaded = useRef(false);
  useEffect(()=>{
    if(!capsLoaded.current){ capsLoaded.current = true; return; }   // skip the initial hydrate
    const t=setTimeout(()=>{ api.putSettings({capacities:caps}).catch(()=>{}); }, 600);
    return ()=>clearTimeout(t);
  },[caps]);

  const wcs = useMemo(()=>{
    const w={};
    for(const[k,v]of Object.entries(INPUTS.workcenters)) w[k]={...v,capacity_per_day:caps[k]};
    // carried alongside the centres so the engine can apply per-order lead time
    Object.defineProperty(w,"_lead_time_rules",{value:INPUTS.lead_time_rules||null,enumerable:false});
    return w;
  },[caps,refTick]);
  const state = useMemo(()=> orders
    ? compute(
        // stitching/printing live on the pi blob; lift them so the engine sees them
        orders.map(o=>({ ...o,
          stitching:(o.pi&&o.pi.stitching)||o.stitching||"inhouse",
          printing:(o.pi&&o.pi.printing)||o.printing||false })),
        INPUTS.articles, INPUTS.materials, wcs, INPUTS.origin, targets?{targets}:{})
    : null, [orders,wcs,refTick,targets]);

  async function askAI(){
    if(!aiQ.trim()||!state)return; setAiBusy(true); setAiA("");
    // The engine computes per-stage detail — which stage is late, by how many
    // days, what's queued behind what. The copilot is only as specific as the
    // context we hand it, so send the reasoning, not just the headline.
    const worstStage = o => {
      const bad = o.stages.filter(s=>s.status!=="on_track");
      if(!bad.length) return null;
      const w = bad.reduce((a,b)=> (b.slip_days>a.slip_days ? b : a));
      return { stage:w.stage, status:w.status, slip_days:w.slip_days, work_center:w.work_center, end_date:w.end_date };
    };
    const ctx = {
      today: fromDay(0, INPUTS.origin),
      orders: state.orders.map(o=>({
        order:o.order_no, party:o.party, article:o.article, sole_type:o.sole_type,
        qty:o.qty, priority:o.priority, order_date:o.order_date,
        dispatch:o.dispatch_date, lead_days:o.lead_days, sla:o.sla,
        worst_stage: worstStage(o),
        unknown_combos: o.unknown_combos && o.unknown_combos.length ? o.unknown_combos : undefined,
      })),
      sla_targets: targets || {CUTTING:8,STITCHING:15,PRINTING:18,MOLDING:22,ASSEMBLY:22,PACKING:28,DISPATCH:30},
      machines: state.machine_load.map(m=>({
        center:m.name, work_center:m.work_center, capacity_per_day:m.capacity_per_day,
        peak_util_pct:m.peak_util_pct, avg_util_pct:m.avg_util_pct, busy_days:m.busy_days,
      })),
      schedule_problems: state.schedule_problems,
      procurement: state.procurement.slice(0,15).map(p=>({material:p.name,uom:p.uom,required:p.required,stock:p.stock,shortfall:p.shortfall})),
      totals: state.totals,
    };
    try{
      const text = await api.askCopilot(aiQ, ctx);
      setAiA(text.trim() || "No answer.");
    }catch(e){ setAiA("Could not reach the copilot: "+(e.message||e)); }
    finally{ setAiBusy(false); }
  }

  if(!orders || !state) return <div className="min-h-screen flex items-center justify-center"
      style={{background:"#F6F8FA",fontFamily:"Inter,system-ui,sans-serif",color:"#6B7C90",fontSize:14}}>
    Loading the order sheet…</div>;

  const t = state.totals;

  /* Grouped navigation. Badges show work actually outstanding, so the sidebar
     answers "what needs me?" without opening anything. */
  const lateCount = state.orders.filter(o=>o.sla!=="on_track").length;
  const nav = [
    ["Overview", [
      ["mis","Executive MIS", {n:state.totals.sla.breach, tone:"#BE123C"}],
    ]],
    ["Orders", [
      ["intake","PI generation"],
      ["pis","PI database"],
      ["bulk","Bulk upload"],
      ["orders","Orders & dispatch", {n:lateCount, tone:"#BE123C"}],
      ["dispatch","Dispatch & packing"],
    ]],
    ["Production", [
      ["schedule","Schedule"],
      ["plan","Production plan"],
      ["machines","Machine load"],
    ]],
    ["Materials", [
      ["procurement","Procurement", {n:state.procurement.length, tone:"#B45309"}],
      ["stock","Stock register"],
    ]],
    ["Setup", [
      ["parties","Parties & terms"],
      ["catalogue","Catalogue"],
      ["rules","Packing & BOM rules"],
      ["data","Data & BOM"],
    ]],
  ];

  const errBanner = loadErr ? <div className="text-xs rounded-xl border border-red-200 bg-red-50 text-red-800 px-3 py-2 mb-3">
    Could not reach the server: {loadErr}. Check that <code className="mono">DATABASE_URL</code> is set and the schema has been applied.
  </div> : null;
  return (
    <div className="min-h-screen w-full" style={{background:"var(--paper)",color:"var(--text)",fontFamily:"Inter,system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root{
          --ink:#0F2233; --ink-2:#183149; --ink-3:#24425E;
          --paper:#F6F8FA; --card:#FFFFFF; --rule:#E4E9F0;
          --text:#1B2836; --muted:#6B7C90;
          --accent:#0B6BCB; --warn:#B45309; --bad:#BE123C; --good:#047857;
        }
        /* Factory signage vernacular: condensed caps for labels, monospace for
           every figure. The numbers are the content here, so they get their
           own face rather than sharing the body font. */
        .sign{font-family:'Barlow Condensed',Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase}
        .serif{font-family:'Barlow Condensed',Inter,sans-serif;letter-spacing:.01em}
        .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
        *::-webkit-scrollbar{height:8px;width:8px}
        *::-webkit-scrollbar-thumb{background:#C3CDD9;border-radius:4px}
        .navitem{display:flex;align-items:center;gap:.5rem;width:100%;text-align:left;
          padding:.44rem .7rem;border-radius:7px;font-size:13.5px;color:#B9C7D6;
          transition:background .12s,color .12s}
        .navitem:hover{background:#183149;color:#fff}
        .navitem[data-on="1"]{background:#0B6BCB;color:#fff;font-weight:600}
        .navitem:focus-visible{outline:2px solid #7DB3F0;outline-offset:1px}
        .navbadge{margin-left:auto;font-size:10.5px;padding:1px 6px;border-radius:99px;
          font-family:'IBM Plex Mono',monospace;font-weight:600;color:#fff}
        @media (prefers-reduced-motion:reduce){*{transition:none!important}}
      `}</style>

      <div style={{display:"flex",minHeight:"100vh"}}>

        <aside data-noprint className="hidden md:flex"
               style={{background:"#0F2233",width:212,flexShrink:0,flexDirection:"column",
                       position:"sticky",top:0,height:"100vh"}}>
          <div style={{padding:"18px 16px 14px"}}>
            <div className="sign" style={{color:"#fff",fontSize:19,fontWeight:700,lineHeight:1}}>Factory OS</div>
            <div className="mono" style={{color:"#7B8FA6",fontSize:10,marginTop:5}}>
              {fmt(t.orders)} live · {fmt(t.total_pairs)} pairs
            </div>
          </div>

          <nav style={{padding:"0 10px",overflowY:"auto",flex:1}}>
            {nav.map(([group,items])=>(
              <div key={group} style={{marginBottom:14}}>
                <div className="sign" style={{color:"#5C7A99",fontSize:10,padding:"0 8px 5px",fontWeight:600}}>{group}</div>
                {items.map(([k,label,badge])=>(
                  <button key={k} onClick={()=>setTab(k)} data-on={tab===k?"1":"0"} className="navitem">
                    <span>{label}</span>
                    {badge && badge.n>0 && <span className="navbadge" style={{background:badge.tone}}>{badge.n}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div style={{padding:10,borderTop:"1px solid #183149"}}>
            <button onClick={()=>setTab("copilot")} data-on={tab==="copilot"?"1":"0"} className="navitem">
              <span>Ask the copilot</span>
            </button>
          </div>
        </aside>

        <div data-noprint className="md:hidden" style={{position:"sticky",top:0,zIndex:20,background:"#0F2233",padding:"10px 12px"}}>
          <div className="sign" style={{color:"#fff",fontSize:16,fontWeight:700,marginBottom:8}}>Factory OS</div>
          <select value={tab} onChange={e=>setTab(e.target.value)}
            style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #24425E",
                    background:"#183149",color:"#fff",fontSize:14}}>
            {nav.map(([group,items])=>(
              <optgroup key={group} label={group}>
                {items.map(([k,label])=><option key={k} value={k}>{label}</option>)}
              </optgroup>
            ))}
            <option value="copilot">Ask the copilot</option>
          </select>
        </div>

        <main style={{flex:1,minWidth:0}}>
          <header data-noprint style={{background:"#fff",borderBottom:"1px solid #E4E9F0",padding:"13px 22px",
                          display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",
                          position:"sticky",top:0,zIndex:10}}>
            <div>
              <h1 className="serif" style={{fontSize:21,fontWeight:600,margin:0,letterSpacing:"-.01em"}}>
                {(VIEWS[tab]||{}).title || "Factory OS"}
              </h1>
              <div style={{fontSize:12,color:"#6B7C90",marginTop:1}}>{(VIEWS[tab]||{}).sub || ""}</div>
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:22,flexWrap:"wrap"}}>
              <Stat label="Last dispatch" value={niceDate(t.last_dispatch)||"—"} />
              <Stat label="At risk / late" value={`${t.sla.at_risk} / ${t.sla.breach}`}
                    tone={t.sla.breach?"#BE123C":t.sla.at_risk?"#B45309":"#047857"} />
              <Stat label="To procure" value={state.procurement.length}
                    tone={state.procurement.length?"#B45309":"#047857"} />
            </div>
          </header>

          {state.schedule_problems.length>0 && (
            <div style={{margin:"14px 22px 0",padding:"9px 12px",borderRadius:8,fontSize:12.5,
                         background:"#FFF1F2",border:"1px solid #FECDD3",color:"#9F1239"}}>
              {state.schedule_problems.join("; ")}
            </div>
          )}

          <div style={{padding:"18px 22px 60px"}}>

        {/* Keep PI intake mounted while navigating. Its draft belongs to the
            clerk until Save or Close PI, not to the currently visible tab. */}
        <div style={{display:tab==="intake"?"block":"none"}}><NewOrderFlow onSaved={addOrders} catalogueVersion={catalogueTick} /></div>
        {tab==="mis" && <MISDashboard state={state} dispatches={dispatches} dispatchLoading={dispatchLoading} dispatchError={dispatchErr}
          onRefresh={async()=>{await Promise.all([refresh(),refreshDispatches()]);}} />}
        {tab==="pis" && <PiDatabaseTab orders={orders} onScheduled={refresh} />}
        {tab==="orders" && <>
          <OrdersTab state={state} onBump={bump} onSelect={setSelected} selected={selected} onRemove={removeOrder} onEdit={editOrder} />
          <div className="flex gap-2 mt-3">
            <button onClick={()=>downloadSheetCSV(orders)} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white hover:bg-slate-50">Download order sheet (CSV)</button>
            <button onClick={clearAll} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-500">Clear all orders</button>
          </div></>}
        {tab==="schedule" && <ScheduleTab state={state} />}
        {tab==="plan" && <PlanTab state={state} caps={caps} />}
        {tab==="procurement" && <ProcurementTab state={state} />}
        {tab==="machines" && <MachinesTab state={state} caps={caps} setCaps={setCaps} targets={targets} setTargets={setTargets} />}
        {tab==="dispatch" && <DispatchTab orders={state.orders} onChanged={async()=>{await refresh();await refreshDispatches();}} />}
        {tab==="stock" && <StockTab onChanged={()=>setRefTick(t=>t+1)} />}
        {tab==="bulk" && <BulkOrderTab onImported={async()=>{ await refresh(); setTab("schedule"); }} />}
        {tab==="parties" && <PartiesTab />}
        {tab==="catalogue" && <CatalogueTab
          onChanged={()=>{setRefTick(t=>t+1);setCatalogueTick(t=>t+1);}}
          onAddBom={()=>setTab("data")} />}
        {tab==="rules" && <ArticleRulesTab onChanged={()=>setRefTick(t=>t+1)} onUploadBom={()=>setTab("data")} />}
        {tab==="data" && <DataTab onChanged={()=>setRefTick(t=>t+1)} />}
        {tab==="copilot" && <CopilotTab q={aiQ} setQ={setAiQ} a={aiA} busy={aiBusy} ask={askAI} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function downloadSheetCSV(orders){
  const combos=[...new Set(orders.flatMap(o=>(o.lines||[]).map(l=>l.combo)))];
  const rows=[["order_no","order_date","party","article","priority","pi_no","order_nature","print","vl","sole_colour","upper_colour",...combos.map(c=>`pairs_${c}`)]];
  orders.forEach(o=>{const by={};for(const l of (o.lines||[]))by[l.combo]=(by[l.combo]||0)+(Number(l.qty)||0);rows.push([
    o.order_no,o.order_date,o.party,o.article_code,o.priority,(o.pi&&o.pi.pi_no)||"",
    (o.pi&&o.pi.order_nature)||"",(o.pi&&o.pi.printing)?"Yes":"No",(o.pi&&o.pi.vl)||"",
    (o.pi&&o.pi.sole_colour)||"",(o.pi&&o.pi.upper_colour)||"",...combos.map(c=>by[c]||""),
  ]);});
  const csv=rows.map(r=>r.map(c=>{const s=String(c);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",")).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  const a=document.createElement("a");a.href=url;a.download="order_sheet.csv";document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}

/* ------------- New order: photo -> read -> match -> PI -> save ------------- */
const packQty = (article, combo) => pairsPerCarton(article, combo);

/* What to print in the article's V/L column. A shoe ordered in both rolls says
   so, rather than being split into two articles to give each one a value. */
const vlSummary = card => {
  const rolls=[...new Set((card.lines||[])
    .map(l=>l.type||comboType(card.article,l.combo)).filter(Boolean))];
  if(rolls.length>1) return rolls.map(r=>r[0]+r.slice(1).toLowerCase()).join(" + ");
  if(rolls.length===1) return rolls[0][0]+rolls[0].slice(1).toLowerCase();
  return card.vl||"";
};

function NewOrderFlow({onSaved,catalogueVersion=0}){
  const [img,setImg]=useState(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [cards,setCards]=useState(null);
  const [rawRead,setRawRead]=useState("");   // exactly what the reader returned, for diagnosing bad reads      // [{article, lines:[{combo,cartons,ppc,exact}]}]
  const [party,setParty]=useState("");
  const [priority,setPriority]=useState(2);
  const [orderDate,setOrderDate]=useState(new Date().toISOString().slice(0,10));
  const cataloguePrices=()=>Object.fromEntries(Object.entries(CATALOGUE||{})
    .filter(([,entry])=>entry&&entry.price!=null&&Number.isFinite(Number(entry.price)))
    .map(([article,entry])=>[article,Number(entry.price)]));
  const [prices,setPrices]=useState(()=>({...DEFAULT_PRICES,...cataloguePrices()}));
  useEffect(()=>{setPrices(current=>({...current,...cataloguePrices()}));},[catalogueVersion]);
  const [saving,setSaving]=useState(false);
  const [generatingPi,setGeneratingPi]=useState(false);
  const [readingPi,setReadingPi]=useState(false);
  const [piCards,setPiCards]=useState(null);
  const [piPreviewCards,setPiPreviewCards]=useState(null);
  const [piPreviewSignature,setPiPreviewSignature]=useState("");
  const [customerCity,setCustomerCity]=useState("");
  const [vl,setVl]=useState("");
  const [soleColour,setSoleColour]=useState("Black");
  const [upperColour,setUpperColour]=useState("");
  const [remarks,setRemarks]=useState("None");
  const [orderNature,setOrderNature]=useState("");
  const [stitching,setStitching]=useState("inhouse");
  // One sheet usually means one customer. Turned on automatically when the
  // reader finds more than one name, because party belongs to each order.
  const [multiParty,setMultiParty]=useState(false);
  const [printing,setPrinting]=useState(false);
  const [attachment,setAttachment]=useState(null);
  const [discountPct,setDiscountPct]=useState(40);
  const [parties,setParties]=useState([]);
  const [piTerms,setPiTerms]=useState(null);
  const [piConfig,setPiConfig]=useState(null);
  useEffect(()=>{ Promise.all([api.getSettings(),api.listParties().catch(()=>[])])
    .then(([v,partyRows])=>{ if(v.pi_terms) setPiTerms(v.pi_terms); if(v.pi_config) setPiConfig(v.pi_config);
               if(v.pi_terms && v.pi_terms.discount_pct!=null) setDiscountPct(v.pi_terms.discount_pct);
               setParties(partyRows||[]); })
    .catch(()=>{}); },[]);
  const [piNo,setPiNo]=useState("");
  const [savedMsg,setSavedMsg]=useState("");
  const [pasteText,setPasteText]=useState("");
  const fileRef=useRef(null);
  const allocatePiNo=async()=>{
    try{const r=await api.nextPiNumber();setPiNo(r.pi_no);return r.pi_no;}
    catch(e){setErr("Could not allocate a PI number: "+(e.message||e));return "";}
  };
  useEffect(()=>{allocatePiNo();},[]);
  const ARTS=Object.keys(INPUTS.articles).filter(article=>
    ((INPUTS.articles[article]||{}).combo_order||Object.keys((INPUTS.articles[article]||{}).combos||{})).length>0);
  const withArticleDetails = (card, extra={}) => ({
    party,
    customer_city:customerCity,
    order_date:orderDate,
    priority:Number(priority)||2,
    order_nature: orderNature,
    stitching,
    printing,
    vl,
    sole_colour: soleColour,
    upper_colour: upperColour,
    ...card,
    ...extra,
  });
  const sourceCards=piCards||cards||[];
  const sourceSignature=JSON.stringify(sourceCards.map(c=>({
    article:c.article,party:c.party,customer_city:c.customer_city,order_date:c.order_date,
    priority:c.priority,order_nature:c.order_nature,stitching:c.stitching,
    printing:c.printing,vl:c.vl,sole_colour:c.sole_colour,upper_colour:c.upper_colour,
    dispatch_timeline:c.dispatch_timeline,
    lines:(c.lines||[]).map(l=>({combo:l.combo,cartons:l.cartons,ppc:l.ppc,qty:l.qty,sizes:l.sizes}))
  })));
  const previewStale=!!piPreviewCards && piPreviewSignature!==sourceSignature;
  const termsForParty = (name, partyRows=parties, baseTerms=piTerms, fallbackDiscount=discountPct) => {
    const key=String(name||"").trim().toLowerCase();
    const base=baseTerms||{};
    const master=(partyRows||[]).find(p=>String(p.name||"").trim().toLowerCase()===key);
    if(!master) return {...base,
      discount_pct:Number(base.discount_pct??fallbackDiscount)||0,
      dispatch_timeline:String(base.dispatch_timeline||"45 days")};
    return {...base,
      discount_pct:Number(master.discount_pct??base.discount_pct??fallbackDiscount)||0,
      deductions:Array.isArray(master.deductions)?master.deductions:base.deductions,
      gst_pct:Number(master.gst_pct??base.gst_pct??0),
      payment_split_pct:Number(master.payment_split_pct??base.payment_split_pct??0),
      dispatch_timeline:String(master.dispatch_timeline||base.dispatch_timeline||"45 days")};
  };

  /* Commercial terms are deliberately re-read at the moment Generate is
     pressed. The preview is then a stable snapshot: a party-master change made
     after the page was opened cannot leave the new PI on an old discount. */
  const generatePiPreview=async()=>{
    setGeneratingPi(true); setErr("");
    try{
      const [latestSettings,latestParties]=await Promise.all([api.getSettings(),api.listParties()]);
      const base=latestSettings.pi_terms||piTerms||{};
      const snapshot=structuredClone(sourceCards).map(card=>{
        const commercial=termsForParty(card.party,latestParties,base,base.discount_pct);
        const timeline=String(card.dispatch_timeline||commercial.dispatch_timeline||"45 days").trim();
        return {...card,dispatch_timeline:timeline,
          commercial_terms:{...commercial,dispatch_timeline:timeline}};
      });
      setPiTerms(base); setPiConfig(latestSettings.pi_config||piConfig);
      setParties(latestParties||[]);
      if(base.discount_pct!=null) setDiscountPct(base.discount_pct);
      setPiPreviewCards(snapshot); setPiPreviewSignature(sourceSignature);
    }catch(e){
      setErr("Could not reload the latest party and discount terms. PI was not generated: "+(e.message||e));
    }finally{setGeneratingPi(false);}
  };

  function handleFile(file){
    if(!file)return; setErr("");
    const rd=new FileReader();
    rd.onload=e=>{ const im=new Image();
      im.onload=()=>{ const max=1280; let w=im.width,h=im.height;
        if(w>max||h>max){ if(w>=h){h=Math.round(h*max/w);w=max;} else {w=Math.round(w*max/h);h=max;} }
        const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
        cv.getContext("2d").drawImage(im,0,0,w,h);
        setImg(cv.toDataURL("image/jpeg",0.75)); };
      im.src=e.target.result; };
    rd.readAsDataURL(file);
  }

  function applyReadText(raw){
    let text=String(raw||"").trim().replace(/```json/gi,"").replace(/```/g,"").trim();
    const a=text.indexOf("{"),b=text.lastIndexOf("}");
    if(a>-1&&b>-1) text=text.slice(a,b+1);
    setRawRead(text);
    const parsed=JSON.parse(text);
    // A sheet routinely lists several customers. Each order carries its own
    // party; the header field is only a fallback for a genuinely single-party
    // sheet, so it is never used to overwrite a party the reader actually read.
    const readParties=[...new Set((parsed.orders||[]).map(o=>(o.party||"").trim()).filter(Boolean))];
    // A NEW sheet gets a new customer. Keeping the previous read's name because
    // this one has none silently files one factory's order under another
    // factory's account — the same "party belongs to the order, not the sheet"
    // rule, applied across reads instead of within one.
    setParty(readParties.length===1 ? readParties[0] : "");
    setCustomerCity("");
    setMultiParty(readParties.length>1);
    if(parsed.date){
      const today=new Date(); const rd=new Date(parsed.date);
      const diff=(rd-today)/86400000;
      if(!isNaN(rd) && diff>-90 && diff<30) setOrderDate(parsed.date);
      else setErr("Read the sheet date as "+parsed.date+", which looks wrong (dates are DD/MM in India) — kept today's date. Edit it in step 2 if needed.");
    }
    ingest(parsed);
  }

  /* Read an existing Proforma Invoice (PDF or scan) straight into the order
     sheet. Per-size quantities are kept exactly as printed — they are not
     re-derived from a carton count, so the regenerated PI matches the original
     line for line. */
  async function ingestPi(file){
    setReadingPi(true); setErr(""); setSavedMsg("");
    try{
      const b64 = await new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=()=>res(String(r.result).split(",")[1]);
        r.onerror=()=>rej(new Error("Could not read that file."));
        r.readAsDataURL(file);
      });
      let text = await api.readPi(b64, file.type || "application/pdf");
      const a=text.indexOf("{"), z=text.lastIndexOf("}");
      if(a>-1&&z>-1) text=text.slice(a,z+1);
      const d=JSON.parse(text);
      setRawRead(JSON.stringify(d,null,1));

      // Same rule as a photo read: this PI's customer, or none — never the
      // customer left over from the last thing that was read.
      setParty(String(d.customer||"").trim());
      setMultiParty(false);
      if(d.customer_city) setCustomerCity(d.customer_city);
      if(d.pi_date && /^\d{4}-\d{2}-\d{2}$/.test(d.pi_date)) setOrderDate(d.pi_date);
      if(d.order_no) setPiNo(d.order_no);
      if(d.discount_pct!=null) setDiscountPct(Number(d.discount_pct));

      const built=[]; const notes=[];
      for(const item of (d.items||[])){
        const art = matchArticle(item.article,"") || item.article;
        if(!INPUTS.articles[art]){ notes.push(`"${item.article}" is not a known article`); continue; }
        if(item.vl) setVl(item.vl);
        if(item.sole_colour) setSoleColour(item.sole_colour);
        if(item.upper_colour) setUpperColour(item.upper_colour);

        // group the per-size rows back onto the article's own size ranges
        const itemType=item.vl||vl;
        const combos=articleTypeCombos(art,itemType);
        const bySize={}; for(const r of (item.rows||[])) if(r&&r.size!=null) bySize[String(r.size)]=Number(r.qty)||0;
        const lines=[];
        for(const combo of combos){
          const sizes=comboSizesForArticle(art,combo,itemType);
          const hit=sizes.filter(sz=>bySize[sz]!=null);
          if(!hit.length) continue;
          const sizeMap={}; let qty=0;
          for(const sz of sizes){ const v=bySize[sz]||0; sizeMap[sz]=v; qty+=v; delete bySize[sz]; }
          if(qty>0) lines.push({combo, qty, sizes:sizeMap, label:combo});
        }
        const leftover=Object.keys(bySize).filter(k=>bySize[k]>0);
        if(leftover.length) notes.push(`${art}: sizes ${leftover.join(", ")} do not fall in any of its size ranges`);
        if(lines.length) built.push(withArticleDetails({article:art, lines, fromPi:true}, {
          party:d.customer||party, customer_city:d.customer_city||customerCity,
          order_date:d.pi_date||orderDate, priority:Number(d.priority)||Number(priority)||2,
          vl:item.vl||vl, sole_colour:item.sole_colour||soleColour,
          upper_colour:item.upper_colour||upperColour,
          order_nature:item.order_nature||orderNature,
          dispatch_timeline:d.dispatch_timeline||d.terms?.dispatch_timeline||"",
          printing:item.printing==null?printing:!!item.printing,
        }));
      }
      if(!built.length) throw new Error("No recognisable article lines were found in that PI.");
      setPiCards(built); setCards(null); setPiPreviewCards(null); setPiPreviewSignature("");
      setSavedMsg(`Read ${built.length} article(s), ${built.reduce((a,c)=>a+c.lines.length,0)} size ranges from the PI.`
        + (notes.length ? "  Check: "+notes.join("; ") : ""));
    }catch(e){ setErr("Could not read that PI: "+(e.message||e)); }
    finally{ setReadingPi(false); }
  }

  function shrink(dataUrl,maxDim,quality){
    return new Promise((resolve,reject)=>{
      const im=new Image();
      im.onload=()=>{ let w=im.width,h=im.height;
        if(w>maxDim||h>maxDim){ if(w>=h){h=Math.round(h*maxDim/w);w=maxDim;} else {w=Math.round(w*maxDim/h);h=maxDim;} }
        const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
        cv.getContext("2d").drawImage(im,0,0,w,h);
        resolve(cv.toDataURL("image/jpeg",quality)); };
      im.onerror=()=>reject(new Error("image shrink failed"));
      im.src=dataUrl;
    });
  }

  async function readOrder(){
    if(!img)return; setBusy(true); setErr(""); setSavedMsg("");
    let lastErr=null;
    for(let attempt=1; attempt<=2; attempt++){
      try{
        const payload = attempt===1 ? img : await shrink(img, 900, 0.6);
        const text = await api.readOrderPhoto(payload.split(",")[1]);
        if(!text.trim()) throw new Error("Empty reply from the reader");
        applyReadText(text);
        setBusy(false);
        return;
      }catch(e){ lastErr=e; }
    }
    setErr("Automatic read failed: "+((lastErr&&lastErr.message)||lastErr)+" — use 'Enter by hand', or the paste option below.");
    setBusy(false);
  }

  function ingest(parsed){
    const built=buildPhotoCards(parsed,INPUTS);
    const out=built.cards.map(card=>withArticleDetails(card,{
      order_date:parsed.date||orderDate,
      priority:Number(card.priority)||Number(priority)||2,
    }));
    setCards(out.length?out:null); setPiCards(null); setPiPreviewCards(null); setPiPreviewSignature("");
    if(built.issues.length) setErr(built.issues.join(" "));
    if(!out.length) setErr("Nothing readable found — try a clearer photo or enter by hand.");
  }

  function blankCard(){ const art=ARTS[0]; const type=articleTypes(art)[0]; const c=articleTypeCombos(art)[0];
    return withArticleDetails({article:art, vl:type==="ALL"?"":comboType(art,c), matched:true, raw:"",
      lines:[{combo:c,type:comboType(art,c),exact:true,raw:"",cartons:0,ppc:packQty(art,c)??""}]}); }
  const startBlank=()=>{ setCards([blankCard()]); setPiCards(null); setPiPreviewCards(null); setPiPreviewSignature(""); setErr(""); setSavedMsg(""); };

  const setCard=(i,patch)=>setCards(cs=>cs.map((c,j)=>j===i?{...c,...patch}:c));
  const setPiCard=(i,patch)=>setPiCards(cs=>cs.map((c,j)=>j===i?{...c,...patch}:c));
  const setLine=(i,k,patch)=>setCards(cs=>cs.map((c,j)=>j===i?{...c,lines:c.lines.map((l,m)=>m===k?{...l,...patch}:l)}:c));
  const addLine=i=>setCards(cs=>cs.map((c,j)=>{ if(j!==i)return c;
    // Offer the WHOLE shoe, not one roll: a size range that is already on the
    // card is skipped, so the next Velcro range then the next Lace range come
    // up naturally without the article being split in two.
    const used=new Set(c.lines.map(l=>l.combo));
    const all=articleTypeCombos(c.article);
    const cb=all.find(x=>!used.has(x))||all[0];
    return {...c,lines:[...c.lines,{combo:cb,type:comboType(c.article,cb),exact:true,raw:"",cartons:0,
      ppc:packQty(c.article,cb)??"",size_order:comboSizesForArticle(c.article,cb)}]}; }));
  const delLine=(i,k)=>setCards(cs=>cs.map((c,j)=>j===i?{...c,lines:c.lines.filter((_,m)=>m!==k)}:c));
  const addCard=()=>setCards(cs=>[...(cs||[]),blankCard()]);
  const delCard=i=>setCards(cs=>cs.filter((_,j)=>j!==i));
  /* Changing the article remaps each line onto the equivalent range of the new
     article BY POSITION across its whole range list — both rolls together, so a
     Velcro line stays Velcro and a Lace line stays Lace instead of the shoe
     being flattened onto one half. */
  function remapForArticle(card,art){
    const oldCombos=articleTypeCombos(card.article);
    const combos=articleTypeCombos(art);
    const lines=(card.lines||[]).map((l,k)=>{
      const foundPos=oldCombos.indexOf(l.combo);
      const oldPos=foundPos>=0?foundPos:k;
      const combo=combos[Math.min(oldPos,combos.length-1)]||combos[0];
      const ppc=packQty(art,combo)??"";
      const sizes=comboSizesForArticle(art,combo);          // the range decides the roll
      const type=comboType(art,combo);
      if(card.fromPi){
        const qty=Number(l.qty)||Object.values(l.sizes||{}).reduce((a,b)=>a+(Number(b)||0),0);
        const base=Math.floor(qty/Math.max(1,sizes.length)), rem=qty-base*sizes.length;
        return {...l,combo,type,ppc,qty,sizes:Object.fromEntries(sizes.map((s,n)=>[s,base+(n<rem?1:0)])),size_order:sizes};
      }
      // Not a PI card: any exact sizes were keyed to the OLD article's size
      // list. Keeping them against a new list silently strands pairs, so they
      // are dropped and the line reverts to a carton count.
      const keep=l.sizes && Object.keys(l.sizes).every(s=>sizes.includes(String(s)));
      return {...l,combo,type,ppc,size_order:sizes,...(keep?{}:{sizes:undefined})};
    });
    const present=[...new Set(lines.map(l=>l.type).filter(Boolean))];
    return {...card,article:art,vl:present.length===1?present[0]:"",types:present,matched:true,lines};
  }
  function onArticleChange(i,art){
    setCards(cs=>cs.map((c,j)=>j===i?remapForArticle(c,art):c));
  }
  function onPiArticleChange(i,art){
    setPiCards(cs=>cs.map((c,j)=>j===i?remapForArticle(c,art):c));
  }
  /* Only free-type articles (the legacy "(V)"/"(L)" codes) still carry a
     card-level V/L. For a split article the size ranges already say it. */
  function onTypeChange(i,type,isPi=false){
    const setter=isPi?setPiCards:setCards;
    setter(cs=>cs.map((c,j)=>j===i?{...c,vl:type}:c));
  }

  /* A sheet belongs to ONE customer on one date far more often than not, so
     those fields are asked once at the top and pushed to every article. Only a
     genuinely multi-party sheet reveals a per-article customer, and the reader
     turns that on by itself when it reads more than one name. */
  const applyToAll = patch => {
    const stamp = cs => (cs ? cs.map(c => ({...c, ...patch})) : cs);
    setCards(stamp); setPiCards(stamp); setPiPreviewCards(stamp);
  };
  const FIELD = "block mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5";
  const LABEL = "text-xs font-medium text-slate-500";

  const sheetHeader = () => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 mb-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="sign text-slate-500" style={{fontSize:10.5,fontWeight:600}}>Applies to every article below</div>
        <label className="ml-auto text-xs text-slate-500 flex items-center gap-1.5">
          <input type="checkbox" checked={multiParty} onChange={e=>setMultiParty(e.target.checked)} />
          Different customers on this sheet
        </label>
      </div>
      <div className="grid gap-2" style={{gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))"}}>
        {!multiParty && <>
          <label className={LABEL}>Customer *
            <input list="party-options" value={party}
              onChange={e=>{setParty(e.target.value); applyToAll({party:e.target.value});}}
              className={FIELD} /></label>
          <label className={LABEL}>City
            <input value={customerCity}
              onChange={e=>{setCustomerCity(e.target.value); applyToAll({customer_city:e.target.value});}}
              className={FIELD} /></label>
        </>}
        <label className={LABEL}>Order date *
          <input type="date" value={orderDate}
            onChange={e=>{setOrderDate(e.target.value); applyToAll({order_date:e.target.value});}}
            className={FIELD+" mono"} /></label>
        <label className={LABEL}>Priority
          <select value={priority}
            onChange={e=>{const v=Number(e.target.value); setPriority(v); applyToAll({priority:v});}}
            className={FIELD+" bg-white"}>
            <option value={1}>1 — urgent</option><option value={2}>2 — normal</option><option value={3}>3 — low</option>
          </select></label>
        <label className={LABEL}>Order nature *
          <input list="order-nature-options" value={orderNature}
            onChange={e=>{setOrderNature(e.target.value); applyToAll({order_nature:e.target.value});}}
            className={FIELD} /></label>
        <label className={LABEL}>Stitching
          <select value={stitching}
            onChange={e=>{setStitching(e.target.value); applyToAll({stitching:e.target.value});}}
            className={FIELD+" bg-white"}>
            <option value="inhouse">In-house</option><option value="outside">Outside</option>
          </select></label>
      </div>
      {multiParty && <div className="text-xs text-slate-500 mt-2">
        Each article carries its own customer below. A PI is issued to one customer, so this sheet
        will produce one invoice per customer.
      </div>}
    </div>
  );

  /* Per article: only what genuinely differs between two articles on the same
     sheet. V/L is NOT here for a split article — its size ranges already say
     which roll each line is, and asking again invites a contradiction. */
  const articleDetails = (c, change, changeType) => (
    <div className="grid gap-2 px-3 py-3 border-b border-slate-200 bg-white"
         style={{gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))"}}>
      {multiParty && <>
        <label className={LABEL}>Customer *
          <input list="party-options" value={c.party||""} onChange={e=>change({party:e.target.value})}
            className={FIELD} /></label>
        <label className={LABEL}>City
          <input value={c.customer_city||""} onChange={e=>change({customer_city:e.target.value})}
            className={FIELD} /></label>
      </>}
      <label className={LABEL}>Dispatch timeline *
        <input value={c.dispatch_timeline||""} onChange={e=>change({dispatch_timeline:e.target.value})}
          placeholder={termsForParty(c.party).dispatch_timeline||"45 days"} className={FIELD} /></label>
      <label className={LABEL}>Sole colour *
        <input value={c.sole_colour||""} onChange={e=>change({sole_colour:e.target.value})}
          className={FIELD} /></label>
      <label className={LABEL}>Upper colour *
        <input value={c.upper_colour||""} onChange={e=>change({upper_colour:e.target.value})}
          className={FIELD} /></label>
      <label className={LABEL}>Print
        <select value={c.printing?"yes":"no"} onChange={e=>change({printing:e.target.value==="yes"})}
          className={FIELD+" bg-white"}>
          <option value="no">No</option><option value="yes">Yes</option>
        </select></label>
    </div>
  );

  const totals=useMemo(()=>{
    if(!cards)return null;
    let cartons=0,pairs=0,amount=0;
    const per=cards.map(c=>{
      let cc=0,pp=0,amt=0;
      c.lines.forEach(l=>{ const p=(Number(l.cartons)||0)*(Number(l.ppc)||0);
        cc+=Number(l.cartons)||0; pp+=p; amt+=p*(Number(prices[c.article])||0); });
      cartons+=cc; pairs+=pp; amount+=amt;
      return {cartons:cc,pairs:pp,amount:amt};
    });
    return {per,cartons,pairs,amount};
  },[cards,prices]);

  const piNumberFor = (card, source) => {
    const parties=[];
    for(const c of source||[]){
      const who=((c.party||"").trim()||party.trim()||"—");
      if(!parties.includes(who)) parties.push(who);
    }
    if(parties.length<=1) return piNo;
    const who=((card.party||"").trim()||party.trim()||"—");
    return `${piNo}-${parties.indexOf(who)+1}`;
  };

  async function save(){
    const source=piPreviewCards||[];
    if(!source.length){ setErr("Generate the PI from Match & Check before saving."); return; }
    if(previewStale){ setErr("Match & Check changed. Regenerate the PI with the latest edits before saving."); return; }
    if(!piNo){ setErr("A server-issued PI number is required. Press New PI number and try again."); return; }
    const noParty=source.filter(c=>!String(c.party||"").trim());
    if(noParty.length){
      setErr("Enter the customer for: "+noParty.map(c=>c.article).join(", ")
        +". One sheet can list several customers, so each order needs its own.");
      return;
    }
    const incomplete=source.filter(c=>
      !String(c.order_nature||"").trim() || !String(c.dispatch_timeline||"").trim()
      || !String(c.sole_colour||"").trim() || !String(c.upper_colour||"").trim()
      || !String(c.order_date||"").trim());
    if(incomplete.length){
      setErr("Complete order nature, dispatch timeline, sole colour and upper colour for every article before issuing the PI: "
        +incomplete.map(c=>c.article).join(", "));
      return;
    }
    const unresolved=source.flatMap(c=>c.lines
      .map((l,li)=>(!l.combo && (Number(l.cartons)||0)>0) ? `${c.article} size ${l.single||"?"}` : null)
      .filter(Boolean));
    if(unresolved.length){ setErr("Pick a combo for: "+unresolved.join(", ")+" before saving — or set its cartons to 0 to leave it out."); return; }
    const missingPacking=source.flatMap(c=>c.lines
      .filter(l=>!c.fromPi&&(Number(l.cartons)||0)>0&&!(Number(l.ppc)>0))
      .map(l=>`${c.article} ${l.combo}`));
    if(missingPacking.length){
      setErr("Packing is missing for: "+[...new Set(missingPacking)].join(", ")+". Add pairs/carton in Data & BOM before issuing the PI.");
      return;
    }
    const unpriced=source.flatMap(c=>c.lines.flatMap(l=>{
      if((c.fromPi?(Number(l.qty)||0):(Number(l.cartons)||0))<=0) return [];
      const sizes=(l.size_order||comboSizesForArticle(c.article,l.combo))
        .filter(size=>!l.sizes||(Number(l.sizes[size])||0)>0);
      const chart=((INPUTS.mrp||{})[c.article]||{});
      return sizes.filter(size=>mrpForSize(chart,l.combo,size)==null)
        .map(size=>`${c.article} ${l.combo} / ${size}`);
    }));
    if(unpriced.length){
      setErr("Set MRP before issuing this PI: "+[...new Set(unpriced)].join(", ")+". Use Catalogue → Edit MRP size by size.");
      return;
    }
    const drafts=source.map(c=>{
      const commercial={...(c.commercial_terms||termsForParty(c.party)),
        dispatch_timeline:String(c.dispatch_timeline||c.commercial_terms?.dispatch_timeline||"45 days")};
      return ({
      order_date:c.order_date, article_code:c.article,
      priority:Number(c.priority)||2, party:String(c.party||"").trim(),
      lines:(c.lines||[]).filter(l=>c.fromPi?(Number(l.qty)||0)>0:(Number(l.cartons)||0)>0).map(l=>c.fromPi
        ? {combo:l.combo,qty:Number(l.qty)||0,label:l.label||l.combo,sizes:l.sizes,
           size_order:l.size_order||comboSizesForArticle(c.article,l.combo),
           ppc:Number(l.ppc)||undefined,
           vl:comboType(c.article,l.combo)||c.vl||""}
        : {combo:l.combo,qty:l.sizes?Object.values(l.sizes).reduce((a,b)=>a+(Number(b)||0),0):(Number(l.cartons)||0)*(Number(l.ppc)||0),
           label:l.raw||l.combo,sizes:l.sizes,size_order:l.size_order||comboSizesForArticle(c.article,l.combo),
           ppc:Number(l.ppc)||undefined,
           vl:comboType(c.article,l.combo)||c.vl||""}),
      stitching:c.stitching||"inhouse", printing:!!c.printing,
      // The FULL commercial terms are snapshotted onto the order, not just the
      // discount. Re-opening an issued PI must reproduce the invoice that was
      // printed — reading today's deductions back over an old PI silently
      // restates money that has already been agreed.
      pi:{pi_no:piNumberFor(c,source), price:prices[c.article],
          mrp:{...((INPUTS.mrp||{})[c.article]||{})},
          catalogue_image:(CATALOGUE[c.article]||{}).image||articlePhoto(c.article)||null,
          terms:commercial, discount_pct:commercial.discount_pct,
          dispatch_timeline:commercial.dispatch_timeline,
          customer_city:c.customer_city||"",
          vl:vlSummary(c), sole_colour:c.sole_colour, upper_colour:c.upper_colour,
          remarks, order_nature:c.order_nature, printing:!!c.printing,
          production_status:"produced", attachment:attachment||undefined},
      });
    }).filter(d=>d.lines.length);
    if(!drafts.length){ setErr("Add a quantity to at least one checked line before saving."); return; }
    setSaving(true); setErr("");
    try{
      const created=await onSaved(drafts);
      setSavedMsg((created||[]).map(o=>o.order_no).join(", ")+" saved to the order sheet and scheduled.");
      setCards(null); setPiCards(null); setPiPreviewCards(null); setPiPreviewSignature(""); setImg(null); setAttachment(null);
      setPiNo(""); allocatePiNo();
    }catch(e){ setErr("Could not save: "+(e.message||e)); }
    finally{ setSaving(false); }
  }

  function printPI(){
    // Every PiDocument carries the same id, so getElementById would print only
    // the first — a multi-party sheet must print every invoice, each on its
    // own page.
    const nodes=[...document.querySelectorAll("#pi-area")];
    if(!nodes.length) return;
    const w=window.open("","_blank","width=820,height=1000");
    if(!w){ setErr("Popup blocked — allow popups to print the PI."); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${piNo}</title>
      <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
      *{box-sizing:border-box}body{margin:0;padding:26px;font-family:Inter,system-ui,sans-serif;color:#1e2230}
      table{width:100%;border-collapse:collapse}input{border:none;font:inherit}@page{margin:14mm}</style></head>
      <body>${nodes.map((n,i)=>
        `<div style="${i?"page-break-before:always;":""}">${n.outerHTML}</div>`).join("")}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  }

  return <div>
    <datalist id="order-nature-options">
      <option value="MTS" /><option value="Institutional" /><option value="MTO" />
    </datalist>
    <datalist id="party-options">
      {parties.map(p=><option key={p.name} value={p.name} />)}
    </datalist>
    {/* step 1: photo */}
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="serif text-lg font-semibold">1 · Order photo or PI</div>
        {(cards||piCards||piPreviewCards||img) && <button onClick={()=>{
          if(!window.confirm("Close this PI and discard the current draft?")) return;
          setCards(null);setPiCards(null);setPiPreviewCards(null);setPiPreviewSignature("");setImg(null);setAttachment(null);setRawRead("");setSavedMsg("");setErr("");
          setPiNo("");allocatePiNo();
        }} className="text-xs font-semibold text-rose-700 border border-rose-200 rounded-lg px-3 py-1.5 bg-white">Close PI</button>}
      </div>
      {img
        ? <div className="rounded-xl overflow-hidden border border-slate-200">
            <img src={img} alt="order" className="w-full object-contain bg-slate-800" style={{maxHeight:260}}/>
            <div className="flex justify-end px-3 py-2 bg-slate-50 border-t border-slate-200">
              <button onClick={()=>fileRef.current?.click()} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white">Replace</button></div>
          </div>
        : <div onClick={()=>fileRef.current?.click()} className="border border-dashed border-slate-300 rounded-xl py-7 text-center bg-slate-50 hover:border-indigo-500 hover:bg-indigo-50 cursor-pointer">
            <div className="text-2xl">📷</div><div className="font-semibold text-sm mt-1">Tap to add the handwritten order</div>
          </div>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e=>handleFile(e.target.files?.[0])}/>
      <div className="flex gap-2 mt-3 flex-wrap">
        <button disabled={!img||busy} onClick={readOrder}
          className="font-semibold text-white rounded-xl px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300">{busy?"Reading…":"Read the order"}</button>
        <label className={"font-semibold rounded-xl px-4 py-2.5 text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 cursor-pointer "+(readingPi?"opacity-60":"")}>
          {readingPi ? "Reading PI…" : "Upload a PI"}
          <input type="file" accept="application/pdf,image/*" className="hidden" disabled={readingPi}
            onChange={e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(f) ingestPi(f); }} />
        </label>
        <button onClick={startBlank} className="font-semibold rounded-xl px-4 py-2.5 text-sm text-indigo-800 bg-indigo-50 hover:bg-indigo-100">Enter by hand</button>
      </div>
      {err && <div className="mt-3 rounded-xl px-3 py-2.5 text-sm bg-orange-50 text-orange-900 border border-orange-200">{err}</div>}
      {savedMsg && <div className="mt-3 rounded-xl px-3 py-2.5 text-sm bg-emerald-50 text-emerald-900 border border-emerald-200">✓ {savedMsg} See “Orders & dispatch”.</div>}
      <details className="mt-3">
        <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">AI read not working here? Read it in a Claude chat and paste the result</summary>
        <div className="text-xs text-slate-500 mt-2 leading-relaxed">
          1 · Open a normal Claude chat, attach the order photo, and send it the instruction below. 2 · Copy Claude's JSON reply. 3 · Paste it here and press Use.
        </div>
        <textarea readOnly value={readPrompt(parties)} rows={4} onFocus={e=>e.target.select()}
          className="w-full mt-2 border border-slate-200 rounded-lg px-2 py-1.5 mono bg-slate-50" style={{fontSize:10}}/>
        <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} rows={4}
          placeholder='Paste the JSON reply here…'
          className="w-full mt-2 border border-slate-200 rounded-lg px-2 py-1.5 mono" style={{fontSize:11}}/>
        <button onClick={()=>{ setErr(""); setSavedMsg("");
            try{ applyReadText(pasteText); setPasteText(""); }
            catch(e){ setErr("Could not parse the pasted text — paste Claude's full JSON reply. ("+(e.message||e)+")"); } }}
          className="mt-2 text-xs font-semibold text-white rounded-lg px-4 py-2 bg-indigo-600 hover:bg-indigo-700">Use pasted result</button>
      </details>
    </div>

    {/* step 2: match & check */}
    {cards && <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
      <div className="serif text-lg font-semibold mb-1">2 · Match &amp; check</div>
      <p className="text-slate-500 text-xs mb-3">Each category is matched to a real factory article; each size entry to a real size range. Amber = mapped approximately, please confirm. Pairs = cartons × pairs/carton.</p>
      {sheetHeader()}
      {cards.map((c,i)=>{
        const missingPacking=c.lines.filter(l=>l.combo&&!(Number(l.ppc)>0)).map(l=>l.combo);
        return (
        <div key={i} className="border border-slate-200 rounded-xl mb-3 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex-wrap">
            <select value={c.article} onChange={e=>onArticleChange(i,e.target.value)}
              className="border rounded-lg px-2 py-1.5 text-sm font-semibold bg-white" style={{borderColor:c.matched?"#e2e8f0":"#f59e0b"}}>
              {ARTS.map(a=><option key={a} value={a}>{a}</option>)}</select>
            {/* One article, however many rolls it was ordered in. */}
            {vlSummary(c) && <span className="text-xs font-semibold rounded-full px-2 py-0.5"
              style={{background:"#eef2ff",color:"#4338ca"}}>{vlSummary(c)}</span>}
            {c.raw && <span className="mono text-xs text-slate-400">read: “{c.raw.trim()}”</span>}
            <span className="mono text-xs ml-auto" style={{color:SOLE_COLOR[INPUTS.articles[c.article].sole_type]}}>{INPUTS.articles[c.article].sole_type}</span>
            <span className="mono text-xs text-slate-400">{fmt(c.lines.reduce((a,l)=>a+(l.sizes?Object.values(l.sizes).reduce((x,y)=>x+(Number(y)||0),0):(Number(l.cartons)||0)*(Number(l.ppc)||0)),0))} pr</span>
            <button onClick={()=>delCard(i)} title="Remove this article" className="text-rose-500 px-1.5 text-lg leading-none">×</button>
          </div>
          {articleDetails(c, patch=>setCard(i,patch), type=>onTypeChange(i,type))}
          {(c.ambiguous || !c.matched || missingPacking.length>0) && (
            <div className="px-3 py-2 text-xs border-b border-amber-200 bg-amber-50 text-amber-900 space-y-1">
              {!c.matched && <div><b>Not recognised.</b> The reader could not match “{(c.raw||"").trim()}” to a product — pick the right one above.</div>}
              {c.matched && c.ambiguous && <div><b>More than one product fits</b> “{(c.raw||"").trim()}”. Confirm the selection above is right.</div>}
              {!!missingPacking.length && <div><b>Missing packing rate for {c.article}:</b> {missingPacking.join(", ")}. Add it in Data &amp; BOM before issuing the PI.</div>}
            </div>)}
          <div className="p-3">
            <div className="grid gap-2 text-xs uppercase tracking-wide text-slate-400 font-semibold px-1" style={{gridTemplateColumns:"1fr 90px 90px 90px 28px"}}>
              <div>Ordered (rate basis)</div><div>Cartons</div><div>Pairs/ctn</div><div className="text-right">Pairs</div><div/></div>
            {c.lines.map((l,k)=>(
              <div key={k} className="grid gap-2 items-center px-1 py-1" style={{gridTemplateColumns:"1fr 90px 90px 90px 28px"}}>
                <div>
                  <input value={l.raw} onChange={e=>setLine(i,k,{raw:e.target.value})} placeholder="as written, e.g. Big 8"
                    className="text-sm font-semibold w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-500 focus:bg-white rounded-md px-1.5 py-1 -ml-1.5 outline-none"/>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="mono text-slate-400" style={{fontSize:9}}>{l.raw?"rates from:":"combo:"}</span>
                    {/* The WHOLE shoe's ranges, each labelled with its roll. One
                        article, both rolls — picking a Lace range simply makes
                        that line Lace. */}
                    <select value={l.combo || ""} onChange={e=>{const combo=e.target.value;
                        setLine(i,k,{combo,single:undefined,exact:true,type:comboType(c.article,combo),
                          ppc:packQty(c.article,combo)??"",size_order:comboSizesForArticle(c.article,combo),sizes:undefined});}}
                      className="border rounded-lg px-1.5 py-1 mono bg-white" style={{fontSize:11, borderColor:l.exact?"#e2e8f0":"#f59e0b", background:l.exact?"#fff":"#fffbeb"}}>
                      {!l.combo && <option value="">— pick a combo —</option>}
                      {articleTypeCombos(c.article).map(cb=>{ const t=comboType(c.article,cb);
                        return <option key={cb} value={cb}>{cb}{t?` · ${t[0]+t.slice(1).toLowerCase()}`:""}</option>; })}</select>
                    {l.combo && comboType(c.article,l.combo) && (
                      <span className="text-xs font-semibold rounded px-1.5 py-0.5" style={{fontSize:9.5,
                        background:comboType(c.article,l.combo)==="LACE"?"#eef2ff":"#ecfdf5",
                        color:comboType(c.article,l.combo)==="LACE"?"#4338ca":"#047857"}}>
                        {comboType(c.article,l.combo)}</span>)}
                    {!l.exact && l.combo && <span className="text-amber-700 font-semibold" style={{fontSize:10}}>confirm</span>}
                  </div>
                  {!l.combo && l.single && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-1">
                      <b>Size {l.single}</b> on its own — {INPUTS.articles[c.article].combo_order.length
                        ? "it doesn't fall inside any of this article's named combos, so it has no material rate. "
                        : ""}
                      {l.ppcKnown ? `Packed ${l.ppc}/carton per the single-size chart. ` : "No packing rate on file for it either. "}
                      Pick the combo it should be costed against, or leave it and it stays uncosted.
                    </div>
                  )}
                </div>
                <input type="number" min="0" value={l.cartons}
                  aria-label={`${c.article} ${l.combo||l.single||k} cartons`}
                  onChange={e=>setLine(i,k,{cartons:e.target.value===""?0:Number(e.target.value)})}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"/>
                <input type="number" min="1" value={l.ppc}
                  aria-label={`${c.article} ${l.combo||l.single||k} pairs per carton`}
                  onChange={e=>setLine(i,k,{ppc:e.target.value===""?"":Number(e.target.value)})}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full"/>
                <div className="mono text-sm text-right font-semibold">{fmt((Number(l.cartons)||0)*(Number(l.ppc)||0))}</div>
                <button onClick={()=>delLine(i,k)} className="text-rose-500 text-lg leading-none">−</button>
                {l.sizes && <div className="col-span-full flex gap-2 flex-wrap rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
                  <span className="text-xs text-slate-500 self-center">Exact sizes from the order:</span>
                  {Object.entries(l.sizes).map(([size,qty])=><label key={size} className="text-xs text-slate-500">
                    <span className="mono">{size}</span>
                    <input type="number" min="0" value={qty} aria-label={`${c.article} size ${size} pairs`}
                      onChange={e=>{
                        const next={...l.sizes,[size]:Math.max(0,Number(e.target.value)||0)};
                        const pairs=Object.values(next).reduce((a,b)=>a+(Number(b)||0),0);
                        setLine(i,k,{sizes:next,qty:pairs,cartons:l.ppc?+(pairs/Number(l.ppc)).toFixed(4):l.cartons});
                      }}
                      className="block w-20 text-sm border border-slate-300 rounded px-1.5 py-0.5 mono bg-white" />
                  </label>)}
                </div>}
              </div>))}
            <button onClick={()=>addLine(i)} className="text-xs font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-md px-2.5 py-1.5 mt-1">+ Add combo</button>
            <div className="mt-2">
              <AddSize articleCode={c.article}
                lines={c.lines.map(l=>({combo:l.combo, qty:(Number(l.cartons)||0)*(Number(l.ppc)||0), sizes:l.sizes, label:l.raw||l.combo}))}
                onChange={next=>setCards(cs=>cs.map((cc,j)=>{
                  if(j!==i) return cc;
                  // AddSize returns pair-based lines; carry them back as a
                  // single-carton line so the existing carton editor still works.
                  const merged=next.map(nl=>{
                    const existing=cc.lines.find(x=>x.combo===nl.combo);
                    const ppc=(existing&&existing.ppc)||packQty(cc.article,nl.combo)||"";
                    return existing && !nl.sizes
                      ? existing
                      : {...(existing||{}), combo:nl.combo, sizes:nl.sizes,
                         raw:nl.label||nl.combo, exact:true,
                         ppc, cartons:ppc?+(nl.qty/ppc).toFixed(4):0};
                  });
                  return {...cc, lines:merged};
                }))} />
            </div>
            <details className="mt-3 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
              <summary className="text-xs font-semibold text-indigo-800 cursor-pointer">Packing list &amp; BOM used for {c.article}</summary>
              <div className="mt-2"><ArticleRules article={c.article} compact /></div>
            </details>
          </div>
        </div>);})}
      <button onClick={addCard} className="text-sm font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-1.5">+ Add category</button>
    </div>}

    {/* step 3: explicitly snapshot checked edits into the PI */}
    {!!sourceCards.length && <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div>
          <div className="serif text-lg font-semibold">3 · Generate Proforma Invoice</div>
          <div className="text-xs text-slate-500">The PI is created from the current Match &amp; Check values only when you press Generate.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={generatePiPreview} disabled={generatingPi}
            className="text-xs font-semibold text-white rounded-lg px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {generatingPi?"Reloading latest terms…":piPreviewCards?(previewStale?"Regenerate PI with latest edits":"Generate PI again"):"Generate PI from these edits"}
          </button>
          {piPreviewCards && <button onClick={async()=>{if(await allocatePiNo()) await generatePiPreview();}}
            className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white">New PI number</button>}
          <button onClick={printPI} disabled={!piPreviewCards||previewStale} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40">Print / Save PDF</button>
          <button onClick={save} disabled={saving||!piPreviewCards||previewStale}
            className="text-xs font-semibold text-white rounded-lg px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving…" : `Save & send ${piPreviewCards?.length||0} order${piPreviewCards?.length===1?"":"s"} to production →`}
          </button>
        </div>
      </div>
      {previewStale && <div className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 mb-3">
        Match &amp; Check has changed since this PI was generated. Press <b>Regenerate PI with latest edits</b> before printing or saving.
      </div>}
      <div className="grid gap-2 mb-3" style={{gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))"}}>
        <label className="text-xs text-slate-500">Attach screenshot
          <input type="file" accept="image/*" capture={undefined} onChange={async e=>{
              const f=e.target.files&&e.target.files[0]; e.target.value="";
              if(!f) return;
              try{ setAttachment(await shrinkImage(f)); }
              catch(err){ setErr("Could not attach that image: "+(err.message||err)); }
            }}
            className="block mt-0.5 w-full text-xs" />
          {attachment && <span className="text-xs text-emerald-700">attached — will save with this order</span>}
        </label>
        <div className="text-xs text-slate-500">Commercial terms
          <div className="block mt-0.5 w-full text-sm border border-slate-200 bg-slate-50 rounded-lg px-2 py-1.5">
            Party master · {sourceCards.map(c=>`${c.party||"Unlisted party"} ${termsForParty(c.party).discount_pct}%`).join(" · ")}
          </div>
        </div>
        <label className="text-xs text-slate-500">Special remarks
          <input type="text" value={remarks} onChange={e=>setRemarks(e.target.value)}
            className="block mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
      </div>

      {piCards && (
        <div className="border border-indigo-200 bg-indigo-50/50 rounded-xl p-4 mb-4">
          <div className="text-sm font-semibold text-indigo-900 mb-1">Review before saving</div>
          <p className="text-xs text-slate-600 mb-3">
            These quantities came straight off the PI you uploaded. Correct anything before saving —
            once saved, per-size quantities can still be changed from Orders &amp; Dispatch, but fixing
            them here avoids re-issuing the invoice.
          </p>
          {sheetHeader()}
          {piCards.map((c,ci)=>(
            <div key={ci} className="mb-3 last:mb-0 border border-slate-200 rounded-xl overflow-hidden bg-white">
              <div className="px-3 py-2 bg-slate-50">
                <select value={c.article} onChange={e=>onPiArticleChange(ci,e.target.value)} className="text-xs font-semibold border border-slate-200 rounded px-2 py-1 bg-white">
                  {ARTS.map(a=><option key={a}>{a}</option>)}
                </select>
              </div>
              {articleDetails(c, patch=>setPiCard(ci,patch), type=>onTypeChange(ci,type,true))}
              <div className="p-3">
              {c.lines.map((l,li)=>(
                <div key={li} className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="mono text-xs text-slate-500 w-16">{l.combo}</span>
                  {Object.keys(l.sizes||{}).map(sz=>(
                    <label key={sz} className="text-xs text-slate-500">
                      <span className="mono">{sz}</span>
                      <input type="number" min={0} value={l.sizes[sz]}
                        onChange={e=>{
                          const v=Number(e.target.value)||0;
                          setPiCards(pcs=>pcs.map((c2,ci2)=>ci2!==ci?c2:{...c2,lines:c2.lines.map((l2,li2)=>li2!==li?l2:
                            {...l2, sizes:{...l2.sizes,[sz]:v}, qty:Object.values({...l2.sizes,[sz]:v}).reduce((a,b)=>a+(Number(b)||0),0)})}));
                        }}
                        className="block mt-0.5 w-16 text-sm border border-slate-300 rounded px-1 py-0.5 mono" /></label>))}
                  <span className="text-xs text-slate-400 ml-1">= {l.qty} pairs</span>
                </div>
              ))}
              </div>
              <details className="mx-3 mb-3 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                <summary className="text-xs font-semibold text-indigo-800 cursor-pointer">Packing list &amp; BOM used for {c.article}</summary>
                <div className="mt-2"><ArticleRules article={c.article} compact /></div>
              </details>
            </div>
          ))}
        </div>
      )}

      {(() => {
        /* One sheet routinely carries several customers, and a PI is issued to
           ONE customer — so a multi-party sheet produces one invoice each,
           not a single invoice with the others quietly dropped. */
        const src = piPreviewCards || [];
        const groups = [];
        for(const c of src){
          const who = ((c.party||"").trim() || party.trim() || "—");
          let g = groups.find(x => x.party === who);
          if(!g){ g = { party: who, cards: [] }; groups.push(g); }
          g.cards.push(c);
        }

        return <>
          {groups.length > 1 && (
            <div className="text-xs rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 px-3 py-2 mb-3">
              <b>{groups.length} customers on this sheet</b> — {groups.map(g=>g.party).join(", ")}.
              One invoice each, numbered {piNo}-1 to {piNo}-{groups.length}. Saving creates every
              order in one go.
            </div>
          )}

          {groups.map((g, gi) => {
            const num = groups.length > 1 ? `${piNo}-${gi+1}` : piNo;
            const items = g.cards.map(c => ({
              article_code: c.article,
              article_label: c.article,
              vl:c.vl, sole_colour:c.sole_colour, upper_colour:c.upper_colour,
              order_nature:c.order_nature, printing:!!c.printing,
              source:c.order_nature,
              image: (CATALOGUE[c.article]||{}).image || articlePhoto(c.article) || null,
              mrp: (INPUTS.mrp||{})[c.article] || {},
              lines: c.fromPi
                ? c.lines.map(l=>({...l,size_order:l.size_order||comboSizesForArticle(c.article,l.combo)}))
                : c.lines.filter(l=>(Number(l.cartons)||0)>0)
                    .map(l=>({ combo:l.combo,
                      qty:l.sizes?Object.values(l.sizes).reduce((a,b)=>a+(Number(b)||0),0):(Number(l.cartons)||0)*(Number(l.ppc)||0),
                      sizes:l.sizes, label:l.raw||l.combo,
                      size_order:l.size_order||comboSizesForArticle(c.article,l.combo) })),
            })).filter(it => it.lines.length);
            if(!items.length) return null;

            return (
              <div key={g.party+gi} id={`pi-${gi}`}
                   style={{ marginBottom: groups.length>1 ? 26 : 0,
                            paddingTop: gi ? 20 : 0,
                            borderTop: gi ? "2px dashed #CBD5E1" : "none" }}>
                {groups.length > 1 && (
                  <div className="sign" style={{fontSize:11,color:"#6B7C90",marginBottom:8,fontWeight:600}}>
                    Invoice {gi+1} of {groups.length} · {g.party}
                  </div>
                )}
                <PiDocument
                  piNo={num}
                  order={{
                    order_no: num,
                    party: g.party,
                    customer_city: g.cards[0]?.customer_city||"",
                    order_date: g.cards[0]?.order_date||orderDate, pi_date: g.cards[0]?.order_date||orderDate,
                    remarks: remarks,
                    items,
                  }}
                  article={{}}
                  terms={{...(g.cards[0]?.commercial_terms||termsForParty(g.party)),
                    dispatch_timeline:g.cards[0]?.dispatch_timeline||g.cards[0]?.commercial_terms?.dispatch_timeline}}
                  config={piConfig}
                />
              </div>
            );
          })}
        </>;
      })()}
    </div>}
  </div>;
}
/* One line of orientation per view — what this screen is for, in the user's
   terms rather than the system's. */
const VIEWS = {
  mis:         {title:"Executive MIS",       sub:"Live order health, delivery outlook, dispatch gap and planned capacity"},
  intake:      {title:"PI generation",      sub:"Read an order slip or PI, check it, raise the invoice"},
  pis:         {title:"PI database",        sub:"Master record of every PI issued and revised"},
  bulk:        {title:"Bulk upload",        sub:"Add many orders at once from a spreadsheet"},
  orders:      {title:"Orders & dispatch",  sub:"Every live order, its dispatch date and delivery risk"},
  dispatch:    {title:"Dispatch & packing", sub:"Record what shipped and what is still outstanding"},
  schedule:    {title:"Schedule",           sub:"Stage by stage, order by order"},
  plan:        {title:"Production plan",    sub:"What runs on which machine, day by day"},
  machines:    {title:"Machine load",       sub:"Capacity, utilisation and delivery targets"},
  procurement: {title:"Procurement",        sub:"What to buy, netted against stock"},
  stock:       {title:"Stock register",     sub:"Opening, received, issued and what is left"},
  parties:     {title:"Parties & terms",    sub:"Customers and their agreed commercial terms"},
  catalogue:   {title:"Catalogue",          sub:"Articles, photos and prices"},
  rules:       {title:"Packing & BOM rules",sub:"The exact carton and material rules used for every article and type"},
  data:        {title:"Data & BOM",         sub:"Bills of materials, pricing and stock figures"},
  copilot:     {title:"Copilot",            sub:"Ask about the current plan in plain language"},
};

/* A single figure in the header bar. Label small and quiet, number loud. */
function Stat({label,value,tone}){
  return <div>
    <div className="sign" style={{fontSize:9.5,color:"#8494A6",fontWeight:600}}>{label}</div>
    <div className="mono" style={{fontSize:15,fontWeight:600,color:tone||"#1B2836",lineHeight:1.25}}>{value}</div>
  </div>;
}

function Pill({status}){
  return <span className="mono text-xs font-semibold px-2 py-0.5 rounded-full" style={{color:SLA_COLOR[status],background:status==="on_track"?"#ecfdf5":status==="at_risk"?"#fff7ed":"#fef2f2"}}>{SLA_LABEL[status]}</span>;
}

function PiDatabaseTab({orders=[],onScheduled}){
  const [pis,setPis]=useState(null);
  const [selectedPi,setSelectedPi]=useState(null);
  const [editingOrder,setEditingOrder]=useState(null);
  const [settings,setSettings]=useState({});
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [linking,setLinking]=useState("");
  const reloadPis=()=>api.listPis().then(setPis);
  useEffect(()=>{ Promise.all([api.listPis(),api.getSettings().catch(()=>({}))])
    .then(([rows,cfg])=>{setPis(rows);setSettings(cfg||{});})
    .catch(e=>{setErr(e.message||String(e));setPis([]);}); },[]);
  if(!pis) return <div className="text-sm text-slate-500">Loading the PI master…</div>;
  const liveOrderNos=new Set((orders||[]).map(o=>o.order_no));
  async function linkToSchedule(piNo){
    setLinking(piNo);setErr("");setMsg("");
    try{
      const result=await api.schedulePi(piNo);
      if(onScheduled) await onScheduled();
      await reloadPis();
      const count=(result.restored||[]).length;
      setMsg(count?`${piNo}: ${count} missing order${count===1?"":"s"} added to the production schedule.`:`${piNo} is already linked to the production schedule.`);
    }catch(e){setErr(e.message||String(e));}
    finally{setLinking("");}
  }
  const chosen=pis.find(p=>p.pi_no===selectedPi);
  const saved=(chosen&&chosen.snapshot&&chosen.snapshot.orders)||[];
  const items=saved.map(o=>({
    article_code:o.article_code, article_label:o.article_code,
    vl:(o.pi||{}).vl||"", sole_colour:(o.pi||{}).sole_colour||"",
    upper_colour:(o.pi||{}).upper_colour||"", order_nature:(o.pi||{}).order_nature||"",
    printing:!!(o.pi||{}).printing, source:(o.pi||{}).order_nature||"As per catalogue",
    image:(o.pi||{}).catalogue_image||(CATALOGUE[o.article_code]||{}).image||articlePhoto(o.article_code)||null,
    mrp:(o.pi||{}).mrp||(INPUTS.mrp||{})[o.article_code]||{}, lines:o.lines||[],
  }));
  const first=saved[0]||{};
  const firstPi=first.pi||{};
  return <div>
    {err && <div className="text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 mb-3">{err}</div>}
    {msg && <div className="text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 mb-3">{msg}</div>}
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
      <div className="text-sm font-semibold text-slate-700 mb-1">PI master database</div>
      <p className="text-xs text-slate-500 mb-3">Issued PIs are snapshotted here independently of the live production queue. Revisions made through Edit are retained with their revision number.</p>
      {!pis.length ? <div className="text-sm text-slate-400 py-6 text-center">No PIs have been issued yet.</div> :
      <table className="w-full text-sm" style={{minWidth:720}}>
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="text-left py-2">PI</th><th className="text-left">Date</th><th className="text-left">Party</th>
          <th className="text-left">Articles</th><th className="text-right">Pairs</th><th className="text-center">Revision</th>
          <th className="text-left">Status</th><th className="text-left">Schedule</th><th></th>
        </tr></thead>
        <tbody>{pis.map(p=>{const os=(p.snapshot&&p.snapshot.orders)||[];const missing=os.filter(o=>!liveOrderNos.has(o.order_no));return <tr key={p.pi_no} className="border-t border-slate-100">
          <td className="py-2 mono font-semibold">{p.pi_no}</td><td className="mono text-slate-600">{p.pi_date}</td>
          <td>{p.party||"—"}</td><td className="text-xs text-slate-600">{[...new Set(os.map(o=>o.article_code))].join(", ")}</td>
          <td className="text-right mono">{fmt(os.reduce((a,o)=>a+(o.lines||[]).reduce((b,l)=>b+(Number(l.qty)||0),0),0))}</td>
          <td className="text-center mono">{p.revision||0}</td><td className="capitalize">{p.status}</td>
          <td>{missing.length
            ? <button disabled={linking===p.pi_no} onClick={()=>linkToSchedule(p.pi_no)}
                className="text-xs font-semibold text-amber-800 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1 disabled:opacity-50">
                {linking===p.pi_no?"Linking…":`Add ${missing.length} to schedule`}</button>
            : <span className="text-xs font-semibold text-emerald-700">Linked</span>}</td>
          <td className="text-right"><button onClick={()=>{setSelectedPi(selectedPi===p.pi_no?null:p.pi_no);setEditingOrder(null);}} className="text-xs font-semibold text-indigo-700 hover:underline">{selectedPi===p.pi_no?"Close":"View / edit"}</button></td>
        </tr>;})}</tbody>
      </table>}
    </div>
    {chosen&&items.length>0&&<div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mt-4">
      <div className="flex items-center gap-2 mb-3"><div className="text-sm font-semibold">{chosen.pi_no} · revision {chosen.revision||0}</div>
        <button onClick={()=>window.print()} className="ml-auto text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white">Print / save PDF</button></div>
      <div data-noprint className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 mb-3">
        <div className="text-xs font-semibold text-slate-700 mb-2">Orders on this PI — editable after issue</div>
        <div className="flex gap-2 flex-wrap">{saved.map(o=>liveOrderNos.has(o.order_no)?<button key={o.order_no}
          onClick={()=>setEditingOrder(editingOrder===o.order_no?null:o.order_no)}
          className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-indigo-700">
          {editingOrder===o.order_no?"Close editor":`Edit ${o.order_no} · ${o.article_code}`}
        </button>:<span key={o.order_no} className="text-xs border border-amber-200 rounded-lg px-3 py-1.5 bg-amber-50 text-amber-800">
          {o.order_no} · add to schedule before editing
        </span>)}</div>
      </div>
      {editingOrder&&<div data-noprint className="mb-4">{saved.filter(o=>o.order_no===editingOrder).map(o=><EditOrder key={o.order_no} o={o}
        onCancel={()=>setEditingOrder(null)}
        onSave={async patch=>{
          setErr("");
          try{ await api.patchOrder(o.order_no,patch); await reloadPis(); setEditingOrder(null); }
          catch(e){ setErr(e.message||String(e)); throw e; }
        }}/>)}</div>}
      <div data-print-area>
      <PiDocument piNo={chosen.pi_no} order={{order_no:chosen.pi_no,party:first.party,customer_city:firstPi.customer_city,
          order_date:first.order_date,pi_date:first.order_date,remarks:firstPi.remarks,items}}
        article={{}}
        terms={{...(settings.pi_terms||{}), ...(firstPi.terms||{}),
                discount_pct:Number((firstPi.terms||{}).discount_pct??firstPi.discount_pct??(settings.pi_terms||{}).discount_pct??40)}}
        config={settings.pi_config}/>
      </div>
    </div>}
  </div>;
}

function OrdersTab({state,onBump,onSelect,selected,onRemove,onEdit}){
  const [confirmDel,setConfirmDel]=useState(null);
  const [editing,setEditing]=useState(null);
  if(!state.orders.length) return <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center text-slate-500 text-sm">No orders yet — add one from the <b>➕ New order</b> tab. Each photo you read lands here and drives the whole plan.</div>;
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
    <table className="w-full text-sm" style={{borderCollapse:"collapse",minWidth:760}}>
      <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
        <th className="text-left py-2 px-2">Order</th><th className="text-left py-2 px-2">Party</th><th className="text-left py-2 px-2">Article</th>
        <th className="text-right py-2 px-2">Qty</th><th className="text-center py-2 px-2">Priority</th>
        <th className="text-left py-2 px-2">Dispatch</th><th className="text-right py-2 px-2">Lead</th><th className="text-left py-2 px-2">SLA</th><th></th>
      </tr></thead>
      <tbody>{state.orders.map(o=>(
        <React.Fragment key={o.order_no}>
        <tr className="hover:bg-slate-50">
          <td className="py-2 px-2 mono font-semibold" style={{borderTop:"1px solid #eef0f4"}}>{o.order_no}</td>
          <td className="py-2 px-2 text-slate-600" style={{borderTop:"1px solid #eef0f4"}}>{o.party}</td>
          <td className="py-2 px-2" style={{borderTop:"1px solid #eef0f4"}}>{o.article} <span className="mono text-xs" style={{color:SOLE_COLOR[o.sole_type]}}>· {o.sole_type}</span></td>
          <td className="py-2 px-2 text-right mono" style={{borderTop:"1px solid #eef0f4"}}>{fmt(o.qty)}</td>
          <td className="py-2 px-2 text-center" style={{borderTop:"1px solid #eef0f4"}}>
            <div className="inline-flex items-center gap-1">
              <button onClick={()=>onBump(o.order_no,-1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 mono">▲</button>
              <span className="mono w-5 inline-block">{o.priority}</span>
              <button onClick={()=>onBump(o.order_no,1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 mono">▼</button>
            </div>
          </td>
          <td className="py-2 px-2 mono" style={{borderTop:"1px solid #eef0f4"}}>{niceDate(o.dispatch_date)}</td>
          <td className="py-2 px-2 text-right mono text-slate-500" style={{borderTop:"1px solid #eef0f4"}}>{o.lead_days}d</td>
          <td className="py-2 px-2" style={{borderTop:"1px solid #eef0f4"}}><Pill status={o.sla}/></td>
          <td className="py-2 px-2" style={{borderTop:"1px solid #eef0f4"}}>
            <button onClick={()=>onSelect(selected===o.order_no?null:o.order_no)} className="text-xs font-semibold text-indigo-700 hover:underline">{selected===o.order_no?"Hide":"Detail"}</button>
            {onEdit && <button onClick={()=>{setEditing(editing===o.order_no?null:o.order_no); setConfirmDel(null);}}
              className="text-xs font-semibold text-slate-600 hover:underline ml-2">{editing===o.order_no?"Cancel":"Edit saved order"}</button>}
            {onRemove && <button onClick={()=>{setConfirmDel(o.order_no); setEditing(null);}} title="Remove order"
              className="text-rose-500 ml-2 text-sm leading-none">×</button>}
          </td>
        </tr>
        {confirmDel===o.order_no && <tr><td colSpan={9} className="px-2 pb-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 flex items-center gap-3 flex-wrap">
            <div className="text-sm text-rose-900">
              Remove <b className="mono">{o.order_no}</b> — {o.article}, {fmt(o.qty)} pairs for {o.party}?
              <span className="block text-xs text-rose-700 mt-0.5">This cannot be undone, and every other order will be rescheduled.</span>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={()=>setConfirmDel(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Keep it</button>
              <button onClick={()=>{setConfirmDel(null); onRemove(o.order_no);}} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white">Remove order</button>
            </div>
          </div></td></tr>}

        {editing===o.order_no && <tr><td colSpan={9} className="px-2 pb-3">
          <EditOrder o={o} onCancel={()=>setEditing(null)}
            onSave={async patch=>{ await onEdit(o.order_no,patch); setEditing(null); }} />
        </td></tr>}

        {selected===o.order_no && <tr><td colSpan={9} className="px-2 pb-3" style={{background:"#fafbfd"}}>
          <div className="flex gap-4 flex-wrap py-2 items-start">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">Combo lines</div>
              <div className="flex gap-1.5 flex-wrap">{o.lines.map((l,i)=>(
                <span key={i} className="mono text-xs bg-white border border-slate-200 rounded-lg px-2 py-1">{l.label||l.combo}: {fmt(l.qty)}</span>))}</div>
            </div>
            {(o.pi && (o.pi.remarks || o.pi.order_nature || o.pi.attachment || o.pi.upper_colour)) && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">Notes</div>
                {o.pi.order_nature && <div className="text-xs text-slate-600 mb-1">Nature: <b>{o.pi.order_nature}</b></div>}
                <div className="text-xs text-slate-600 mb-1">Print: <b>{o.pi.printing?"Yes":"No"}</b></div>
                {(o.pi.vl||o.pi.sole_colour||o.pi.upper_colour) && <div className="text-xs text-slate-600 mb-1">
                  {[o.pi.vl&&`Closure ${o.pi.vl}`,o.pi.sole_colour&&`Sole ${o.pi.sole_colour}`,o.pi.upper_colour&&`Upper ${o.pi.upper_colour}`].filter(Boolean).join(" · ")}
                </div>}
                {o.pi.remarks && <div className="text-xs text-slate-600 mb-1 max-w-xs">{o.pi.remarks}</div>}
                {o.pi.attachment && <img src={o.pi.attachment} alt="" className="max-h-20 rounded border border-slate-200" />}
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">Stages</div>
              <div className="flex gap-2 flex-wrap">{o.stages.filter(s=>!s.instant).map((s,i)=>(
                <div key={i} className="rounded-lg border px-3 py-2 bg-white" style={{borderColor:SLA_COLOR[s.status]||"#e2e8f0",minWidth:120}}>
                  <div className="mono text-xs font-semibold">{s.stage}{s.queue_wait_days>0 && <span className="text-slate-400 font-normal"> · waited {s.queue_wait_days}d</span>}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{niceDate(s.start_date)} → {niceDate(s.end_date)}</div>
                  <div className="mono text-xs mt-0.5" style={{color:SLA_COLOR[s.status]}}>{s.slip_days>0?`+${s.slip_days}d late`:"on time"}</div>
                </div>))}</div>
            </div>
          </div>
        </td></tr>}
        </React.Fragment>
      ))}</tbody>
    </table>
    <p className="text-xs text-slate-400 mt-2">Nudge priority ▲▼ — the expert decides, the system recomputes. Lower number = more important.</p>
  </div>;
}

/* Resize before upload. A phone photo is several MB as base64 — past the
   serverless request limit — so an unresized upload silently fails. */
function shrinkImage(file, maxDim=900, quality=0.75){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const scale=Math.min(1, maxDim/Math.max(img.width,img.height));
        const c=document.createElement("canvas");
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL("image/jpeg",quality));
      };
      img.onerror=()=>reject(new Error("That file is not a readable image."));
      img.src=fr.result;
    };
    fr.onerror=()=>reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
}

function EditOrder({o,onSave,onCancel}){
  const [article,setArticle]=useState(o.article_code||o.article);
  const [party,setParty]=useState(o.party||"");
  const [date,setDate]=useState(o.order_date);
  const [prio,setPrio]=useState(o.priority);
  const [lines,setLines]=useState(o.lines.map(l=>({...l})));
  const [remarks,setRemarks]=useState((o.pi&&o.pi.remarks)||"");
  const [nature,setNature]=useState((o.pi&&o.pi.order_nature)||"");
  const [vlEdit,setVlEdit]=useState((o.pi&&o.pi.vl)||"");
  const [dispatchTimeline,setDispatchTimeline]=useState(
    (o.pi&&o.pi.dispatch_timeline)||(o.pi&&o.pi.terms&&o.pi.terms.dispatch_timeline)||"45 days");
  const [soleEdit,setSoleEdit]=useState((o.pi&&o.pi.sole_colour)||"");
  const [upperEdit,setUpperEdit]=useState((o.pi&&o.pi.upper_colour)||"");
  const [printingEdit,setPrintingEdit]=useState(!!((o.pi&&o.pi.printing)||o.printing));
  const [stitchingEdit,setStitchingEdit]=useState((o.pi&&o.pi.stitching)||o.stitching||"inhouse");
  const [attachment,setAttachment]=useState((o.pi&&o.pi.attachment)||null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");

  // A line that carries exact sizes is edited size by size and its total is
  // DERIVED. Typing a new total against an untouched size map produced an order
  // the server rightly rejected ("exact-size quantities total 400, not 500"),
  // which made Save edits fail on every photo-read, bulk-imported or PI-read
  // order — i.e. almost all of them.
  const sizeTotal=sizes=>Object.values(sizes||{}).reduce((a,b)=>a+(Number(b)||0),0);
  const setQty=(i,v)=>setLines(ls=>ls.map((l,j)=>j===i?{...l,qty:v}:l));
  const setSize=(i,size,v)=>setLines(ls=>ls.map((l,j)=>{
    if(j!==i) return l;
    const next={...(l.sizes||{}),[size]:Math.max(0,Number(v)||0)};
    return {...l,sizes:next,qty:sizeTotal(next)};
  }));
  const clearLine=i=>setLines(ls=>ls.map((l,j)=>j!==i?l
    :l.sizes?{...l,sizes:Object.fromEntries(Object.keys(l.sizes).map(s=>[s,0])),qty:0}:{...l,qty:0}));
  const total=lines.reduce((a,l)=>a+(l.sizes?sizeTotal(l.sizes):(Number(l.qty)||0)),0);

  async function pickFile(f){
    if(!f) return;
    setErr("");
    try{ setAttachment(await shrinkImage(f)); }
    catch(e){ setErr("Could not attach that image: "+(e.message||e)); }
  }

  function changeArticle(next){
    const combos=(INPUTS.articles[next]||{}).combo_order||[];
    setArticle(next);
    setLines(ls=>ls.map((l,i)=>{
      const combo=combos.includes(l.combo)?l.combo:(combos[i]||combos[0]);
      // The old article's exact sizes and its printed size list do not carry
      // over — a lace range numbers 6..9 where a velcro one numbers 6s..9s.
      return {...l,combo,label:combo,sizes:undefined,size_order:undefined};
    }).filter(l=>l.combo));
  }

  async function save(produce=false){
    // On a line with exact sizes the sizes ARE the quantity. Deriving the total
    // here means the two can never disagree, whatever the editor did.
    const clean=lines.map(l=>{
      const exact=l.sizes&&Object.keys(l.sizes).length;
      const sizes=exact?Object.fromEntries(Object.entries(l.sizes)
        .map(([s,v])=>[s,Math.max(0,Number(v)||0)]).filter(([,v])=>v>0)):null;
      const qty=sizes?sizeTotal(sizes):(Number(l.qty)||0);
      return {combo:l.combo,qty,label:l.label||l.combo,
        ...(sizes&&Object.keys(sizes).length?{sizes}:{}),
        ...(Array.isArray(l.size_order)&&l.size_order.length?{size_order:l.size_order}:{}),
        ...(Number(l.ppc)>0?{ppc:Number(l.ppc)}:{})};
    }).filter(l=>l.qty>0);
    if(!clean.length){ setErr("Keep at least one line with a quantity above zero."); return; }
    if(produce&&(!nature.trim()||!dispatchTimeline.trim()||!soleEdit.trim()||!upperEdit.trim())){
      setErr("Order nature, dispatch timeline, sole colour and upper colour are required before producing the revised PI."); return;
    }
    setBusy(true); setErr("");
    try{ await onSave({expected_version:o.version,article_code:article,party,order_date:date,priority:Number(prio)||2,lines:clean,
      pi:{...(o.pi||{}),remarks, order_nature:nature, vl:vlEdit,
          dispatch_timeline:dispatchTimeline,
          terms:{...((o.pi&&o.pi.terms)||{}),dispatch_timeline:dispatchTimeline},
          sole_colour:soleEdit, upper_colour:upperEdit,
          printing:printingEdit, stitching:stitchingEdit,
          production_status:produce?"produced":"edited",
          revision:Number((o.pi&&o.pi.revision)||0)+1, revised_at:new Date().toISOString(),
          attachment:attachment||undefined}}); }
    catch(e){ setErr(String(e.message||e)); setBusy(false); }
  }

  return <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-3">
    <div className="text-xs uppercase tracking-wide text-indigo-900 font-semibold mb-2">Editing {o.order_no} · {article}</div>
    <div className="flex gap-3 flex-wrap mb-3">
      <label className="text-xs text-slate-600">Article
        <select value={article} onChange={e=>changeArticle(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white max-w-64">
          {Object.keys(INPUTS.articles).filter(a=>
            ((INPUTS.articles[a]||{}).combo_order||Object.keys((INPUTS.articles[a]||{}).combos||{})).length>0)
            .map(a=><option key={a} value={a}>{a}</option>)}
        </select></label>
      <label className="text-xs text-slate-600">Party
        <input value={party} onChange={e=>setParty(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-52" /></label>
      <label className="text-xs text-slate-600">Order date
        <input type="date" value={date} onChange={e=>setDate(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 mono" /></label>
      <label className="text-xs text-slate-600">Priority
        <input type="number" min={1} value={prio} onChange={e=>setPrio(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-20 mono" /></label>
      <label className="text-xs text-slate-600">Order nature
        <input list="order-nature-options" value={nature} onChange={e=>setNature(e.target.value)}
          placeholder="MTS / Institutional / MTO, or type your own"
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-56" />
        <datalist id="order-nature-options">
          <option value="MTS" /><option value="Institutional" /><option value="MTO" />
        </datalist></label>
      <label className="text-xs text-slate-600">Closure (Lace / Velcro)
        <input value={vlEdit} onChange={e=>setVlEdit(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-28" /></label>
      <label className="text-xs text-slate-600">Dispatch timeline
        <input value={dispatchTimeline} onChange={e=>setDispatchTimeline(e.target.value)}
          placeholder="e.g. 45 days"
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-32" /></label>
      <label className="text-xs text-slate-600">Sole colour
        <input value={soleEdit} onChange={e=>setSoleEdit(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-32" /></label>
      <label className="text-xs text-slate-600">Upper colour
        <input value={upperEdit} onChange={e=>setUpperEdit(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-32" /></label>
      <label className="text-xs text-slate-600">Print
        <select value={printingEdit?"yes":"no"} onChange={e=>setPrintingEdit(e.target.value==="yes")}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="no">No</option><option value="yes">Yes</option>
        </select></label>
      <label className="text-xs text-slate-600">Stitching
        <select value={stitchingEdit} onChange={e=>setStitchingEdit(e.target.value)}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="inhouse">In-house</option><option value="outside">Outside</option>
        </select></label>
    </div>
    <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">Quantities (pairs)</div>
    <div className="flex gap-2 flex-wrap mb-2">
      {lines.map((l,i)=>{
        // Cartons are the unit the factory actually counts in; pairs are what
        // the planner needs. Show both, edit either, keep them in step.
        const ppc=packQty(article,l.combo);
        const exact=l.sizes&&Object.keys(l.sizes).length;
        const qty=exact?sizeTotal(l.sizes):(Number(l.qty)||0);
        return <div key={i} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="mono font-semibold">{l.label||l.combo}</span>
            <button onClick={()=>clearLine(i)} title="Set this line to zero — it is dropped on save"
              className="ml-auto text-rose-500 leading-none">×</button>
          </div>
          {exact
            /* This order records the exact pairs per size. The total is derived
               from them: typing a different total would contradict the sizes and
               the server rejects the order outright. */
            ? <>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {Object.entries(l.sizes).map(([size,v])=>(
                    <label key={size} className="text-slate-500">
                      <span className="mono" style={{fontSize:9}}>{size}</span>
                      <input type="number" min={0} value={v}
                        aria-label={`${l.combo} size ${size} pairs`}
                        onChange={e=>setSize(i,size,e.target.value)}
                        className="block w-16 text-sm border border-slate-300 rounded px-1.5 py-1 mono" />
                    </label>))}
                </div>
                <div className="text-slate-400 mt-1" style={{fontSize:9}}>
                  = <b className="mono text-slate-600">{fmt(qty)}</b> pairs{ppc?` · ${+(qty/ppc).toFixed(2)} cartons`:""}
                </div>
              </>
            : <div className="flex gap-1.5 mt-1 items-end">
                <div><span className="text-slate-400" style={{fontSize:9}}>pairs</span>
                  <input type="number" min={0} value={l.qty}
                    aria-label={`${l.combo} pairs`} onChange={e=>setQty(i,e.target.value)}
                    className="block w-20 text-sm border border-slate-300 rounded px-1.5 py-1 mono" /></div>
                <div><span className="text-slate-400" style={{fontSize:9}}>cartons</span>
                  <input type="number" min={0} step="any" disabled={!ppc}
                    value={ppc ? +(qty/ppc).toFixed(2) : ""}
                    title={ppc ? `${ppc} pairs per carton` : "no packing chart for this size range"}
                    onChange={e=>{ const c=Number(e.target.value)||0; if(ppc) setQty(i, Math.round(c*ppc)); }}
                    className="block w-20 text-sm border border-slate-300 rounded px-1.5 py-1 mono disabled:bg-slate-50" /></div>
              </div>}
        </div>;})}
    </div>
    <div className="flex gap-2 items-end flex-wrap mb-2">
      <label className="text-xs text-slate-600">Add a whole size range
        <select defaultValue="" onChange={e=>{
            const cb=e.target.value; e.target.value="";
            if(cb && !lines.some(l=>l.combo===cb)) setLines(ls=>[...ls,{combo:cb,qty:0,label:cb}]);
          }}
          className="block mt-1 text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          <option value="">Pick a size range…</option>
          {((INPUTS.articles[article]||{}).combo_order||[])
            .filter(cb=>!lines.some(l=>l.combo===cb))
            .map(cb=><option key={cb} value={cb}>{cb}</option>)}
        </select></label>
      <span className="text-xs text-slate-400">Set a line to 0 to drop it.</span>
    </div>
    <div className="mb-3">
      <AddSize articleCode={article} articleType={vlEdit} lines={lines} onChange={setLines} />
    </div>

    <label className="text-xs text-slate-600 block mb-2">Remarks
      <textarea value={remarks} onChange={e=>setRemarks(e.target.value)} rows={2}
        className="block mt-1 w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5" /></label>
    <label className="text-xs text-slate-600 block mb-2">Attached screenshot
      <input type="file" accept="image/*" onChange={e=>{const f=e.target.files&&e.target.files[0]; e.target.value=""; pickFile(f);}}
        className="block mt-1 text-xs" />
      {attachment && <img src={attachment} alt="" className="mt-1 max-h-24 rounded border border-slate-200" />}
    </label>
    <div className="text-xs text-slate-500 mb-2">Total <b className="mono">{fmt(total)}</b> pairs. Changing the article remaps each line to that article's packing list immediately.</div>
    {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5 mb-2">{err}</div>}
    <div className="flex gap-2">
      <button disabled={busy} onClick={()=>save(false)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-indigo-800 disabled:opacity-50">{busy?"Saving…":"Save edits"}</button>
      <button disabled={busy} onClick={()=>save(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{busy?"Saving…":"Save & produce"}</button>
      <button onClick={onCancel} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Cancel</button>
    </div>
  </div>;
}

/* Day-by-day production plan: what runs on which machine on which date.
   Built entirely from the computed stage allocations — nothing new is inferred. */
function PlanTab({state,caps}){
  const centres = Object.keys(INPUTS.workcenters);
  // The schedule was built from the edited capacities; reading the seed here
  // made this screen disagree with Machine load the moment one was changed.
  const capacityOf = c => (caps && caps[c]) ?? INPUTS.workcenters[c].capacity_per_day;
  const byDay = {};
  for(const o of state.orders){
    for(const st of o.stages){
      if(st.instant || !st.alloc) continue;
      for(const [day,pairs] of Object.entries(st.alloc)){
        const d = Number(day);
        (byDay[d] = byDay[d] || {});
        (byDay[d][st.work_center] = byDay[d][st.work_center] || []).push({
          order_no:o.order_no, article:o.article, party:o.party, pairs, sla:o.sla });
      }
    }
  }
  const days = Object.keys(byDay).map(Number).sort((a,b)=>a-b);
  if(!days.length) return <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center text-slate-500 text-sm">
    Nothing scheduled yet — add an order and the production plan builds itself.</div>;

  const active = centres.filter(c=>days.some(d=>byDay[d][c]));

  return <div data-print-area className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <div>
        <div className="text-sm font-semibold text-slate-700">Production plan</div>
        <div className="text-xs text-slate-500">Every working day from {niceDate(fromDay(days[0],INPUTS.origin))} to {niceDate(fromDay(days[days.length-1],INPUTS.origin))} — what runs where.</div>
      </div>
      <button onClick={()=>window.print()} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Print / save PDF</button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="text-left py-2 px-2 whitespace-nowrap">Date</th>
          {active.map(c=><th key={c} className="text-left py-2 px-2">{INPUTS.workcenters[c].name}</th>)}
        </tr></thead>
        <tbody>
          {days.map(d=>{
            const iso = fromDay(d,INPUTS.origin);
            const dow = new Date(iso+"T00:00:00").toLocaleDateString(undefined,{weekday:"short"});
            return <tr key={d} className="align-top hover:bg-slate-50">
              <td className="py-2 px-2 whitespace-nowrap" style={{borderTop:"1px solid #eef0f4"}}>
                <div className="mono text-xs font-semibold">{niceDate(iso)}</div>
                <div className="text-xs text-slate-400">{dow}</div>
              </td>
              {active.map(c=>{
                const jobs = byDay[d][c] || [];
                const cap = capacityOf(c);
                const used = jobs.reduce((a,j)=>a+j.pairs,0);
                return <td key={c} className="py-2 px-2" style={{borderTop:"1px solid #eef0f4"}}>
                  {!jobs.length ? <span className="text-slate-300 text-xs">—</span> : <>
                    {jobs.map((j,i)=>(
                      <div key={i} className="text-xs mb-1">
                        <span className="mono font-semibold">{j.order_no}</span>
                        <span className="text-slate-500"> · {fmt(Math.round(j.pairs))} pr</span>
                        <div className="text-slate-400">{j.article}</div>
                      </div>))}
                    <div className="text-xs text-slate-400 mono">{Math.round(100*used/cap)}% of {fmt(cap)}</div>
                  </>}
                </td>;})}
            </tr>;})}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-slate-400 mt-3">Each molding machine takes one order at a time, so a molding column never shows two orders on the same day — but the molding machines run in parallel with each other. The pooled centres share a day up to capacity.</p>
  </div>;
}

function PlanningLogic({orders}){
  const queue=[...orders].sort((a,b)=>a.priority-b.priority||(a.order_date<b.order_date?-1:a.order_date>b.order_date?1:0)||String(a.order_no).localeCompare(String(b.order_no)));
  return <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
      <div className="text-sm font-semibold text-slate-700">Production-planning logic for every order</div>
      <div className="text-xs text-slate-500">The dates below show the exact inputs, capacity calculation and machine wait used for each order.</div>
    </div>
    {queue.map((o,rank)=><details key={o.order_no} className="border-b border-slate-100 last:border-0">
      <summary className="cursor-pointer px-3 py-2 text-xs">
        <b className="mono">{o.order_no}</b> · queue #{rank+1} · P{o.priority} · {o.article} · {fmt(o.qty)} pairs · dispatch {niceDate(o.dispatch_date)}
      </summary>
      <div className="px-3 pb-3 text-xs text-slate-600">
        <div className="mb-2">Release: order date <b className="mono">{o.order_date}</b>
          {o.release_delay_days>0?<> + {o.release_delay_days} day{o.release_delay_days===1?"":"s"} for {o.printing?"printing / external handling":"external handling"}</>:" + no pre-production buffer"}
          {" = "}<b className="mono">{o.release_date}</b>. Queue order is priority, then order date, then order number.</div>
        <div className="overflow-x-auto"><table className="w-full" style={{minWidth:720}}>
          <thead><tr className="text-slate-400 uppercase tracking-wide"><th className="text-left py-1">Stage / centre</th><th className="text-left">Ready</th><th className="text-left">Capacity logic</th><th className="text-left">Machine wait</th><th className="text-left">Scheduled</th></tr></thead>
          <tbody>{o.stages.filter(s=>!s.instant).map(s=><tr key={s.stage} className="border-t border-slate-100">
            <td className="py-1.5"><b>{s.stage}</b><div className="text-slate-400">{(INPUTS.workcenters[s.work_center]||{}).name||s.work_center}</div></td>
            <td className="mono">{niceDate(s.ready_date)}</td>
            <td className="mono">ceil({fmt(o.qty)} ÷ {fmt(s.capacity_per_day)}) = {Math.ceil(o.qty/s.capacity_per_day)} base day{Math.ceil(o.qty/s.capacity_per_day)===1?"":"s"}</td>
            <td>{s.queue_wait_days?`${s.queue_wait_days} day${s.queue_wait_days===1?"":"s"}`:"None"}</td>
            <td className="mono">{niceDate(s.start_date)} → {niceDate(s.end_date)} ({s.duration_days}d)</td>
          </tr>)}</tbody>
        </table></div>
      </div>
    </details>)}
  </div>;
}

function ScheduleTab({state}){
  const STAGE_COLOR = {CUTTING:"#2563eb",STITCHING:"#7c3aed",PRINTING:"#0891b2",MOLDING:"#059669",ASSEMBLY:"#0d9488",PACKING:"#d97706"};
  const PRI_STYLE = {1:{bg:"#fee2e2",fg:"#b91c1c"},2:{bg:"#f1f5f9",fg:"#475569"},3:{bg:"#f8fafc",fg:"#94a3b8"}};
  const rows=[...state.orders].sort((a,b)=>a.priority-b.priority||(a.order_date<b.order_date?-1:a.order_date>b.order_date?1:0)||String(a.order_no).localeCompare(String(b.order_no)));
  const maxDay=Math.max(...rows.map(o=>o.dispatch_day),1);
  const minDay=Math.min(...rows.map(o=>Math.min(...o.stages.map(s=>s.start))),0);
  const span=maxDay-minDay+1;
  const days=Array.from({length:span},(_,i)=>minDay+i);
  const todayIdx=dayIndex(new Date().toISOString().slice(0,10), INPUTS.origin);
  const showToday=todayIdx>=minDay&&todayIdx<=maxDay;
  const tickEvery=span>90?14:7;
  const ticks=days.filter(d=>((d-minDay)%tickEvery)===0);
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <p className="text-sm text-slate-500 mb-1"><b>Rows are in queue order</b> - the plan fills top to bottom. Each colour is a stage. A hatched stretch means that order is waiting because a row above it is using the machine it needs. Faint grey = before the order's own date.</p>
    <details className="mb-3">
      <summary className="text-xs font-semibold text-indigo-700 cursor-pointer">How this plan is calculated (5 rules)</summary>
      <div className="text-xs text-slate-500 mt-1 leading-relaxed">
        1. Orders queue by <b>priority first</b>, then earliest order date, then order number. Every order starts at P2, so in practice that is first-in first-out until someone sets P1 to jump the queue or P3 to yield.<br/>
        2. Each order follows its article route. A stage starts on the next planning day after the previous stage finishes; in-house Preparation appears once in that route and is not added again as a buffer.<br/>
        3. Each machine line has a daily capacity in pairs. An order takes whatever is free each day - rows higher in the queue get first claim, which is why lower rows show hatched waiting.<br/>
        4. An order never starts before its own order date (faint grey zone).<br/>
        5. Dispatch is its own stage with its own capacity — the dispatch date is the day it finishes, not the day packing ends. Same inputs always give the same plan.
      </div>
    </details>
    <div className="overflow-x-auto">
    <div style={{minWidth:860}}>
      <div className="flex items-center gap-2" style={{marginBottom:2}}>
        <div className="flex-none" style={{width:112}}/>
        <div className="relative flex-1" style={{height:13}}>
          {ticks.map(d=>(
            <span key={d} className="mono absolute text-slate-400" style={{left:`${100*(d-minDay)/span}%`,fontSize:9,whiteSpace:"nowrap"}}>{niceDate(fromDay(d,INPUTS.origin))}</span>))}
          {showToday && <span className="mono absolute font-semibold" style={{left:`${100*(todayIdx-minDay)/span}%`,fontSize:9,color:"#0f766e",transform:"translateX(-50%)"}}>today</span>}
        </div>
        <div className="flex-none" style={{width:58}}/>
      </div>
      {rows.map(o=>{
        const rel=dayIndex(o.order_date, INPUTS.origin);
        const byDay={};
        let prevEnd=null;
        o.stages.filter(s=>!s.instant).forEach((s,si)=>{
          if(prevEnd!==null) for(let d=prevEnd+1; d<s.start; d++) byDay[d]={stage:s.stage,working:false,first:false};
          for(let d=s.start; d<=s.end; d++) byDay[d]={stage:s.stage,working:!!(s.alloc&&s.alloc[d]>0),first:d===s.start};
          prevEnd=s.end;
        });
        const pri=PRI_STYLE[o.priority]||PRI_STYLE[3];
        return (
        <div key={o.order_no} className="flex items-center gap-2 mb-2">
          <div className="mono flex-none" style={{width:112,fontSize:11,position:"sticky",left:0,background:"#fff",zIndex:2,lineHeight:1.35}}>
            {o.order_no} <span className="font-semibold rounded px-1" style={{fontSize:9,background:pri.bg,color:pri.fg}}>P{o.priority}</span><br/>
            <span className="text-slate-400" style={{fontSize:9}}>{o.article.length>15?o.article.slice(0,14)+"…":o.article}</span></div>
          <div className="relative flex flex-1" style={{height:24,borderRadius:4,overflow:"hidden",background:"#f6f8fb"}}>
            {days.map(d=>{
              const cell=byDay[d];
              if(!cell){
                const pre = d<rel;
                return <div key={d} title={pre?("before order date ("+niceDate(o.order_date)+")"):""}
                  style={{flex:1,borderRight:"1px solid #fff",background:pre?"#e7e9f0":"transparent"}}/>;
              }
              const sc=STAGE_COLOR[cell.stage]||"#64748b";
              return <div key={d} title={`${cell.stage} - ${niceDate(fromDay(d,INPUTS.origin))}${cell.working?"":" - waiting (machine busy with higher-priority rows)"}`}
                style={{flex:1,
                  borderLeft: cell.first ? "2px solid #ffffff" : "none",
                  borderRight:"1px solid rgba(255,255,255,.45)",
                  background: cell.working ? sc
                    : `repeating-linear-gradient(45deg, ${sc}40, ${sc}40 2px, #f1f4f8 2px, #f1f4f8 5px)`}}/>;
            })}
            {o.stages.filter(s=>!s.instant && (s.end-s.start+1)/span>=0.028).map((s,i)=>(
              <span key={i} className="mono absolute" style={{left:`${100*(s.start-minDay+0.15)/span}%`,top:5,fontSize:8,
                color:"#fff",textShadow:"0 0 3px rgba(0,0,0,.6)",pointerEvents:"none"}}>{STAGE_ABBR[s.stage]||s.stage[0]}</span>))}
            {showToday && <div className="absolute" style={{left:`${100*(todayIdx-minDay)/span}%`,top:0,bottom:0,width:2,background:"#0f766e",opacity:.45,pointerEvents:"none"}}/>}
          </div>
          <div className="mono flex-none text-right" style={{width:58,fontSize:11,color:SLA_COLOR[o.sla]}}>{niceDate(o.dispatch_date)}</div>
        </div>);
      })}
    </div>
    </div>
    <PlanningLogic orders={rows}/>
    <div className="flex gap-3 mt-3 flex-wrap items-center">
      {Object.entries(STAGE_COLOR).filter(([k])=>k!=="PRINTING").map(([k,c])=>(
        <span key={k} className="mono text-xs flex items-center gap-1"><span style={{width:10,height:10,background:c,borderRadius:2,display:"inline-block"}}/>{STAGE_ABBR[k]||k}</span>))}
      <span className="mono text-xs flex items-center gap-1"><span style={{width:16,height:10,background:"repeating-linear-gradient(45deg,#7c3aed40,#7c3aed40 2px,#f1f4f8 2px,#f1f4f8 5px)",borderRadius:2,display:"inline-block"}}/>waiting (tinted by the stage it waits for)</span>
      <span className="mono text-xs flex items-center gap-1"><span style={{width:16,height:10,background:"#e7e9f0",borderRadius:2,display:"inline-block"}}/>before order date</span>
    </div>
  </div>;
}

function ProcurementTab({state}){
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
    <p className="text-sm text-slate-500 mb-3">All {state.netted.length} real materials rolled up across {state.totals.orders} orders (cutting + stitching, as per your BOM file), netted against stock. <b className="text-orange-700">{state.procurement.length} need purchasing.</b> Stock figures are placeholders.</p>
    <table className="w-full text-sm" style={{borderCollapse:"collapse",minWidth:660}}>
      <thead><tr className="text-xs uppercase tracking-wide text-slate-500">
        <th className="text-left py-2 px-2">Material</th>
        <th className="text-right py-2 px-2">Required</th><th className="text-right py-2 px-2">In stock</th><th className="text-right py-2 px-2">Shortfall</th><th className="text-left py-2 px-2">UOM</th>
      </tr></thead>
      <tbody>{[...state.netted].sort((a,b)=>b.shortfall-a.shortfall).map(m=>(
        <tr key={m.material_key} style={{background:m.shortfall>0?"#fffaf5":"#fff"}}>
          <td className="py-2 px-2" style={{borderTop:"1px solid #eef0f4"}}>{m.name}</td>
          <td className="py-2 px-2 text-right mono" style={{borderTop:"1px solid #eef0f4"}}>{fmt(m.required,1)}</td>
          <td className="py-2 px-2 text-right mono text-slate-500" style={{borderTop:"1px solid #eef0f4"}}>{fmt(m.stock,1)}</td>
          <td className="py-2 px-2 text-right mono font-semibold" style={{borderTop:"1px solid #eef0f4",color:m.shortfall>0?"#c2410c":"#0f9d6b"}}>{m.shortfall>0?fmt(m.shortfall,1):"—"}</td>
          <td className="py-2 px-2 mono text-xs text-slate-500" style={{borderTop:"1px solid #eef0f4"}}>{m.uom}</td>
        </tr>))}</tbody>
    </table>
  </div>;
}

function MachinesTab({state,caps,setCaps,targets,setTargets}){
  // Derived from reference data, not hardcoded — add a work centre and it
  // appears here automatically. Ordered by production sequence so the strips
  // read the way the factory flows, and rows never re-order while editing.
  const STAGE_SEQ=["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"];
  const ORDER=Object.keys(INPUTS.workcenters).sort((a,b)=>{
    const wa=INPUTS.workcenters[a], wb=INPUTS.workcenters[b];
    const d=STAGE_SEQ.indexOf(wa.stage)-STAGE_SEQ.indexOf(wb.stage);
    return d!==0?d:a.localeCompare(b);
  });
  const maxDay=Math.max(...state.orders.map(o=>o.dispatch_day),1);
  const days=Array.from({length:maxDay+1},(_,i)=>i);
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <p className="text-sm text-slate-500 mb-1">One strip per line, day by day: <b>how full that line is on each day</b>. Red = fully booked, amber = nearly full, blue = partly used, empty = free. The date on the right is when the line frees up.</p>
    <p className="text-xs text-slate-400 mb-4">Each molding machine runs one order at a time, but they run in parallel with each other. Capacities are placeholders until the factory confirms them.</p>
    <SlaTargets targets={targets} setTargets={setTargets} />
    <MoldingAssignment />
    {ORDER.filter(c=>INPUTS.workcenters[c]).map(code=>{
      const wc=INPUTS.workcenters[code];
      const cap=caps[code];
      const load=state.daily_load[code]||{};
      const busyDays=Object.keys(load).filter(d=>load[d]>1e-9).map(Number);
      const lastBusy=busyDays.length?Math.max(...busyDays):-1;
      const booked=Object.values(load).reduce((a,b)=>a+b,0);
      return (
      <div key={code} className="mb-4">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <div className="text-sm font-semibold flex-none" style={{width:150}}>{wc.name}{wc.sole_type && <span className="mono text-xs text-slate-400 font-normal"> · {wc.sole_type}</span>}</div>
          <div className="flex items-center gap-1.5 flex-none">
            <input type="number" min="1" value={cap}
              onChange={e=>setCaps(c=>({...c,[code]:Math.max(1,Math.round(+e.target.value)||1)}))}
              className="mono text-xs border border-slate-200 rounded-lg px-2 py-1 text-right" style={{width:76}}/>
            <span className="mono text-xs text-slate-400">pairs/day</span>
          </div>
          <div className="mono text-xs text-slate-500 ml-auto">
            {lastBusy>=0 ? <>booked till <b className="text-slate-800">{niceDate(fromDay(lastBusy,INPUTS.origin))}</b> · {fmt(booked)} pairs</> : "free"}
          </div>
        </div>
        <div className="flex" style={{height:16,borderRadius:4,overflow:"hidden",background:"#f8fafc",border:"1px solid #eef0f4"}}>
          {days.map(d=>{
            const u=(load[d]||0)/cap;
            const bg = u<=0 ? "transparent" : u>=0.999 ? "#dc2626" : u>=0.75 ? "#d97706" : "#4f46e5";
            return <div key={d} title={`${niceDate(fromDay(d,INPUTS.origin))}: ${fmt(load[d]||0)} / ${fmt(cap)} pairs (${Math.round(u*100)}%)`}
              style={{flex:1,background:bg,opacity:u<=0?1:0.45+0.55*Math.min(u,1),borderRight:"1px solid #fff"}}/>;
          })}
        </div>
      </div>);
    })}
    <div className="flex gap-3 mt-1 flex-wrap">
      <Leg c="#dc2626" t="full (100%)"/><Leg c="#d97706" t="75–99%"/><Leg c="#4f46e5" t="partly used"/><Leg c="#f8fafc" t="free" border/>
    </div>
  </div>;
}
function Leg({c,t,border}){return <span className="mono text-xs flex items-center gap-1"><span style={{width:12,height:10,background:c,border:border?"1px solid #e2e8f0":"none",borderRadius:2,display:"inline-block"}}/>{t}</span>;}

/* Which PVC machine each article runs on. Unassigned articles fall back to
   rotary, which makes rotary look busier than it is — so this is worth setting
   before trusting any molding utilisation figure. */
function MoldingAssignment(){
  const pvc=Object.entries(INPUTS.articles).filter(([,a])=>a.sole_type==="PVC");
  const [draft,setDraft]=useState({});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  if(!pvc.length) return null;
  const unassigned=pvc.filter(([k,a])=>!(draft[k]??a.molding_machine)).length;

  async function save(){
    const patch={};
    for(const [k,v] of Object.entries(draft)) patch[k]=v||null;
    if(!Object.keys(patch).length) return;
    setBusy(true);
    try{ await api.patchReference({molding_machine:patch}); await reloadReference();
         setMsg("Saved — the plan has been recalculated."); setDraft({}); }
    catch(e){ setMsg(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  return <div className="mb-5 border border-slate-200 rounded-xl p-3.5">
    <div className="text-sm font-semibold text-slate-700 mb-1">PVC molding — rotary or vertical</div>
    <p className="text-xs text-slate-500 mb-3">
      PVC articles run on one of two machines. Anything left unset falls back to <b>rotary</b>,
      which inflates rotary&rsquo;s load and understates vertical&rsquo;s.
      {unassigned>0 && <span className="text-amber-700"> {unassigned} of {pvc.length} still unset.</span>}
    </p>
    <div className="flex gap-2 flex-wrap">
      {pvc.map(([k,a])=>{
        const cur=draft[k]??a.molding_machine??"";
        return <label key={k} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
          <div className="font-semibold">{k}</div>
          <select value={cur} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))}
            className="block mt-1 text-sm border rounded-lg px-2 py-1 bg-white"
            style={{borderColor:cur?"#e2e8f0":"#f59e0b"}}>
            <option value="">Not set — defaults to rotary</option>
            <option value="ROTARY">PVC rotary</option>
            <option value="VERTICAL">PVC vertical</option>
          </select></label>;})}
    </div>
    {msg && <div className="text-xs text-slate-600 mt-2">{msg}</div>}
    <button disabled={busy||!Object.keys(draft).length} onClick={save}
      className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":"Save assignments"}</button>
  </div>;
}

/* How On track / At risk / Delayed is decided — stated plainly and editable,
   because these targets are the factory's delivery promise, not a constant. */
function SlaTargets({targets,setTargets}){
  const DEF={CUTTING:8,STITCHING:15,PRINTING:18,MOLDING:22,ASSEMBLY:22,PACKING:28,DISPATCH:30};
  const cur=targets||DEF;
  const [draft,setDraft]=useState(cur);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const dirty=Object.keys(DEF).some(k=>Number(draft[k])!==Number(cur[k]));

  async function save(){
    setBusy(true); setMsg("");
    try{ const v=await api.putSettings({sla_targets:draft});
         setTargets(v.sla_targets); setMsg("Saved — every order's status recalculated."); }
    catch(e){ setMsg(String(e.message||e)); }
    finally{ setBusy(false); }
  }

  return <div className="mb-5 border border-slate-200 rounded-xl p-3.5">
    <div className="text-sm font-semibold text-slate-700 mb-1">Delivery targets — what makes an order late</div>
    <p className="text-xs text-slate-500 mb-3">
      Days allowed from the order date to finish each stage. An order is <b>On track</b> if every stage
      lands on or before its target, <b>At risk</b> if any stage is 1–3 days over, and <b>Delayed</b> if
      any stage is more than 3 days over. The order takes the worst status of its stages.
      <br/><span className="text-amber-700">These started as placeholders implying a 30-day order-to-dispatch promise. Set your real commitment or the colours mean nothing.</span>
    </p>
    <div className="flex gap-2 flex-wrap">
      {Object.keys(DEF).map(k=>(
        <label key={k} className="text-xs text-slate-600">{k}
          <input type="number" min={0} value={draft[k]??""} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))}
            className="block mt-0.5 w-20 text-sm border border-slate-300 rounded-lg px-2 py-1 mono" /></label>))}
    </div>
    {msg && <div className="text-xs text-slate-600 mt-2">{msg}</div>}
    <button disabled={busy||!dirty} onClick={save}
      className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
      {busy?"Saving…":"Save targets"}</button>
  </div>;
}

function CopilotTab({q,setQ,a,busy,ask}){
  const examples=["Which orders are at risk and why?","What is my worst bottleneck?","What should I purchase first?","If I add a stitching shift, what improves?"];
  return <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <p className="text-sm text-slate-500 mb-3">Ask in plain English — answers come from the live computed plan. (Needs AI access to run.)</p>
    <div className="flex gap-2 flex-wrap mb-3">{examples.map(e=>(
      <button key={e} onClick={()=>setQ(e)} className="text-xs border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50">{e}</button>))}</div>
    <div className="flex gap-2">
      <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask()} placeholder="Ask the production copilot…"
        className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-500" />
      <button onClick={ask} disabled={busy} className="font-semibold text-white rounded-xl px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300">{busy?"Thinking…":"Ask"}</button>
    </div>
    {a && <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm whitespace-pre-wrap leading-relaxed">{a}</div>}
  </div>;
}
