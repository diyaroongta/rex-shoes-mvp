import React, { useMemo, useState } from "react";
import { statusBoard } from "../shared/stage-status.js";
import { fyWeek } from "../shared/fy-calendar.js";

/* WHERE THE WORK IS. Two claims, kept apart on purpose: the plan's forecast,
   and the movements somebody actually recorded. A card drawn from a recorded
   movement is marked as such; one drawn from the plan says "planned" in as
   many words, because a board that quietly mixes the two reports work as
   moulding that is still sitting in cutting. */

const fmt = n => (n==null||isNaN(n)) ? "0" : Number(n).toLocaleString("en-IN");
const nice = iso => !iso ? "—"
  : new Date(iso+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"});

const STAGE_LABEL = {CUTTING:"Cutting",PREPARATION:"Preparation",STITCHING:"Stitching",
  UPPER_QC:"Upper QC",MOLDING:"Moulding",ASSEMBLY:"Assembly",PACKING:"Packing",DISPATCH:"Dispatch"};
const SLA_COLOR = {on_track:"#047857",at_risk:"#b45309",breach:"#b91c1c"};

export default function StatusTab({ state, jobs = [], dispatches = [] }){
  const [level, setLevel] = useState("units");     // job cards, or whole orders
  const [onlyBehind, setOnlyBehind] = useState(false);
  const today = new Date().toISOString().slice(0,10);
  const week = fyWeek(today);

  const rows = level === "units" && (state.units||[]).length ? state.units : state.orders;
  const board = useMemo(
    ()=>statusBoard(rows.filter(r=>!r.article_missing), { today, jobs, dispatches }),
    [rows, jobs, dispatches, today]);

  const shown = onlyBehind ? board.rows.filter(r=>r.behind) : board.rows;
  const columns = board.columns
    .map(c=>({ ...c, rows: c.rows.filter(r=>shown.includes(r)) }));

  return <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="flex items-center gap-3 flex-wrap mb-2">
      <div className="text-sm font-semibold text-slate-700">
        Production status · {nice(today)} {week && <span className="text-slate-400 mono">{week.label}</span>}
      </div>
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
        {[["units","Job cards"],["orders","Orders"]].map(([key,label])=>(
          <button key={key} onClick={()=>setLevel(key)}
            className={`px-2.5 py-1 font-semibold ${level===key?"bg-indigo-600 text-white":"bg-white text-slate-600"}`}>
            {label}</button>))}
      </div>
      <label className="text-xs text-slate-600 flex items-center gap-1.5">
        <input type="checkbox" checked={onlyBehind} onChange={e=>setOnlyBehind(e.target.checked)} />
        Only work behind the plan</label>
    </div>

    {/* What this board is and is not. The distinction is the feature. */}
    <div className="text-xs text-slate-500 mb-3 leading-relaxed">
      A card sits in the stage of its <b>last recorded movement</b> — a job card issued, work received
      back, a dispatch keyed in. Work nobody has keyed yet sits where the <b>plan</b> expects it and is
      marked <span className="rounded px-1 mono" style={{fontSize:10,background:"#f1f5f9",color:"#64748b"}}>planned</span>,
      because that is a forecast, not a report from the floor.
    </div>

    <div className="flex gap-3 flex-wrap mb-3 text-xs">
      <Count label="on the board" value={board.counts.total} />
      <Count label="with a recorded movement" value={board.counts.recorded} tone="#065f46" />
      <Count label="never keyed in" value={board.counts.nothing_recorded} tone="#92400e" />
      <Count label="behind the plan" value={board.counts.behind} tone="#b91c1c" />
    </div>

    <div className="overflow-x-auto">
      <div className="flex gap-2" style={{minWidth:900}}>
        {columns.map(col=>(
          <div key={col.stage} className="flex-1" style={{minWidth:120}}>
            <div className="text-xs font-semibold text-slate-600 border-b border-slate-200 pb-1 mb-2">
              {STAGE_LABEL[col.stage]||col.stage}
              <span className="mono text-slate-400 ml-1">{col.rows.length||""}</span>
            </div>
            {!col.rows.length && <div className="text-xs text-slate-300">—</div>}
            {col.rows.map(r=>(
              <div key={r.unit_key} className="rounded-lg border p-2 mb-2"
                style={{borderColor:r.behind?"#fecaca":"#e2e8f0",background:r.behind?"#fff7f7":"#fff"}}>
                <div className="mono text-xs text-slate-800">{r.order_no}</div>
                {r.card_no && <div className="mono text-[10px] text-slate-500">card {r.card_no}</div>}
                {r.unit_kind==="balance" && <div className="text-[10px] text-amber-700">no card yet</div>}
                <div className="text-[11px] text-slate-500 truncate" title={r.article}>{r.article}</div>
                <div className="mono text-[11px] text-slate-700">{fmt(r.qty)} pairs</div>
                {r.column_is_recorded
                  ? <div className="text-[10px] text-slate-600 mt-1">
                      {r.recorded.last.detail}<br/>
                      <span className="text-slate-400">{nice(r.recorded.on)}</span>
                    </div>
                  : <div className="text-[10px] mt-1">
                      <span className="rounded px-1 mono" style={{background:"#f1f5f9",color:"#64748b"}}>planned</span>
                      <span className="text-slate-400"> {r.planned.phase==="not_started"
                        ? `starts ${nice(r.planned.until)}` : `to ${nice(r.planned.until)}`}</span>
                    </div>}
                {r.behind && <div className="text-[10px] text-rose-700 mt-1">
                  plan says {STAGE_LABEL[r.planned.stage]||r.planned.stage}</div>}
                <div className="text-[10px] mt-1" style={{color:SLA_COLOR[r.sla]||"#64748b"}}>
                  dispatch {nice(r.dispatch_date)}</div>
              </div>))}
          </div>))}
      </div>
    </div>
  </div>;
}

function Count({label,value,tone="#475569"}){
  return <span className="rounded-lg border border-slate-200 px-2 py-1">
    <b className="mono" style={{color:tone}}>{fmt(value)}</b> <span className="text-slate-500">{label}</span>
  </span>;
}
