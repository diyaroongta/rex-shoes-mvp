import React, { useEffect, useMemo, useState } from "react";
import { todayIso } from "./lib/today.js";
import * as api from "./lib/client.js";
import { REF as INPUTS, reload as reloadReference } from "./lib/refdata.js";
import JobCard from "./JobCard.jsx";
import StageJobCard from "./StageJobCard.jsx";
import { cardKinds } from "../shared/job-card-stages.js";
import { slipFor } from "../shared/job-work.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { optionLabel, TYPES, TYPE_LABEL, TYPE_HELP, RULES, validateFabricator } from "../shared/fabricators.js";
import { prefixOf } from "../shared/product-codes.js";
import { jobOrderBalance, jobOrderQueue } from "../shared/job-orders.js";
import { cardBalance, usesStock, UPPER_START_STAGE } from "../shared/production-units.js";
import { productionOrder, awaitingDecision, allocationSummary } from "../shared/stock-plan.js";
import { materialTotals } from "../shared/bom-components.js";
import StockAtHand from "./StockAtHand.jsx";
import { materialCheck } from "../shared/can-we-make-it.js";
import { onHandBySize } from "../shared/upper-store.js";
import { orderColour } from "../shared/stock-plan.js";
import { upperShortage } from "../shared/store-register.js";

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");
const today = () => todayIso();
/* A bare YYYY-MM-DD is a calendar DAY. `new Date("2026-09-30")` is UTC
   midnight, which is still the 29th anywhere west of Greenwich — so an order
   dated the 30th read "29 Sept" on a machine set to US time. */
export const shortDate = iso => {
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));
  const d=m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(iso);
  return isNaN(d) ? String(iso).slice(0,10)
    : d.toLocaleDateString("en-IN",{day:"numeric",month:"short"});
};

/* Job Order creation. The Order Book supplies the article and ceiling; the
   operator supplies who receives it, the date and the exact size-wise cutting
   quantities. The Job Card is its printable document, not another workflow. */
