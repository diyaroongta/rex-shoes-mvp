import React, { useEffect, useState } from "react";
import * as api from "./lib/client.js";

const fmt = n => n == null || isNaN(n) ? "0" : Number(n).toLocaleString("en-IN");

/* THE DISPATCH REMINDER. Shown on every packing report of an order until the
 * stock has gone out or been released.
 *
 *   RESERVED  finished goods held for this order by its stock decision. They
 *             are waiting to leave with it, so they are TICKED by default and
 *             go out of stock when the report is recorded.
 *   FREE      finished goods that match the order's article and sizes but are
 *             not reserved — the planner chose "ignore stock", or the pairs
 *             arrived later. A reminder only: nothing is ticked.
 *
 * `leaving` is {size: pairs} on the report being drafted; pairs from stock can
 * never be more than are leaving. `value` / `onChange` carry {size: pairs} to
 * ship from stock.
 */
export default function DispatchStockReminder({ orderNo, leaving = {}, value = {}, onChange }){
  const [check, setCheck] = useState(null);

  useEffect(() => {
    let live = true;
    setCheck(null);
    Promise.resolve().then(() => api.getStockCheck(orderNo)).then(c => {
      if(!live) return;
      setCheck(c);
      const reserved = ((c && c.prefill && c.prefill.reserved) || []);
      if(reserved.length) onChange(Object.fromEntries(reserved.map(r => [r.size, r.pairs])));
    }).catch(() => { /* no reminder is better than a blocked dispatch */ });
    return () => { live = false; };
  }, [orderNo]);

  const pre = check && check.prefill;
  if(!pre || (!pre.reserved_pairs && !pre.free_pairs)) return null;
  const reserved = pre.reserved_pairs > 0;
  const rows = reserved ? pre.reserved : pre.free;
  const toggle = (size, pairs, on) => {
    const next = { ...value };
    if(on) next[size] = pairs; else delete next[size];
    onChange(next);
  };

  return <div role="note" aria-label="Ready stock for this order"
    className="mb-3 rounded-lg border-2 px-3 py-2 text-xs"
    style={reserved ? { borderColor:"#34d399", background:"#ecfdf5", color:"#064e3b" } : { borderColor:"#fcd34d", background:"#fffbeb", color:"#78350f" }}>
    <b>{reserved
      ? `${fmt(pre.reserved_pairs)} pairs of this order are reserved in finished goods (sizes ${rows.map(r => r.size).join(", ")}). Include them in this dispatch?`
      : `${fmt(pre.free_pairs)} pairs of free finished goods match this order (sizes ${rows.map(r => r.size).join(", ")}).`}</b>
    <div className="mt-0.5">{reserved
      ? "Ticked sizes leave finished goods when this report is recorded, and their reservation is cleared. Untick to ship them later."
      : "They are not reserved for it. Tick a size to ship those pairs from stock on this report."}</div>
    <div className="mt-1.5 flex gap-x-4 gap-y-1 flex-wrap">
      {rows.map(r => {
        const going = Number(leaving[r.size]) || 0;
        const can = Math.min(r.pairs, going);
        return <label key={r.size} className="inline-flex items-center gap-1.5 mono">
          <input type="checkbox" checked={value[r.size] != null} onChange={e => toggle(r.size, r.pairs, e.target.checked)}
            aria-label={`Ship size ${r.size} from finished goods`} />
          size {r.size}: {fmt(r.pairs)}
          {value[r.size] != null && can < r.pairs &&
            <span className="font-sans">— {fmt(can)} on this report ({fmt(going)} of that size {going === 1 ? "is" : "are"} leaving)</span>}
        </label>;
      })}
    </div>
  </div>;
}
