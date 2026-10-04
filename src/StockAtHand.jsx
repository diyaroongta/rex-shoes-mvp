import React from "react";
import { materialCheck } from "../shared/can-we-make-it.js";
import { finishedStock, stockForOrder } from "../shared/finished-stock.js";
import { comboSizesForArticle } from "../shared/bridge.js";
import { REF as INPUTS } from "./lib/refdata.js";

const fmt = (n,d=0)=>n==null||isNaN(n)?"—":Number(n).toLocaleString("en-IN",{maximumFractionDigits:d});

/* CAN WE MAKE IT — AND IS IT ALREADY MADE? Asked while there is still a choice,
   on the PI and on the job order, BEFORE a duplicate job card is written.

   1. FINISHED STOCK, SIZE BY SIZE. Pairs of this article already on the shelf
      (opening stock, MTS orders moved to stock, stock job cards that came back),
      matched against the sizes being ordered. Shown first and in full, because
      making a pair that is already boxed is the costliest mistake on this screen.
   2. RAW MATERIAL, against the same register and BOM procurement uses.

   This component used to crash the whole PI screen for any article with no BOM
   (REX GOLA PLUS among them): the no-BOM branch rendered `madeAlready` before
   the line that declared it. Both answers are now computed before either is
   rendered. */
export default function StockAtHand({ article, lines, jobs = [], finishedMoves = [] }){
  const check = React.useMemo(
    () => materialCheck(lines, (INPUTS.articles||{})[article],
                        INPUTS.materials||{}, INPUTS.stock_meta||{}),
    [article, lines]);
  const pairs = (lines||[]).reduce((a,l)=>a+(Number(l.qty)||0),0);
  const stock = React.useMemo(()=>finishedStock(finishedMoves||[], jobs||[]), [finishedMoves, jobs]);
  const vl = ((lines||[])[0]||{}).vl;
  const onHand = React.useMemo(
    ()=>stockForOrder(stock, article, lines, combo=>comboSizesForArticle(article, combo, vl)),
    [stock, article, lines, vl]);
  if(!pairs) return null;

  const madeAlready = onHand.any
    ? <div role="alert" className="mt-3 text-xs rounded-lg border-2 border-emerald-400 bg-emerald-50 text-emerald-900 px-3 py-2">
        <b>Already in finished stock — check before issuing a job card.</b>{" "}
        {onHand.wanted>0
          ? <>{fmt(onHand.covered)} of the {fmt(onHand.wanted)} pairs ordered can come straight off the shelf.</>
          : <>Sizes in this range are on the shelf.</>}
        <table className="mt-1.5 text-[11px]"><thead><tr className="text-emerald-800/70">
          <th className="text-left pr-4">Size</th><th className="text-right pr-4">Ordered</th>
          <th className="text-right pr-4">In stock</th><th className="text-right">Can supply</th></tr></thead>
          <tbody>{onHand.sizes.map(s=><tr key={s.size}>
            <td className="mono pr-4">{s.size}</td>
            <td className="mono text-right pr-4">{s.wanted==null?"range":fmt(s.wanted)}</td>
            <td className="mono text-right pr-4">{fmt(s.on_hand)}</td>
            <td className="mono text-right font-semibold">{s.cover==null?"—":fmt(s.cover)}</td></tr>)}</tbody></table>
        <div className="mt-1 text-emerald-800/80">
          Supply these from stock (Dispatch → Finished goods → issue to the order) and raise a job card only for the balance,
          so the same pairs are not made twice.</div>
      </div>
    : null;

  if(!check.costed) return <>
    {madeAlready}
    <div className="mt-3 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
      <b>Raw material: no BOM rates on file for {article}.</b> Nothing can be checked against the store, and this
      article will ask for no material at all when it is planned. Add its BOM (Data &amp; BOM, or Packing &amp; BOM rules → add a size range).
    </div></>;

  const tone = check.can_make ? {b:"#a7f3d0",bg:"#ecfdf5",fg:"#065f46"} : {b:"#fed7aa",bg:"#fff7ed",fg:"#9a3412"};
  return <>{madeAlready}<details open={!check.can_make} className="mt-3 rounded-lg border px-3 py-2" style={{borderColor:tone.b,background:tone.bg}}>
    <summary className="text-xs font-semibold cursor-pointer" style={{color:tone.fg}}>
      {check.can_make
        ? `Raw material: everything for these ${fmt(pairs)} pairs is in the store`
        : `Raw material: ${check.short_count+check.unknown_count} of ${check.materials} materials short for these ${fmt(pairs)} pairs`}
    </summary>
    <div className="text-[11px] mt-2" style={{color:tone.fg}}>
      Against the stock register as it stands. It does not set anything aside, and it does not
      count what other live orders have already claimed — <b>Procurement</b> answers that in order.
    </div>
    {!!check.short.length && <table className="w-full text-[11px] mt-2">
      <thead><tr className="text-slate-500"><th className="text-left py-1">Material</th>
        <th className="text-right">Needs</th><th className="text-right">In store</th><th className="text-right">Short</th></tr></thead>
      <tbody>{check.short.slice(0,8).map(r=>(
        <tr key={r.key} className="border-t border-white/60">
          <td className="py-1">{r.name}</td>
          <td className="text-right mono">{fmt(r.required,2)} {r.uom}</td>
          <td className="text-right mono">{fmt(r.available,2)}</td>
          <td className="text-right mono font-semibold">{fmt(r.shortfall,2)}</td>
        </tr>))}</tbody>
    </table>}
    {check.short.length>8 && <div className="text-[11px] mt-1" style={{color:tone.fg}}>…and {check.short.length-8} more.</div>}
    {!!check.unknown.length && <div className="text-[11px] mt-2" style={{color:tone.fg}}>
      Not on the material master, so their stock is unknown rather than nil:{" "}
      <b>{check.unknown.map(r=>r.name).join(", ")}</b>.
    </div>}
  </details></>;
}
