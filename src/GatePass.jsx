import React from "react";
import { buildGatePass } from "../shared/gate-pass.js";

/* THE GATE PASS SLIP, in the factory's own layout — the pre-printed book that
   security checks as the lorry leaves. Every figure comes from the packing
   list for the same dispatch, so the two documents cannot disagree.
   The SR. No is typed from the pad; we never issue one. */

const B  = "1px solid #000";
const CELL = { border:B, padding:"3px 5px", fontSize:11, verticalAlign:"middle" };
const HEAD = { ...CELL, fontWeight:700, textAlign:"center", fontSize:10, textTransform:"uppercase" };
const fmt = n => n == null || n === "" ? "" : Number(n).toLocaleString("en-IN");
const niceDate = iso => {
  if(!iso) return "";
  const d = new Date(`${String(iso).slice(0,10)}T00:00:00`);
  if(isNaN(d)) return String(iso);
  const p = n => String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(2)}`;
};

export default function GatePass({ data, logo = "/brand/rex-logo.jpg" }){
  const pass = data && data.rows ? data : buildGatePass(data || {});
  return <div className="gate-pass" style={{ background:"#fff", color:"#000",
    fontFamily:"Arial, Helvetica, sans-serif", padding:10, maxWidth:760, margin:"0 auto" }}>

    <table style={{ width:"100%", borderCollapse:"collapse", border:B }}><tbody>
      <tr>
        <td style={{ ...CELL, width:"55%" }}>
          <img src={logo} alt="REX" style={{ height:26, objectFit:"contain", objectPosition:"left center" }} />
        </td>
        <td style={{ ...CELL, textAlign:"center", fontWeight:700, fontSize:15, letterSpacing:1 }}>
          GATE PASS SLIP</td>
        <td style={{ ...CELL, width:"22%", fontSize:11 }}>
          SR. No.&nbsp;<b style={{ fontSize:13 }}>{pass.serial_no || "__________"}</b></td>
      </tr>
      <tr>
        <td style={CELL} colSpan={2}>PARTY NAME :&nbsp;<b>{(pass.party || "").toUpperCase()}</b></td>
        <td style={CELL}>DATE :&nbsp;<b>{niceDate(pass.date)}</b></td>
      </tr>
      <tr>
        <td style={CELL} colSpan={2}>&nbsp;{(pass.city || "").toUpperCase()}</td>
        <td style={CELL}>TRANSPORT :&nbsp;{(pass.transporter || "").toUpperCase()}</td>
      </tr>
    </tbody></table>

    <table style={{ width:"100%", borderCollapse:"collapse", borderLeft:B, borderRight:B, borderBottom:B }}>
      <thead>
        <tr>
          <th style={{ ...HEAD, width:38 }}>SR.<br/>NO.</th>
          <th style={HEAD}>Article name</th>
          <th style={{ ...HEAD, width:56 }}>Size</th>
          <th style={{ ...HEAD, width:56 }}>Colour</th>
          <th style={{ ...HEAD, width:78 }}>Order no.</th>
          <th style={{ ...HEAD, width:62 }}>Total order</th>
          <th style={{ ...HEAD, width:52 }}>Carton</th>
          <th style={{ ...HEAD, width:52 }}>MRP</th>
          <th style={{ ...HEAD, width:56 }}>Std. pac.</th>
          <th style={{ ...HEAD, width:56 }}>Pairs</th>
        </tr>
      </thead>
      <tbody>
        {pass.rows.map((r, i) => (
          <tr key={i}>
            <td style={{ ...CELL, textAlign:"center" }}>{r.sno}</td>
            <td style={CELL}>{i === 0 || pass.rows[i-1].article !== r.article ? r.article : ""}
              {r.closure ? <span style={{ fontSize:9 }}> ({r.closure})</span> : null}</td>
            <td style={{ ...CELL, textAlign:"center" }}>{r.size}</td>
            {/* A MIXED BOX lists what is inside it. Their own slip writes the
                sizes and pairs across these two columns, because a gate that
                cannot see inside the box has to read it here. */}
            <td style={{ ...CELL, textAlign:"center", fontSize:r.mixed ? 9 : 11 }}>
              {r.mixed ? r.contents : r.colour}</td>
            <td style={{ ...CELL, textAlign:"center" }}>{i === 0 ? pass.order_no : ""}</td>
            <td style={{ ...CELL, textAlign:"right" }}>{i === 0 ? fmt(pass.order_qty) : ""}</td>
            <td style={{ ...CELL, textAlign:"center", fontWeight:700 }}>
              {r.cartons || ""}
              {r.mixed ? <div style={{ fontWeight:400, fontSize:8 }}>MIXED</div> : null}</td>
            {/* Blank, never zero: a blank tells the gate to check, a zero tells
                it the shoes are free. */}
            <td style={{ ...CELL, textAlign:"right" }}>{fmt(r.mrp)}</td>
            <td style={{ ...CELL, textAlign:"center" }}>{fmt(r.std_pack)}</td>
            <td style={{ ...CELL, textAlign:"right", fontWeight:700 }}>{fmt(r.pairs)}</td>
          </tr>))}
        {Array.from({ length: Math.max(0, 10 - pass.rows.length) }, (_, i) => (
          <tr key={`blank${i}`}>
            <td style={{ ...CELL, textAlign:"center", height:19, color:"#666" }}>{pass.rows.length + i + 1}</td>
            {Array.from({ length:9 }, (_, c) => <td key={c} style={CELL}></td>)}
          </tr>))}
        <tr>
          <td style={{ ...CELL, fontWeight:700, textAlign:"right" }} colSpan={6}>TOTAL ═══&gt;</td>
          <td style={{ ...CELL, fontWeight:700, textAlign:"center" }}>{fmt(pass.total_cartons)}</td>
          <td style={CELL} colSpan={2}></td>
          <td style={{ ...CELL, fontWeight:700, textAlign:"right" }}>{fmt(pass.total_pairs)}</td>
        </tr>
      </tbody>
    </table>

    <table style={{ width:"100%", borderCollapse:"collapse", borderLeft:B, borderRight:B, borderBottom:B }}><tbody>
      <tr>
        <td style={{ ...CELL, height:44, width:"50%", verticalAlign:"bottom", fontSize:10 }}>
          SIGNATURE DIS. SUPERVISOR</td>
        <td style={{ ...CELL, height:44, verticalAlign:"bottom", fontSize:10 }}>
          SIGNATURE SECURITY</td>
      </tr>
    </tbody></table>

    {(pass.missing_mrp > 0 || pass.missing_pack > 0 || !pass.ok) && (
      <div data-noprint style={{ marginTop:8, fontSize:11, color:"#92400e" }}>
        {!pass.ok && <div><b>{pass.problems.join(" · ")}</b></div>}
        {pass.missing_mrp > 0 && <div>{pass.missing_mrp} row(s) have no MRP on record — printed blank.</div>}
        {pass.missing_pack > 0 && <div>{pass.missing_pack} row(s) have no standard pack on record — printed blank.</div>}
        <div style={{ marginTop:4 }}>Pairs = cartons × std. pac. on every row; a mixed box packs at what it holds.</div>
      </div>)}
  </div>;
}
