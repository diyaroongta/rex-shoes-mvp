import React from "react";
import { buildPI, inr, DEFAULT_TERMS } from "../shared/pi.js";

/* Proforma Invoice, laid out to match the format the factory already issues.
   Every number comes from shared/pi.js — this file only arranges them. */

export const DEFAULT_PI_CONFIG = {
  company_name: "",
  terms: [
    "The company has established fixed MRP for all its articles, which are uniform across India and cannot be customized for individual regions, locations, or orders.",
    "Ordered goods once sold will not be returned.",
    "It is the responsibility of the customer to check all details of the article as mentioned in the PI. No goods will be returned in case of customer negligence",
    "Once a confirmation or advance payment is received against the PI, it will be automatically forwarded to Production, and all details mentioned will be treated as confirmed.",
    "All orders are made to order and are not returnable or changeable once sent to Production",
    "MOQ for all articles is 12 pcs/per size and must be followed at the time of re-fill. Customer to plan for orders accordingly",
    "Any disputes arising from the order shall fall under the jurisdiction of the local courts of Delhi.",
  ],
  bold_terms: [3, 4, 5, 6],          // rendered bold, as on the original
  payment_schedule: [
    { schedule:"50% of Proforma Invoice Value", window:"At the time of order- the Order will be confirmed once the commitment money is received",
      comments:"The delivery date will be calculated from date of confirmation of order" },
    { schedule:"50% of Proforma Invoice Value", window:"At the time of dispatch",
      comments:"The Invoice will be raised at the time of payment" },
  ],
  bank: { account_name:"", account_number:"", bank_name:"", ifsc:"" },
};

