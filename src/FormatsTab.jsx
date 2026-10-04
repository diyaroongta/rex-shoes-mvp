import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { REF as INPUTS } from "./lib/refdata.js";
import { todayIso } from "./lib/today.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { finishedStock, mtoStock } from "../shared/finished-stock.js";
import { stockSheetRows } from "../shared/stock-upload.js";
import { planningSheet, mtsStockSheet, mtsOpeningSheet, mtoStockSheet, packingReportSheet,
         jobCardSheet } from "../shared/formats.js";
import { stockRows } from "./StockTab.jsx";
import { articleSizes } from "./FinishedGoodsTab.jsx";

const fmt = (n,d=0) => (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:d});
const plus = (iso,n) => { const d=new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const mondayOf = iso => { const d=new Date(iso+"T00:00:00Z"); return plus(iso, -((d.getUTCDay()+6)%7)); };

function save(rows, sheet, file, cols){
  const ws=XLSX.utils.aoa_to_sheet(rows);
  if(cols) ws["!cols"]=cols.map(w=>({wch:w}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,sheet);
  XLSX.writeFile(wb,file);
}

/* FORMATS & SHEETS — every sheet the factory keeps on paper or in Excel,
   produced from the live system so nobody re-keys what is already known.
   Columns the system cannot know (a physical count, achieved pairs, cartons)
   are left blank for the floor; the ones with an upload say where it goes. */
export default function FormatsTab({ state, orders = [], jobs = [], moves = [], actuals = [], calendar = null, dispatches = [] }){
  const today = todayIso();
  const [week,setWeek]=useState(()=>mondayOf(today));
  const [orderNo,setOrderNo]=useState("");
  const [jobId,setJobId]=useState("");
  const stock = useMemo(()=>finishedStock(moves, jobs), [moves, jobs]);
  const order = (state.orders||[]).find(o=>o.order_no===orderNo);
  const job = (jobs||[]).find(j=>String(j.id)===String(jobId));

  const Card = ({title, children, note}) => <div className="rounded-xl border border-slate-200 p-3.5">
    <div className="text-sm font-semibold text-slate-800">{title}</div>
    {note && <div className="text-xs text-slate-500 mt-0.5 mb-2">{note}</div>}
    <div className="flex gap-2 flex-wrap items-end">{children}</div>
  </div>;
  const Btn = ({onClick, children, disabled}) => <button disabled={disabled} onClick={onClick}
    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{children}</button>;

  return <div className="space-y-4">
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-800 mb-1">Formats &amp; sheets</div>
      <p className="text-xs text-slate-500 mb-4">Each sheet is filled from the system as it stands now. Blank columns are for the floor to fill.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="1 · Production planning sheet" note="Machine by machine, day by day, for one Monday–Saturday week. Sundays and holidays are marked shut. Fill Achieved pairs on Daily plan vs achievement.">
          <label className="text-xs text-slate-600">Week starting
            <input type="date" value={week} onChange={e=>setWeek(mondayOf(e.target.value))} className="block mt-0.5 border border-slate-300 rounded px-2 py-1 mono text-xs"/></label>
          <Btn onClick={()=>save(planningSheet(state, INPUTS.origin, week, plus(week,6), INPUTS.workcenters, calendar),
            "Production Plan", `production-planning-${week}.xlsx`, [11,5,24,13,10,10,20,26,16,13,13,24])}>Download</Btn>
        </Card>

        <Card title="2 · MTS stock sheet" note="Finished stock made for the shelf, size by size, with a blank physical-count column. Upload it on Dispatch → Finished goods → Enter stock.">
          <Btn onClick={()=>save(mtsStockSheet(stock, articleSizes, today), "MTS Stock", `mts-stock-${today}.xlsx`, [34,8,11,14,8,9,11,24])}>Download current stock</Btn>
          <Btn onClick={()=>save(mtsOpeningSheet(Object.keys(INPUTS.articles||{}).sort(), articleSizes, today), "MTS Stock", `mts-opening-count-${today}.xlsx`, [34,8,11,14,8,9,11,24])}>Blank opening count</Btn>
        </Card>

        <Card title="3 · MTO stock sheet" note="Customer (MTO) orders: ordered, packed, shipped, and boxed pairs ready to ship.">
          <Btn onClick={()=>save(mtoStockSheet(mtoStock(state.orders||[], actuals, dispatches)), "MTO Stock", `mto-stock-${today}.xlsx`, [10,22,30,10,10,10,13,13])}>Download</Btn>
        </Card>

        <Card title="4 · Packing report sheet" note="For one order, filled from the order's own sizes (what is still owed). Cartons and C/N are counted, so they are blank.">
          <label className="text-xs text-slate-600">Order
            <select value={orderNo} onChange={e=>setOrderNo(e.target.value)} aria-label="Order for the packing sheet"
              className="block mt-0.5 border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[16rem]">
              <option value="">Choose…</option>
              {(state.orders||[]).map(o=><option key={o.order_no} value={o.order_no}>{o.order_no} · {o.party} · {o.article}</option>)}</select></label>
          <Btn disabled={!order} onClick={()=>save(packingReportSheet(order, c=>comboSizesForArticle(order.article_code,c,(order.pi||{}).vl),
            dispatches.filter(d=>d.order_no===order.order_no)), "Packing List", `packing-report-${order.order_no}.xlsx`, [6,30,10,14,10,7,8,16,8])}>Download</Btn>
        </Card>

        <Card title="5 · Raw material stock sheet (weekly)" note="The stock master with book figures. Count the store each week, enter the totals, and upload it on Stock → View Stock → Upload.">
          <Btn onClick={()=>{
            const ws=XLSX.utils.aoa_to_sheet(stockSheetRows(stockRows()));
            ws["!cols"]=[{wch:6},{hidden:true},{wch:18},{wch:38},{wch:12},{wch:10},{wch:15},{wch:16},{wch:14},{wch:14},{wch:13},{wch:10},{wch:16},{wch:12},{wch:16}];
            const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"STOCK MASTER");
            XLSX.writeFile(wb,`raw-material-stock-week-${mondayOf(today)}.xlsx`);
          }}>Download</Btn>
        </Card>

        <Card title="6 · Raw material purchase orders" note="Raised, numbered and tracked on Procurement → Purchase orders, straight from the buying list.">
          <span className="text-xs text-slate-500">Open <b>Procurement</b> to create or print a PO.</span>
        </Card>

        <Card title="7 · Production / packing job card" note="A job card as issued, with received, rejected, repair and cartons columns — filled from what Daily plan vs achievement has recorded. The printable two-page card is in Job Orders Database.">
          <label className="text-xs text-slate-600">Job card
            <select value={jobId} onChange={e=>setJobId(e.target.value)} aria-label="Job card"
              className="block mt-0.5 border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[16rem]">
              <option value="">Choose…</option>
              {(jobs||[]).filter(j=>!j.cancelled).map(j=><option key={j.id} value={j.id}>{(j.card&&j.card.card_no)||`#${j.id}`} · {j.order_no||"stock"} · {j.article}</option>)}</select></label>
          <Btn disabled={!job} onClick={()=>{
            const card=(job.card&&job.card.card_no)||"";
            const recorded=(actuals||[]).filter(a=>a.order_no===job.order_no&&(!card||a.job_card_no===card));
            save(jobCardSheet(job, recorded), "Job Card", `job-card-${card||job.id}.xlsx`, [12,8,10,10,10,10,10,24]);
          }}>Download</Btn>
        </Card>
      </div>
    </div>
  </div>;
}
