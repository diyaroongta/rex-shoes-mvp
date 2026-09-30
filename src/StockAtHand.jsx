import React from "react";
import { materialCheck } from "../shared/can-we-make-it.js";
import { onHandFor } from "../shared/finished-goods.js";
import { REF as INPUTS } from "./lib/refdata.js";

const fmt = (n,d=0)=>n==null||isNaN(n)?"—":Number(n).toLocaleString("en-IN",{maximumFractionDigits:d});

/* CAN WE MAKE IT, ASKED WHILE THERE IS STILL A CHOICE.
   The answer only existed after the order was saved, on the procurement
   screen — one commitment too late. It is the same register balance and the
   same BOM those screens use, so it cannot disagree with them.
   It says MATERIALS, in those words: this system holds no finished-goods
   stock, so it cannot claim there are pairs already on a shelf. */
export default function StockAtHand({ article, lines, jobs = [] }){
  const check = React.useMemo(
    () => materialCheck(lines, (INPUTS.articles||{})[article],
                        INPUTS.materials||{}, INPUTS.stock_meta||{}),
    [article, lines]);
  const pairs = (lines||[]).reduce((a,l)=>a+(Number(l.qty)||0),0);
  /* ALREADY MADE, NOT JUST BUYABLE. Pairs of this very article that came back
     on a job card raised for STOCK — the factory's own shoes, not a
     customer's. "None recorded" is shown as nothing at all rather than as a
     zero, because the two are different answers. */
  const onHand = React.useMemo(()=>onHandFor(jobs||[], article), [jobs, article]);
  if(!pairs) return null;

  if(!check.costed) return <>
    {madeAlready}
    <div className="mt-3 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
      <b>No BOM rates on file for {article}.</b> Nothing can be checked against the store, and this
      article will ask for no material at all when it is planned.
    </div></>;

  const madeAlready = onHand && onHand.pairs>0
    ? <div className="mt-2 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2">
        <b>{fmt(onHand.pairs)} pairs of {article} are already made</b> and sitting in finished stock
        {onHand.size_list.length>0 && <> — {onHand.size_list.map(s=>`${s.size}: ${fmt(s.pairs)}`).join(", ")}</>}.
        {" "}Check whether any of this order can come out of it before more is made.
      </div>
    : null;

  const tone = check.can_make ? {b:"#a7f3d0",bg:"#ecfdf5",fg:"#065f46"} : {b:"#fed7aa",bg:"#fff7ed",fg:"#9a3412"};
  return <>{madeAlready}<details className="mt-3 rounded-lg border px-3 py-2" style={{borderColor:tone.b,background:tone.bg}}>
    <summary className="text-xs font-semibold cursor-pointer" style={{color:tone.fg}}>
      {check.can_make
        ? `Materials for these ${fmt(pairs)} pairs are in the store`
        : `${check.short_count+check.unknown_count} of ${check.materials} materials short for these ${fmt(pairs)} pairs`}
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