const niceDate = iso => {
  if(!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if(isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
};

const C = { border:"1px solid #000", padding:"3px 5px", fontSize:"10px", verticalAlign:"middle" };
const H = { ...C, fontWeight:700, textAlign:"center", background:"#fff" };
const R = { ...C, textAlign:"right" };
const N = { ...C, textAlign:"center" };
/* Sized to the printed cell so an editable invoice keeps the same layout as
   the one that comes out of the printer. */
const CELL_INPUT = { width:"56px", textAlign:"center", font:"inherit", fontSize:"10px",
  border:"1px solid #CBD5E1", borderRadius:"3px", padding:"1px 2px", background:"#FFFDF5" };

/* `onCell` makes the invoice itself editable. The clerk is looking at the PI
   when they spot a wrong quantity or price, so that is where it should be
   corrected — not on a different screen that has to be found first. Left
   undefined the document renders exactly as it prints. */
export default function PiDocument({ order, article, mrp, terms, config, image, piNo, confirmationDate, onCell }){
  const t   = { ...DEFAULT_TERMS, ...(terms||{}) };
  const cfg = { ...DEFAULT_PI_CONFIG, ...(config||{}) };
  // `image` is the single-article convenience prop; multi-article orders carry
  // an image per item instead.
  const pi  = buildPI({ ...order, image: order.image || image }, article, mrp || {}, t);
  const { lines, totals } = pi;

  const vl     = order.vl           || (/LACE/i.test(order.article_code) ? "Lace" : /VELCRO|\(V\)/i.test(order.article_code) ? "Velcro" : "");
  const sole   = order.sole_colour  || "";
  const upper  = order.upper_colour || "";
  const source = order.catalogue_source || "As per catalogue";
  const label  = order.article_label || order.article_code;

  // The money column sits under Amount; labels are right-aligned before it.
  const SPAN_LEFT = 7;    // Article..Article Image
  return (
    <div id="pi-area" style={{ fontFamily:"Arial, Helvetica, sans-serif", color:"#000", background:"#fff" }}>

      <div style={{ textAlign:"center", fontWeight:700, fontSize:"13px", border:"1px solid #000", padding:"5px" }}>
        PROFORMA INVOICE
      </div>

      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <tbody>
          {[
            ["Order No:", piNo || order.order_no || ""],
            ["PI Generation Date:", niceDate(order.pi_date || order.order_date)],
            ["Order Confirmation Date:", confirmationDate ? niceDate(confirmationDate) : ""],
            ["Dispatch timeline:", t.dispatch_timeline || ""],
          ].map(([k,v],i)=>(
            <tr key={i}>
              <td style={{ ...C, fontWeight:700, width:"22%" }}>{k}</td>
              <td style={{ ...C, width:"18%" }}>{v}</td>
              <td style={{ ...C, width:"60%" }}></td>
            </tr>
          ))}
          <tr>
            <td style={{ ...C, fontWeight:700 }}>Customer Name:</td>
            <td style={C}>{order.party || ""}</td>
            <td style={C}>{order.customer_city || ""}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width:"100%", borderCollapse:"collapse", marginTop:"-1px" }}>
        <thead>
          <tr>
            {["Article","Closure","Sole","Upper Colour","Order Nature","Print","Article Image",
              "Size","Qty","MRP","Discount","Rate","Amount"].map(h=>(
              <th key={h} style={H}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pi.groups.map(g => g.lines.map((l,li)=>(
            <tr key={`${g.index}-${li}`}>
              <td style={N}>{g.article_label}</td>
              <td style={N}>{l.vl || g.vl}</td>
              <td style={N}>{g.sole_colour}</td>
              <td style={N}>{g.upper_colour}</td>
              <td style={N}>{g.order_nature || g.source}</td>
              <td style={N}>{g.printing ? "Yes" : "No"}</td>
              {li === 0 && (
                <td style={{ ...N, width:"90px" }} rowSpan={g.lines.length}>
                  {g.image
                    ? <img src={g.image} alt={g.article_label}
                        style={{ maxWidth:"84px", maxHeight:"84px", objectFit:"contain" }} />
                    : <span style={{ fontSize:"8px", color:"#94A3B8", lineHeight:1.3, display:"block" }}>
                        no photo<br/>on file
                      </span>}
                </td>
              )}
              <td style={N}>{onCell && (l.size_order||[]).length
                ? <select value={l.size}
                    aria-label={`${g.article_label} ${l.combo} size`}
                    onChange={e=>onCell(g.index,l,"size",e.target.value)}
                    style={{...CELL_INPUT, width:"62px"}}>
                    {(l.size_order||[]).map(sz=><option key={sz} value={sz}>{sz}</option>)}
                  </select>
                : l.size}</td>
              <td style={N}>{onCell
                ? <input type="number" min={0} value={l.qty}
                    aria-label={`${g.article_label} ${l.combo} ${l.size} pairs`}
                    onChange={e=>onCell(g.index,l,"qty",e.target.value)} style={CELL_INPUT} />
                : l.qty}</td>
              <td style={N}>{onCell
                ? <input type="number" min={0} value={l.mrp ?? ""} placeholder="—"
                    aria-label={`${g.article_label} ${l.combo} ${l.size} MRP`}
                    onChange={e=>onCell(g.index,l,"mrp",e.target.value)} style={CELL_INPUT} />
                : (l.mrp == null ? "—" : l.mrp)}</td>
              <td style={N}>{l.discount_pct}%</td>
              <td style={N}>{l.rate == null ? "—" : l.rate}</td>
              <td style={R}>{l.amount == null ? "—" : inr(l.amount)}</td>
            </tr>
          )))}

          <tr>
            <td style={{ ...C, fontWeight:700 }} colSpan={SPAN_LEFT}>
              Special Remarks: {order.remarks || "None"}
            </td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
          </tr>

          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td>
            <td style={{ ...N, fontWeight:700 }}>{inr(totals.total_qty)}</td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={{ ...R, fontWeight:700 }}>{inr(totals.subtotal)}</td>
          </tr>

          {totals.steps.map((s,i)=>(
            <React.Fragment key={i}>
              <tr>
                <td style={C} colSpan={SPAN_LEFT}></td>
                <td style={C}></td><td style={C}></td>
                <td style={C}>{s.kind === "less" ? "Less" : "Add"}</td>
                <td style={C}>{s.label}</td>
                <td style={R}>{s.pct}%</td>
                <td style={R}>{inr(s.amount)}</td>
              </tr>
              <tr>
                <td style={C} colSpan={SPAN_LEFT}></td>
                <td style={C}></td><td style={C}></td><td style={C}></td>
                <td style={C}></td><td style={C}></td>
                <td style={{ ...R, fontWeight: i === totals.steps.length-1 ? 700 : 400 }}>{inr(s.running)}</td>
              </tr>
            </React.Fragment>
          ))}

          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={{ ...C, fontWeight:700 }} colSpan={2}>Total Amount</td>
            <td style={{ ...R, fontWeight:700 }}>{inr(totals.total)}</td>
          </tr>
          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={C} colSpan={2}>Payment to be paid</td>
            <td style={R}>{totals.payment.split_pct}%</td>
          </tr>
          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={C} colSpan={2}></td>
            <td style={{ ...R, fontWeight:700, background:"#FFF2CC" }}>{inr(totals.payment.on_order)}</td>
          </tr>
          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={C} colSpan={2}>Payment due on Dispatch</td>
            <td style={R}>{totals.payment.split_pct}%</td>
          </tr>
          <tr>
            <td style={C} colSpan={SPAN_LEFT}></td>
            <td style={C}></td><td style={C}></td><td style={C}></td>
            <td style={C} colSpan={2}></td>
            <td style={R}>{inr(totals.payment.on_dispatch)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop:"14px", fontSize:"9.5px", lineHeight:1.5 }}>
        <div style={{ fontWeight:700, marginBottom:"3px" }}>TERMS &amp; CONDITIONS :</div>
        {(cfg.terms||[]).map((line,i)=>(
          <div key={i} style={{ fontWeight:(cfg.bold_terms||[]).includes(i) ? 700 : 400 }}>
            {i+1}. {line}
          </div>
        ))}
      </div>

      <div style={{ marginTop:"10px", fontSize:"9.5px" }}>
        <div style={{ fontWeight:700, marginBottom:"3px" }}>Payment schedule to be followed:</div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>{["Payment Schedule","Payment Window","Comments"].map(h=>(
              <th key={h} style={{ ...H, fontSize:"9.5px" }}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {(cfg.payment_schedule||[]).map((r,i)=>(
              <tr key={i}>
                <td style={{ ...C, fontSize:"9.5px", width:"22%" }}>{r.schedule}</td>
                <td style={{ ...C, fontSize:"9.5px", width:"48%" }}>{r.window}</td>
                <td style={{ ...C, fontSize:"9.5px", width:"30%" }}>{r.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(cfg.bank && (cfg.bank.account_name || cfg.bank.account_number)) && (
        <div style={{ marginTop:"12px", fontSize:"9.5px", lineHeight:1.6 }}>
          <div style={{ fontWeight:700 }}>BANK DETAILS:</div>
          {cfg.bank.account_name   && <div>Account Name: {cfg.bank.account_name}</div>}
          {cfg.bank.account_number && <div>Account Number: {cfg.bank.account_number}</div>}
          {cfg.bank.bank_name      && <div>Bank Name: {cfg.bank.bank_name}</div>}
          {cfg.bank.ifsc           && <div>IFSC Code: {cfg.bank.ifsc}</div>}
        </div>
      )}

      {!!pi.missing.length && (
        <div style={{ marginTop:"10px", fontSize:"9.5px", color:"#92400E", background:"#FEF3C7",
                      border:"1px solid #F59E0B", padding:"6px 8px" }}>
          <b>Not priced:</b>{" "}
          {pi.missing.map(m => `${m.combo} (${m.why})`).join(", ")}. Set the MRP for these size
          ranges in Data &amp; BOM before issuing this invoice.
        </div>
      )}
    </div>
  );
}
