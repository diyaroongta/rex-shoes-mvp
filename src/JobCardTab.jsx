import React, { useEffect, useMemo, useState } from "react";
import * as api from "./lib/client.js";
import { REF as INPUTS } from "./lib/refdata.js";
import JobCard from "./JobCard.jsx";
import { slipFor } from "../shared/job-work.js";
import { comboSizesForArticle } from "../shared/bridge.js";

/* Job cards — the same three-step shape as PI generation, because it is the
 * same kind of job: something is read out of the system, a person CHECKS and
 * CORRECTS it, and only then is the document raised.
 *
 *   1  choose      which production order, and who is doing the work
 *   2  check       size by size, editable — this is where mistakes are caught
 *   3  confirm     generate the card, then issue it
 *
 * The card is not raised from step 2's values until Generate is pressed, and
 * editing after that marks the preview stale — exactly as the PI does. A
 * document that quietly drifts from the numbers on screen is worse than one
 * that refuses to print.
 */

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN");

export default function JobCardTab({ orders = [] }){
  const [fabricators, setFabricators] = useState(null);
  const [orderNo, setOrderNo] = useState("");
  const [fabricator, setFabricator] = useState("");
  const [stage, setStage] = useState("CUTTING & STITCHING");
  const [qty, setQty] = useState({});          // combo -> pairs for this run
  const [sizes, setSizes] = useState({});      // combo -> { size: pairs }
  const [card, setCard] = useState(null);      // the generated preview
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(()=>{ (async()=>{
    try{ setFabricators(await api.listFabricators()); }
    catch(e){ setErr(e.message||String(e)); setFabricators([]); }
  })(); },[]);

  const order = orders.find(o => o.order_no === orderNo) || null;
  const article = order ? (INPUTS.articles||{})[order.article_code] : null;
  const who = (fabricators||[]).find(f => f.name === fabricator) || null;

  /* Choosing an order seeds the run with everything on it — the common case is
     the whole order — and the clerk cuts it down. */
  function chooseOrder(no){
    setOrderNo(no); setCard(null); setStale(false); setErr(""); setMsg("");
    const o = orders.find(x => x.order_no === no);
    if(!o){ setQty({}); setSizes({}); return; }
    const q = {}, s = {};
    for(const l of o.lines || []){
      q[l.combo] = Number(l.qty) || 0;
      if(l.sizes && Object.keys(l.sizes).length) s[l.combo] = { ...l.sizes };
    }
    setQty(q); setSizes(s);
  }

  const lines = useMemo(() => Object.entries(qty)
    .filter(([,v]) => Number(v) > 0)
    .map(([combo, v]) => ({
      combo, qty: Number(v),
      sizes: sizes[combo],
      size_order: order ? comboSizesForArticle(order.article_code, combo) : [],
    })), [qty, sizes, order]);

  const totalPairs = lines.reduce((a,l) => a + l.qty, 0);
  const ready = !!order && !!who && totalPairs > 0;

  const touch = fn => (...args) => { fn(...args); if(card) setStale(true); };

  function generate(){
    if(!ready) return;
    setCard({
      article: order.article_code,
      order_no: order.order_no,
      fabricator: who.name,
      slip: `JOB CARD — ${slipFor(who)}`,
      stage,
      date: new Date().toISOString().slice(0,10),
      card_no: "",                 // allocated when it is issued
      lines,
    });
    setStale(false); setMsg("");
  }

  /* Issuing is what makes it real: it creates the job work record, which is
     what gives the card its number and puts the pairs into that fabricator's
     bucket. Until then this is a preview. */
  async function issue(){
    setBusy(true); setErr(""); setMsg("");
    try{
      const made = await api.issueJobWork({
        fabricator: who.name, article: order.article_code, qty: totalPairs,
        stage: "STITCHING", order_no: order.order_no,
        note: `Job card for ${order.order_no}`,
      });
      setCard(c => ({ ...c, card_no: String(made.id) }));
      setMsg(`Job card ${made.id} issued to ${made.fabricator} for ${fmt(made.qty)} pairs.`);
    }catch(e){ setErr(e.message||String(e)); }
    finally{ setBusy(false); }
  }

  function print(){
    const node = document.querySelector(".job-card");
    if(!node) return;
    const w = window.open("","_blank","width=900,height=1000");
    if(!w){ setErr("Popup blocked — allow popups to print the job card."); return; }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Job card</title>`
      + `<style>*{box-sizing:border-box}body{margin:0;padding:12mm;font-family:Arial,Helvetica,sans-serif;color:#000}`
      + `table{width:100%;border-collapse:collapse}[data-noprint]{display:none!important}`
      + `@page{size:A4 portrait;margin:10mm}</style></head><body>${node.outerHTML}`
      + `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`);
    w.document.close();
  }

  if(fabricators === null) return <div className="p-5 text-sm text-slate-500">Loading…</div>;

  return <div className="p-4 md:p-5">
    {msg && <div role="status" className="mb-3 text-xs rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
    {err && <div role="alert" className="mb-3 text-xs rounded-lg bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2">{err}</div>}

    {/* 1 — CHOOSE */}
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-2">1 · Choose the work</div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-xs text-slate-600">Production order
          <select value={orderNo} aria-label="Production order"
            onChange={e=>chooseOrder(e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-52">
            <option value="">— choose —</option>
            {orders.map(o => <option key={o.order_no} value={o.order_no}>
              {o.order_no} · {o.article_code} · {fmt(o.qty)} pr</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Send to
          <select value={fabricator} aria-label="Send to"
            onChange={touch(e=>setFabricator(e.target.value))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm min-w-52">
            <option value="">— choose a line or fabricator —</option>
            {fabricators.filter(f=>f.active).map(f =>
              <option key={f.name} value={f.name}>{f.name}</option>)}
          </select></label>

        <label className="text-xs text-slate-600">Stage
          <input value={stage} aria-label="Stage" onChange={touch(e=>setStage(e.target.value))}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm" /></label>
      </div>
      {who && <div className="text-[11px] text-slate-600 mt-2">
        This raises a <b>{slipFor(who)}</b>.{" "}
        {who.payable ? <>Payable at ₹{who.rate}{who.type==="sample"?" flat":" per piece"}.</>
                     : <>Internal line — nothing payable.</>}</div>}
    </div>

    {/* 2 — CHECK. Editable, and the card follows it. */}
    {order && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-3">
      <div className="serif text-base font-semibold mb-1">2 · Check the quantities</div>
      <p className="text-xs text-slate-500 mb-3">
        Everything below is editable and the card follows it. Cut a run down by lowering a
        figure, or set it to 0 to leave that range out.
      </p>
      <table className="w-full text-xs">
        <thead className="text-slate-500"><tr>
          <th className="text-left py-1">Size range</th>
          <th className="text-right">On the order</th>
          <th className="text-right">This run</th>
          <th className="text-left pl-4">Sizes</th>
        </tr></thead>
        <tbody>
          {(order.lines||[]).map(l => (
            <tr key={l.combo} className="border-t border-slate-100">
              <td className="py-1.5 mono font-semibold">{l.combo}</td>
              <td className="text-right mono text-slate-500">{fmt(l.qty)}</td>
              <td className="text-right">
                <input type="number" min="0" max={l.qty} value={qty[l.combo] ?? 0}
                  aria-label={`Pairs of ${l.combo} on this card`}
                  onChange={touch(e=>setQty(q=>({...q,[l.combo]:e.target.value})))}
                  className="w-24 border border-slate-300 rounded px-1.5 py-0.5 mono text-right" /></td>
              <td className="pl-4 mono text-slate-400" style={{fontSize:10.5}}>
                {(comboSizesForArticle(order.article_code, l.combo)||[]).join("  ")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-slate-200">
          <td className="py-1.5 font-semibold">Total</td><td></td>
          <td className="text-right mono font-semibold">{fmt(totalPairs)}</td><td></td>
        </tr></tfoot>
      </table>

      {!article && <div className="mt-2 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5">
        <b>{order.article_code} has no BOM loaded</b>, so the card will have nothing to issue.
        Load it under Data &amp; BOM first.
      </div>}

      <div className="flex gap-2 items-center mt-3">
        <button onClick={generate} disabled={!ready}
          className="text-xs font-semibold text-white rounded-lg px-4 py-1.5 bg-indigo-600 disabled:opacity-50">
          {card ? (stale ? "Regenerate with these edits" : "Generate again") : "Generate the job card"}
        </button>
        {stale && <span className="text-[11px] text-amber-800 font-semibold">
          Edited since the card was made — regenerate before issuing.</span>}
        {!who && <span className="text-[11px] text-slate-500">Choose who the work is going to.</span>}
      </div>
    </div>}

    {/* 3 — CONFIRM */}
    {card && <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
      <div data-noprint className="flex items-center gap-2 flex-wrap mb-2">
        <div className="text-sm font-semibold text-slate-800">3 · Confirm and issue</div>
        <button onClick={issue} disabled={busy || stale || !!card.card_no}
          className="ml-auto text-xs font-semibold text-white rounded-lg px-3 py-1.5 bg-slate-800 disabled:opacity-40">
          {card.card_no ? `Issued as ${card.card_no}` : busy ? "Issuing…" : "Issue this job card"}
        </button>
        <button onClick={print} disabled={stale}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white disabled:opacity-40">
          Print / Save PDF</button>
      </div>
      <JobCard card={card} article={article} />
    </div>}
  </div>;
}
