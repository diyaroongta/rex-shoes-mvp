import React from "react";
import { jobCardIssue } from "../shared/bom-components.js";

/* The Job Card — what is issued to a line or a fabricator for one production
 * run, in the factory's own layout.
 *
 * Three blocks, exactly as their paper card is laid out:
 *   header   article, fabricator, card number, date
 *   cutting  the size-wise quantities to cut, and their total
 *   issued   what goes out with the work, stage by stage
 *
 * NOTHING here is typed in from their sample card. Every value resolves at
 * render time from the order, the fabricator and the BOM, so a card for an
 * article with no BOM prints empty rather than showing another shoe's numbers.
 *
 * The issued list is COMPONENT-wise where the BOM names cut pieces and
 * MATERIAL-wise where it does not — which is how their own card reads, cut
 * pieces first and consumables second.
 */

const B = "1px solid #000";
const CELL = { border:B, padding:"4px 6px", fontSize:11, verticalAlign:"middle" };
const HEAD = { ...CELL, fontWeight:700, textAlign:"center", background:"#f8fafc" };
const LBL  = { ...CELL, fontWeight:600, background:"#f8fafc", width:"16%" };

const fmt = n => n==null||isNaN(n) ? "—" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:3});

export default function JobCard({ card, article, config = {} }){
  const c = card || {};
  const lines = (c.lines || []).filter(l => Number(l.qty) > 0);
  const totalPairs = lines.reduce((a,l) => a + (Number(l.qty)||0), 0);
  const { stages, missing_components } = jobCardIssue(lines, article || {});

  /* Every individual size the run covers, so the card reads size by size the
     way the cutting hall works — falling back to the range when the article
     has no size list. */
  const sizeCells = lines.flatMap(l => {
    const sizes = (l.size_order && l.size_order.length) ? l.size_order : [l.combo];
    const per = (l.sizes && Object.keys(l.sizes).length) ? l.sizes : null;
    return sizes.map(sz => ({ size: sz, combo: l.combo,
      qty: per ? (Number(per[sz]) || 0) : null }));
  });
  const sized = sizeCells.some(s => s.qty != null);

  return <div className="job-card" style={{background:"#fff",color:"#000",padding:14,
      fontFamily:"Arial,Helvetica,sans-serif",maxWidth:900,margin:"0 auto"}}>
    <div style={{textAlign:"center",marginBottom:8}}>
      <img src={config.logo || "/brand/rex-logo.jpg"} alt="" style={{height:38,objectFit:"contain"}} />
    </div>
    <div style={{textAlign:"center",fontSize:15,fontWeight:700,marginBottom:10}}>
      {c.slip || "JOB CARD"}
    </div>

    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
      <tbody>
        <tr>
          <td style={LBL}>Article</td><td style={CELL}><b>{c.article || ""}</b></td>
          <td style={LBL}>Job card no</td><td style={{...CELL,textAlign:"center"}}><b>{c.card_no || ""}</b></td>
        </tr>
        <tr>
          <td style={LBL}>Fabricator</td><td style={CELL}>{c.fabricator || ""}</td>
          <td style={LBL}>Date</td><td style={{...CELL,textAlign:"center"}}>{fmtDate(c.date)}</td>
        </tr>
        <tr>
          <td style={LBL}>Production order</td><td style={CELL}>{c.order_no || "—"}</td>
          <td style={LBL}>Stage</td><td style={{...CELL,textAlign:"center"}}>{c.stage || "CUTTING & STITCHING"}</td>
        </tr>
      </tbody>
    </table>

    {/* SIZE-WISE CUTTING. The card's own top block: what to cut, size by size,
        and the total the whole card is answerable for. */}
    <div style={{fontSize:11,fontWeight:700,marginBottom:3}}>Cutting</div>
    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
      <thead>
        <tr>
          <th style={{...HEAD,width:"14%"}}>SIZE</th>
          {sizeCells.map((s,i) => <th key={i} style={HEAD}>{s.size}</th>)}
          <th style={{...HEAD,width:"12%"}}>TOTAL</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{...CELL,fontWeight:700,background:"#f8fafc"}}>CUTTING</td>
          {sizeCells.map((s,i) => <td key={i} style={{...CELL,textAlign:"center"}}>
            {s.qty != null ? fmt(s.qty) : ""}</td>)}
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(totalPairs)}</td>
        </tr>
      </tbody>
    </table>
    {!sized && <div style={{fontSize:10,color:"#92400e",marginTop:-6,marginBottom:8}}>
      Quantities are per size range; this run has no size-by-size split entered.
    </div>}

    {/* WHAT GOES OUT WITH THE WORK, stage by stage. */}
    {stages.map(st => (
      <div key={st.stage} style={{marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,marginBottom:3}}>
          {st.stage} — {st.from_components ? "components issued" : "materials issued"}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th style={{...HEAD,width:"8%"}}>SL</th>
              <th style={{...HEAD,textAlign:"left"}}>{st.from_components ? "COMPONENT" : "MATERIAL"}</th>
              {st.from_components && <th style={{...HEAD,textAlign:"left"}}>CUT FROM</th>}
              <th style={{...HEAD,width:"14%"}}>QTY</th>
              <th style={{...HEAD,width:"10%"}}>UNIT</th>
            </tr>
          </thead>
          <tbody>
            {st.issued.map((row,i) => (
              <tr key={i}>
                <td style={{...CELL,textAlign:"center"}}>{i+1}</td>
                <td style={CELL}>{String(row.name).trim()}</td>
                {st.from_components && <td style={{...CELL,color:"#475569"}}>
                  {(row.materials||[]).map(m => String(m).split("||")[0]).join(", ")}</td>}
                <td style={{...CELL,textAlign:"right",fontWeight:600}}>{fmt(row.qty)}</td>
                <td style={{...CELL,textAlign:"center"}}>{row.uom || ""}</td>
              </tr>
            ))}
            {!st.issued.length && <tr><td style={CELL} colSpan={5}>Nothing on the BOM for this stage.</td></tr>}
          </tbody>
        </table>
      </div>
    ))}

    {!stages.length && <div style={{...CELL,border:B,marginBottom:10}}>
      This article has no BOM loaded, so there is nothing to issue. Load its BOM under Data &amp; BOM.
    </div>}

    {/* RETURN BLOCK — the card comes back with these filled in. */}
    <table style={{width:"100%",borderCollapse:"collapse",marginTop:12}}>
      <thead><tr>
        <th style={HEAD}>REPAIR</th><th style={HEAD}>SHORTAGE</th>
        <th style={HEAD}>REJECTION</th><th style={HEAD}>TOTAL (PAIRS)</th>
      </tr></thead>
      <tbody><tr>
        <td style={{...CELL,height:26}}></td><td style={CELL}></td><td style={CELL}></td>
        <td style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(totalPairs)}</td>
      </tr></tbody>
    </table>

    <div style={{display:"flex",justifyContent:"space-between",marginTop:30,fontSize:10.5}}>
      <div>Sign. of Cutting in-charge ______________</div>
      <div>Receiving supervisor ______________</div>
      <div>Passing supervisor ______________</div>
    </div>

    {!!missing_components.length && <div data-noprint style={{marginTop:10,padding:"7px 9px",
        border:"1px solid #FDE68A",background:"#FFFBEB",color:"#92400E",fontSize:11,borderRadius:6}}>
      <b>No cut pieces named for:</b> {missing_components.map(m=>String(m).split("||")[0]).join(", ")}.
      These print as materials until the BOM names their components.
    </div>}
  </div>;
}

function fmtDate(iso){
  if(!iso) return "";
  const d = String(iso).slice(0,10).split("-");
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : String(iso);
}