export default function JobCardTab({ orders=[], initialOrderNo="", embedded=false, onIssued=null, active=true, finishedMoves=[] }){
  const [fabricators,setFabricators]=useState(null);
  const [jobs,setJobs]=useState(null);
  const [orderNo,setOrderNo]=useState("");
  const [fabricator,setFabricator]=useState("");
  const [date,setDate]=useState(today);
  /* TWO DATES, AND THEY ARE NOT THE SAME DAY. The card is WRITTEN today and
     the run may begin on Monday. The plan schedules from the start date — a
     card written on Friday must not book Friday's machines — while the Job
     Orders Database still files the card under the day it was created.
     Left alone, the start date follows the card date, which is the common
     case and keeps simple entry simple. */
  const [startOn,setStartOn]=useState(today);
  const [startPinned,setStartPinned]=useState(false);
  const [qty,setQty]=useState({});
  const [sizes,setSizes]=useState({});
  const [card,setCard]=useState(null);
  const [stale,setStale]=useState(false);
  /* WHICH of the factory's three cards is on screen. The cutting/stitching
     card is the document a job order is issued against, so it leads; the
     pasting and packing cards are the same job order one stage on. */
  const [cardKind,setCardKind]=useState("CUTTING");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [adding,setAdding]=useState(null);   // the inline "new fabricator" draft
  /* Pairs written off as a job-work shortage are re-issued only when somebody
     ASKS. Losing a hundred pairs should be seen and decided about, not healed
     by arithmetic. */
  const [remake,setRemake]=useState(false);
  /* STOCK FIRST. An order whose stock decision reserved UPPERS has two kinds of
     card: the pairs to make through the whole routing, and the pairs whose
     uppers are already in the store — those start at MOULDING, on a card of
     their own. This says which of the two is being raised. */
  const [fromUppers,setFromUppers]=useState(false);

  /* A REFRESH THAT FAILS MUST NOT DESTROY WHAT IS ALREADY ON SCREEN.
     This used to wipe both lists to [] and set an error that nothing ever
     cleared, so one dropped request — a Neon cold start, a lost second of
     wifi — emptied the screen permanently and left "Load failed" sitting
     there. ("Load failed" is the BROWSER's words for a request that never
     completed; nothing in this app produces that string.) A failed refresh now
     keeps the last good data, and the next success clears the message. */
  async function reload({ initial = false } = {}){
    try{
      const [f,j]=await Promise.all([api.listFabricators(),api.listJobWork()]);
      setFabricators(f); setJobs(j); setErr("");
    }catch(e){
      setErr((e && e.message) || String(e));
      /* Only on the FIRST load is empty the truth. After that, stale figures
         beat a blank screen — and the error says they may be stale. */
      if(initial){ setFabricators([]); setJobs([]); }
    }
  }

  /* Polls only while this screen is actually being looked at. The tab stays
     MOUNTED so a half-built job order survives a tab switch, which means an
     unconditional interval would poll every sixty seconds forever on every
     page — and a blip from a poll nobody saw would still be on screen an hour
     later when they finally opened it. */
  useEffect(()=>{
    if(!active) return;
    reload({ initial: fabricators === null });
    const timer=setInterval(reload,60000);
    return()=>clearInterval(timer);
  },[active]);

  /* What is left to put on cards is what is left to PRODUCE: pairs an order
     takes from finished goods are never made, so they are not "left". */
  const queue=useMemo(()=>jobOrderQueue(orders.map(productionOrder),jobs||[]),[orders,jobs]);
  const openOrders=queue.filter(row=>row.remaining>0);
  const order=orders.find(o=>o.order_no===orderNo)||null;
  const stockDecided=!!order&&usesStock(order);
  const awaiting=awaitingDecision(order);
  const balance=order?(stockDecided?cardBalance(order,jobs||[],fromUppers):jobOrderBalance(order,jobs||[])):null;
  const upperBalance=stockDecided?cardBalance(order,jobs||[],true).remaining:0;
  const article=order?(INPUTS.articles||{})[order.article_code]:null;
  const who=(fabricators||[]).find(f=>f.name===fabricator)||null;

  function chooseOrder(no,uppers=false){
    setOrderNo(no); setFromUppers(uppers); setCard(null); setStale(false); setErr(""); setMsg("");
    const chosen=orders.find(o=>o.order_no===no);
    const row=chosen&&usesStock(chosen)?cardBalance(chosen,jobs||[],uppers):queue.find(x=>x.order.order_no===no);
    if(!row){ setQty({}); setSizes({}); return; }
    const nextQty={},nextSizes={};
    for(const line of row.lines){
      nextQty[line.combo]=line.remaining;
      if(line.remaining_sizes) nextSizes[line.combo]={...line.remaining_sizes};
    }
    setQty(nextQty); setSizes(nextSizes); setRemake(false);
  }

  useEffect(()=>{
    if(initialOrderNo&&jobs!==null&&orders.some(o=>o.order_no===initialOrderNo)&&orderNo!==initialOrderNo)
      chooseOrder(initialOrderNo);
  },[initialOrderNo,jobs,orders]);

  const lines=useMemo(()=>Object.entries(qty).filter(([,value])=>Number(value)>0).map(([combo,value])=>({
    /* Numbers, not the input boxes' strings: card 9 was stored as
       {"2":"125",...}, and anything summing those with + concatenates. */
    combo, qty:Number(value),
    sizes:sizes[combo]&&Object.fromEntries(Object.entries(sizes[combo]).map(([s,n])=>[s,Number(n)||0])),
    size_order:order?comboSizesForArticle(order.article_code,combo):[],
    /* Uppers from the store: the card, and the material booked out for it,
       begin at moulding — no rexine or thread for uppers already stitched. */
    ...(fromUppers?{from_stage:UPPER_START_STAGE}:{}),
  })),[qty,sizes,order,fromUppers]);
  const totalPairs=lines.reduce((a,line)=>a+line.qty,0);
  /* IS IT IN STOCK? Checked as the card is built, so the answer comes before
     Issue, not after. A moulding card needs its UPPERS from the upper store,
     size by size; every card needs its raw material. Short is WARNED — the
     job order still issues — and raw material short for an open card is then
     listed on Stores → Raw Material Store until the delivery is booked. */
  const [upperMoves,setUpperMoves]=useState(null);
  useEffect(()=>{
    if(!active||!fromUppers||!order) return;
    let live=true;
    /* Through a resolved promise: a failed or missing answer must leave the
       card buildable, never take the screen down with it. */
    Promise.resolve().then(()=>api.listUpperStore())
      .then(d=>live&&setUpperMoves((d&&d.moves)||[])).catch(()=>live&&setUpperMoves([]));
    return ()=>{live=false;};
  },[active,fromUppers,order&&order.order_no]);
  const upperColour=order?orderColour(order,(INPUTS.articles||{})[order.article_code]):"";
  const uppersShort=useMemo(()=>fromUppers&&order&&upperMoves
    ? upperShortage(lines,onHandBySize(upperMoves,order.article_code,upperColour)) : [],
    [fromUppers,order,upperMoves,lines,upperColour]);
  const rmShort=useMemo(()=>order?materialCheck(lines,(INPUTS.articles||{})[order.article_code],
    INPUTS.materials||{},INPUTS.stock_meta||{}).short:[],[order,lines]);
  /* Only meaningful while the card is still a DRAFT. Once it has been issued
     the balance has already been reduced by these very pairs, so comparing the
     draft against the new remaining accuses the clerk of over-assigning the
     quantities they just successfully assigned. */
  const issued=!!(card&&card.card_no);
  const toRemake=balance?balance.to_remake:0;
  /* On a remake the lost pairs belong to no particular size range — a shortage
     is recorded per JOB — so the per-line check lifts by the pool and the TOTAL
     is what bounds the card. */
  const over=(!issued&&balance)
    ? balance.lines.filter(line=>Number(qty[line.combo]||0)>line.remaining+(remake?toRemake:0)) : [];
  const cap=balance?(remake?balance.remake_allowance:balance.remaining):0;
  const overTotal=!issued&&balance&&totalPairs>cap;
  /* No card while the order still waits for its stock decision: until then
     nobody knows how many pairs are to be made. The server refuses it too. */
  const ready=!!order&&!!who&&totalPairs>0&&!over.length&&!overTotal&&!awaiting;

  function touched(){ if(card)setStale(true); }
  /* NO EVEN SPLIT HERE, DELIBERATELY. A line that carries a size breakdown
     shows one box per size and no range total at all, and those sizes come
     from the Order Book's actual REMAINING per size — a truer figure than any
     split we could derive. A line without a breakdown has no sizes to fill.
     So the rule that governs a carton has nothing to do on this screen. */
  function setRange(combo,value){ setQty(q=>({...q,[combo]:value})); touched(); }
  function setSize(combo,size,value){
    setSizes(current=>{
      const group={...(current[combo]||{}),[size]:value};
      setQty(q=>({...q,[combo]:Object.values(group).reduce((a,n)=>a+(Number(n)||0),0)}));
      return {...current,[combo]:group};
    });
    touched();
  }

  function generate(){
    if(!ready)return;
    setCard({article:order.article_code,order_no:order.order_no,fabricator:who.name,
      slip:`JOB CARD — ${slipFor(who)}`,stage:fromUppers?"MOULDING — uppers from the upper store":"CUTTING & STITCHING",date,
      start_on:startOn||date,card_no:"",
      /* The plan reads this: a card that starts at moulding books no cutting,
         stitching or upper QC, and buys no material for them. */
      ...(fromUppers?{start_stage:UPPER_START_STAGE}:{}),
      /* The SKU code is the article's own assigned product code (one colour,
         one closure); the series code is its family prefix. Both are blank
         until codes have been assigned on Data & BOM. */
      sku_code:(INPUTS.articles[order.article_code]||{}).product_code||"",
      series_code:prefixOf(order.article_code)||"",
      lines});
    setStale(false); setMsg("");
  }

  async function issue(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const snapshot={...card,lines};
      const made=await api.issueJobWork({fabricator:who.name,article:order.article_code,qty:totalPairs,
        stage:"STITCHING",order_no:order.order_no,issued_on:date,
        ...(remake?{remake:true}:{}),
        note:`${remake?"Remake — ":""}Job card for ${order.order_no}`,card:snapshot});
      setCard(c=>({...c,card_no:String(made.id)}));
      setJobs(current=>[made,...(current||[])]);
      /* The draft is SPENT. The printable card keeps its own copy of the lines
         (taken at Preview), so clearing these empties the entry form without
         touching the document — and stops the next render comparing a spent
         draft against a balance that has already absorbed it. */
      setQty({}); setSizes({}); setRemake(false);
      /* The material has physically left the store, and the SERVER booked it:
         one logged issue per by-job-order material, worked out from the stored
         card. This screen used to send the register a new running total built
         from its own copy, so two cards raised at once overwrote each other.
         It is reported separately from the job order: if the booking failed,
         the job order still stands and the operator is told what was NOT
         booked rather than seeing a red error over work that succeeded. */
      const release=made.material_release;
      let stockNote="";
      if(release&&release.ok){
        if(release.released) stockNote=` ${release.released} material${release.released===1?"":"s"} booked out on the stock sheet.`;
        if(release.on_demand) stockNote+=` ${release.on_demand} on-demand material${release.on_demand===1?" was":"s were"} `
          + `not released — the store issues ${release.on_demand===1?"it":"them"} on Issue Material when the floor asks.`;
        if(release.not_on_register&&release.not_on_register.length)
          stockNote+=` NOT booked — not on the material register: ${release.not_on_register.join(", ")}.`;
        if(release.released) await reloadReference().catch(()=>{});
      }else if(release){
        stockNote=` The stock sheet was NOT updated (${release.error||"unknown reason"}) — book the issue on Issue Material yourself.`;
      }
      if(rmShort.length) stockNote+=` ⚠ ${rmShort.length} material${rmShort.length===1?" was":"s were"} short when it was raised `
        + `(${rmShort.slice(0,4).map(r=>r.name).join(", ")}${rmShort.length>4?"…":""}) — listed on Stores → Raw Material Store until the delivery is booked.`;
      if(uppersShort.length) stockNote+=` ⚠ Uppers short in the upper store: ${uppersShort.map(r=>`size ${r.size} ${fmt(r.short)}`).join(", ")}.`;
      setMsg(`Job order ${made.id} created for ${made.fabricator}: ${fmt(made.qty)} pairs.${stockNote} `
        + `Print it below, or choose another order to raise the next one. `
        + `If the PDF does not come through, reopen it any time from Job Orders Database → Job card.`);
      if(onIssued)await onIssued(made);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  const cardBox=React.useRef(null);
  const print=()=>printJobCard(cardBox.current,setErr);

  if(fabricators===null||jobs===null)return <div className="p-5 text-sm text-slate-500">Loading current Order Book balances…</div>;

  return <div className={embedded?"p-4 md:p-5 pb-3":"p-4 md:p-5"}>
    {msg&&<div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err&&<div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      {/* THE ORDER THE CLIENT'S NOTE DESCRIBES, and in their words:
            1. Select fabricator (Line or External) from the dropdown.
            2. Select article/style and enter quantity to issue.
            3. System generates an issue slip.
          The screen asked for the order first, which is the app's own way round
          rather than the factory's — you decide who is free before you decide
          what to give them. */}
      <div className="serif text-base font-semibold mb-2">1 · Select fabricator</div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Internal or external
          <select value={fabricator} aria-label="Send to" onChange={e=>{setFabricator(e.target.value);touched();}} className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56">
            <option value="">— choose —</option>
            {fabricators.filter(f=>f.active).map(f=><option key={f.name} value={f.name}>{optionLabel(f)}</option>)}
          </select>
        </label>
        {/* A new line or job worker turns up mid-shift, and the job order that
            prompted it is already half entered. Sending the user to Setup to
            add one would discard it, so it is added from here. */}
        <button type="button" onClick={()=>setAdding(adding?null:{name:"",type:"external",rate:"",contact_person:"",contact_phone:"",tat_days:""})}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white">
          {adding?"Cancel":"+ Add a fabricator"}</button>
        <label className="text-xs text-slate-600">Card date
          <input type="date" value={date} aria-label="Job card date"
            onChange={e=>{const v=e.target.value;setDate(v);if(!startPinned)setStartOn(v);touched();}}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/>
          <span className="block text-[10px] text-slate-400 mt-0.5">when the card is written</span>
        </label>
        <label className="text-xs text-slate-600">Work starts on
          <input type="date" value={startOn} aria-label="Work starts on" min={undefined}
            onChange={e=>{setStartOn(e.target.value);setStartPinned(true);touched();}}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm"/>
          <span className="block text-[10px] text-slate-400 mt-0.5">
            {startOn && startOn!==date ? "the plan schedules this batch from here" : "same as the card date"}</span>
        </label>
      </div>
      {adding&&<NewFabricator draft={adding} setDraft={setAdding}
        existing={fabricators}
        onSaved={async created=>{
          await reload();
          setFabricator(created.name); setAdding(null);
          setMsg(`${created.name} added. It is selected for this job order.`);
        }} onError={setErr} />}
      {who&&<div className="text-[11px] text-slate-600 mt-2">This raises a <b>{slipFor(who)}</b>. {who.payable?(who.rate>0?<>Payable at ₹{who.rate} per piece.</>:<>External rate/contact are still marked incomplete in Setup.</>):<>Internal work — nothing payable.</>}</div>}
    </div>

    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-2">2 · Select article and quantity to issue</div>
      <div className="flex gap-3 flex-wrap items-end">
        {/* Fills the card and no wider: sized to its longest option, the
            select ran past the card and pushed the whole page sideways. */}
        <label className="text-xs text-slate-600 w-full min-w-0">Article / style
          <select value={orderNo} aria-label="Current Order" onChange={e=>chooseOrder(e.target.value)} className="block mt-1 w-full max-w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" disabled={!who}>
            <option value="">{who?"— choose from Order Book —":"choose a fabricator first"}</option>
            {/* The PARTY and the DATE are on the row because two live orders
                for the same article are otherwise indistinguishable — "REX
                GOLA PLUS · 5,014 left" twice over reads as the same shoe
                listed twice rather than as two real orders. The party alone
                is not enough: Khandelwal School has TWO open Bolt orders, so
                the date is what separates those. */}
            {openOrders.map(row=><option key={row.order.order_no} value={row.order.order_no}>
              {row.order.order_no} · {row.order.article_code}{row.order.party?` · ${row.order.party}`:""}{row.order.order_date?` · ${shortDate(row.order.order_date)}`:""} · {fmt(row.remaining)} left
            </option>)}
          </select>
        </label>
      </div>
      {order&&<div className="mt-2 text-xs text-slate-600">Article <b>{order.article_code}</b> · Party <b>{order.party||"—"}</b> · <b>{fmt(balance.remaining)}</b> pairs still available for job orders.</div>}
      {/* STOCK FIRST. Said here, where the card is raised: an order still
          waiting for its decision cannot have a card, and one that uses ready
          stock is carded for the balance only. */}
      {awaiting&&<div role="alert" className="mt-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <b>{order.order_no} is waiting for its stock decision.</b> Ready stock matches this order. Open it in the Order Book and choose
        “Use selected stock” or “Ignore stock” first — until then it is not known how many pairs have to be made, so no job order can be raised.</div>}
      {stockDecided&&(()=>{ const a=allocationSummary(order); return <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <b>This order uses ready stock.</b> Of {fmt(a.ordered)} pairs ordered, {fmt(a.fg)} come from finished goods and are not made,
        {" "}{fmt(a.upper)} use uppers already in the upper store, and {fmt(a.produce)} are made in full.
        {a.upper>0&&<div className="mt-1.5 flex gap-4 flex-wrap">
          <label className="inline-flex items-center gap-1.5"><input type="radio" name="card-route" checked={!fromUppers}
            onChange={()=>chooseOrder(order.order_no,false)} aria-label="Card for the full routing"/>Full routing — from cutting</label>
          <label className="inline-flex items-center gap-1.5"><input type="radio" name="card-route" checked={fromUppers}
            onChange={()=>chooseOrder(order.order_no,true)} aria-label="Card starting at moulding from upper stock"/>
            From upper stock — starts at moulding ({fmt(upperBalance)} pairs left to card)</label>
        </div>}
        {fromUppers&&<div className="mt-1">Nothing is cut or stitched for this card. Issue the reserved uppers to moulding from the Upper store, against {order.order_no}.</div>}
      </div>; })()}
      {/* Work that went out and never came back. Shown as its own decision,
          never folded into the balance: the customer is still owed these, but
          somebody has to choose to make them again. */}
      {order&&toRemake>0&&<div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <label className="flex items-start gap-2 text-xs text-amber-900">
          <input type="checkbox" checked={remake} aria-label="Remake pairs lost to a shortage"
            onChange={e=>{setRemake(e.target.checked);touched();}} className="mt-0.5"/>
          <span>
            <b>{fmt(toRemake)} pair(s) were written off short</b> on an earlier job order for {order.order_no} —
            they went out and never came back, and the customer is still owed them.
            Tick this to raise a card that REMAKES them; the balance above stays as it is.
          </span>
        </label>
      </div>}
    </div>

    {order&&<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-1">3 · Enter the quantity size by size</div>
      <p className="text-xs text-slate-500 mb-3">Enter this job order size by size. Its printable document uses the supplied ARMOUR Job Card format.</p>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left py-1">Range</th><th className="text-right">Available</th><th className="text-left pl-4">This job card — pairs by size</th><th className="text-right">Total</th></tr></thead>
        <tbody>{balance.lines.map(line=>{
          const names=comboSizesForArticle(order.article_code,line.combo)||[];
          const hasExact=!!line.remaining_sizes&&names.length>0;
          return <tr key={line.combo} className="border-t border-slate-100"><td className="py-2 mono font-semibold">{line.combo}</td><td className="text-right mono text-slate-500">{fmt(line.remaining)}</td>
            <td className="pl-4 py-1">{hasExact?<div className="flex gap-2 flex-wrap">{names.map(size=><label key={size} className="text-[10px] text-slate-500">{size}<input type="number" min="0" max={line.remaining_sizes[size]||0} value={sizes[line.combo]?.[size]??0} aria-label={`${line.combo} size ${size} pairs`} onChange={e=>setSize(line.combo,size,e.target.value)} className="block w-16 border border-slate-300 rounded px-1 py-0.5 mono text-right text-xs"/></label>)}</div>
              :<input type="number" min="0" max={line.remaining} value={qty[line.combo]??0} aria-label={`Pairs of ${line.combo} on this card`} onChange={e=>setRange(line.combo,e.target.value)} className="w-24 border border-slate-300 rounded px-1.5 py-0.5 mono text-right"/>}</td>
            <td className="text-right mono font-semibold">{fmt(qty[line.combo]||0)}</td></tr>;
        })}</tbody><tfoot><tr className="border-t border-slate-200"><td className="py-2 font-semibold">TOTAL (PAIR)</td><td></td><td></td><td className="text-right mono font-semibold">{fmt(totalPairs)}</td></tr></tfoot>
      </table></div>
      {!!over.length&&<div className="mt-2 text-xs font-semibold text-rose-700">More than the unassigned balance was entered for {over.map(line=>line.combo).join(", ")}.</div>}
      {overTotal&&!over.length&&<div className="mt-2 text-xs font-semibold text-rose-700">
        This card totals {fmt(totalPairs)} pairs but only {fmt(cap)} can be issued
        {remake?" including the remake":""}.</div>}
      {!article&&<div className="mt-2 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5"><b>{order.article_code} has no BOM loaded</b>, so material rows will be blank until its BOM is loaded.</div>}
      {/* WHETHER THE STORE CAN COVER THIS CARD, BEFORE IT IS ISSUED.
          Issuing already books the materials OUT of the register; until now
          nothing said beforehand whether they were there to book. Same check
          the PI screen makes, so the two cannot give different answers. */}
      {/* An order whose stock has been DECIDED has already had its answer about
          the shelf — and the pairs it sees there may be the very ones reserved
          for it. Repeating "60 are in stock, supply from the shelf" under a
          card for the balance told the clerk to take them twice. The raw
          material check still runs. */}
      {/* A moulding-start card takes nothing for cutting or stitching. Where the
          BOM lists nothing from moulding on, that is an EMPTY list, not a
          missing BOM — and "no BOM rates on file" would say the opposite. */}
      {fromUppers&&lines.length>0&&(upperMoves===null
        ? <div className="mt-3 text-[11px] text-slate-500">Checking the upper store…</div>
        : uppersShort.length
          ? <div role="alert" className="mt-3 text-xs rounded-lg border-2 border-rose-300 bg-rose-50 text-rose-900 px-3 py-2">
              <b>Uppers are short in the upper store</b>{upperColour&&<> ({order.article_code} · {upperColour})</>}:{" "}
              {uppersShort.map(r=>`size ${r.size} — ${fmt(r.wanted)} wanted, ${fmt(Math.max(0,r.on_hand))} on the shelf`).join("; ")}.
              {" "}The job order can still be created; moulding cannot start on those pairs until the uppers are received.</div>
          : <div className="mt-3 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2">
              Uppers for every size on this card are in the upper store{upperColour&&<> ({upperColour})</>}.</div>)}
      {fromUppers&&article&&!Object.keys(materialTotals(lines,article)).length
        ? <div className="mt-3 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2">
            <b>No raw material is booked out for this card.</b> Its uppers are already made, and {order.article_code}'s BOM lists
            no material for moulding or packing. If the sole compound should be on the BOM, add it under Data &amp; BOM.</div>
        : <StockAtHand article={order&&order.article_code} lines={lines}
            jobs={order&&order.stock_status?[]:(jobs||[])} finishedMoves={order&&order.stock_status?[]:finishedMoves}/>}
      <div className="flex gap-2 items-center mt-3"><button onClick={generate} disabled={!ready} className="text-xs font-semibold text-white rounded-lg px-4 py-1.5 bg-indigo-600 disabled:opacity-50">{card?(stale?"Update the preview":"Preview again"):"Preview Job Order"}</button>{stale&&<span className="text-[11px] text-amber-800 font-semibold">Inputs changed — update the preview before creating.</span>}{!who&&<span className="text-[11px] text-slate-500">Choose Rex Internal or New Durga Line.</span>}</div>
    </div>}

    {card&&<div ref={cardBox} className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm"><div data-noprint className="flex items-center gap-2 flex-wrap mb-2"><div className="text-sm font-semibold text-slate-800">4 · Issue slip</div><span className="text-[11px] text-slate-500">The note's step 3: the system generates the issue slip. Receiving and payment are steps 4 and 5, in Job Orders Database.</span><button onClick={issue} disabled={busy||stale||!!card.card_no} className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800 disabled:opacity-40">{card.card_no?`Created as ${card.card_no}`:busy?"Creating…":"Confirm & Create Job Order"}</button><button onClick={print} disabled={stale} className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white disabled:opacity-40">Print / Save PDF</button></div><CardSwitch value={cardKind} onChange={setCardKind}/>{cardKind==="CUTTING"?<JobCard card={card} article={article}/>:<StageJobCard card={card} article={article} kind={cardKind}/>}</div>}
  </div>;
}

/* Adding a fabricator without leaving the job order.
   The SAME `RULES` object drives which fields appear and `validateFabricator`
   decides whether they are acceptable, so a field can never be demanded by the
   server and hidden by this form. */
function NewFabricator({ draft, setDraft, existing=[], onSaved, onError }){
  const [saving,setSaving]=useState(false);
  const rules=RULES[draft.type]||{};
  const set=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const clash=existing.some(f=>f.name.trim().toLowerCase()===draft.name.trim().toLowerCase());
  /* The field names are the SCHEMA's — contact_person and contact_phone, not a
     single "contact". validateFabricator reads those two, so a form with one
     combined box left "a contact is required" permanently unsatisfied and the
     Save button permanently disabled: an external fabricator could never be
     added at all. */
  const check=validateFabricator({...draft,rate:draft.rate===""?null:Number(draft.rate),
    tat_days:draft.tat_days===""?null:Number(draft.tat_days)});
  const problems=clash?["That name is already on the fabricator list"]:check.problems;

  async function save(){
    setSaving(true);
    try{
      const created=await api.saveFabricator({name:draft.name.trim(),type:draft.type,
        rate:draft.rate===""?null:Number(draft.rate),
        contact_person:draft.contact_person.trim()||null,
        contact_phone:draft.contact_phone.trim()||null,
        tat_days:draft.tat_days===""?null:Number(draft.tat_days)});
      await onSaved(created&&created.name?created:{...draft,name:draft.name.trim()});
    }catch(e){ onError(e.message||String(e)); }
    finally{ setSaving(false); }
  }

  return <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
    <div className="text-xs font-semibold text-slate-800 mb-2">New fabricator</div>
    <div className="flex gap-3 flex-wrap items-end">
      <label className="text-xs text-slate-600">Name
        <input value={draft.name} aria-label="Fabricator name" onChange={e=>set("name",e.target.value)}
          placeholder="e.g. New Durga Line"
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-56"/></label>
      <label className="text-xs text-slate-600">Type
        <select value={draft.type} aria-label="Fabricator type" onChange={e=>set("type",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
          {TYPES.map(t=><option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
      {rules.rate!=="none"&&<label className="text-xs text-slate-600">
        {rules.rate==="flat"?"Flat sample charge (₹)":"Rate per piece (₹)"}
        <input type="number" min="0" step="0.01" value={draft.rate} aria-label="Rate"
          onChange={e=>set("rate",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-40"/></label>}
      <label className="text-xs text-slate-600">Contact person{rules.contact==="required"?"":" (optional)"}
        <input value={draft.contact_person} aria-label="Contact person"
          onChange={e=>set("contact_person",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-44"/></label>
      <label className="text-xs text-slate-600">Phone{rules.contact==="required"?"":" (optional)"}
        <input value={draft.contact_phone} aria-label="Contact phone" inputMode="tel"
          onChange={e=>set("contact_phone",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-40"/></label>
      <label className="text-xs text-slate-600">Turnaround (days)
        <input type="number" min="0" value={draft.tat_days} aria-label="Turnaround days"
          onChange={e=>set("tat_days",e.target.value)}
          className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm w-32"/></label>
    </div>
    <div className="text-[11px] text-slate-500 mt-2">{TYPE_HELP[draft.type]}</div>
    {!!problems.length&&draft.name&&<ul className="text-[11px] text-rose-700 mt-2 list-disc pl-4">
      {problems.map(p=><li key={p}>{p}</li>)}</ul>}
    <button onClick={save} disabled={saving||!!problems.length||!draft.name.trim()}
      className="mt-2 text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-indigo-600 disabled:opacity-50">
      {saving?"Saving…":"Save fabricator"}</button>
  </div>;
}

/* Printing opens a clean window holding only the document on screen — the
   invoice's mechanism. Shared with the Job Orders Database's reprint, so a
   card printed again later comes out exactly as it did the first time.
   It looks INSIDE the box it is given: this screen stays mounted behind the
   others, so a page-wide querySelector could print a hidden draft in place of
   the card actually on screen. */
export function printJobCard(box,onError){
  const node=box&&box.querySelector(".job-card");
  if(!node)return;
  const w=window.open("","_blank","width=900,height=1000");
  if(!w){onError("Popup blocked — allow popups to print the job card.");return;}
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Job card</title><style>*{box-sizing:border-box}body{margin:0;padding:12mm;font-family:Arial,Helvetica,sans-serif;color:#000}table{width:100%;border-collapse:collapse}[data-noprint]{display:none!important}.job-card-page{page-break-after:always}.job-card-page:last-child{page-break-after:auto}@page{size:A4 portrait;margin:10mm}</style></head><body>${node.outerHTML}<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
  w.document.close();
}

/* The three printable documents of one job order. The pasting and packing
   cards follow the factory's own PASTING JC / PACKING JC formats; the cutting
   card is the ARMOUR one already in use. Printing takes whichever is shown. */
export function CardSwitch({value,onChange}){
  const kinds=[{kind:"CUTTING",title:"Cutting & stitching"},...cardKinds().map(k=>({kind:k.kind,title:k.title==="PACKING JC"?"Packing":"Pasting"}))];
  return <div data-noprint className="flex items-center gap-1 mb-2">
    <span className="text-[11px] text-slate-500 mr-1">Card:</span>
    {kinds.map(k=><button key={k.kind} type="button" onClick={()=>onChange(k.kind)}
      className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${value===k.kind?"bg-slate-800 text-white border-slate-800":"bg-white text-slate-700 border-slate-300"}`}>
      {k.title}</button>)}
  </div>;
}
