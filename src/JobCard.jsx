import React from "react";
import { jobCardIssue } from "../shared/bom-components.js";

/* Two-page factory form, following ARMOUR 17004.pdf. Values still come from
 * the selected production order and its BOM; sample data is never copied into
 * another card merely to make the form look full. */

const BLACK="#000", B=`1px solid ${BLACK}`, BB=`2px solid ${BLACK}`;
const CELL={border:B,padding:"2px 4px",fontSize:10,verticalAlign:"middle"};
const HEAD={...CELL,fontWeight:700,textAlign:"center"};
const LABEL={...CELL,fontWeight:700};
const PAGE={background:"#fff",padding:8,minHeight:1060,boxSizing:"border-box"};
const fmt=n=>n==null||isNaN(n)?"":Number(n).toLocaleString("en-IN",{maximumFractionDigits:3});
const nameOf=value=>String(value||"").split("||")[0].trim();

export default function JobCard({card,article,config={}}){
  const c=card||{};
  const lines=(c.lines||[]).filter(l=>Number(l.qty)>0);
  const totalPairs=lines.reduce((a,l)=>a+(Number(l.qty)||0),0);
  const {stages,missing_components}=jobCardIssue(lines,article||{});
  const cutting=stages.find(s=>s.stage==="CUTTING")||{components:[],materials:[],issued:[]};
  const stitching=stages.find(s=>s.stage==="STITCHING")||{materials:[],issued:[]};
  const cuttingRows=cutting.components.length?cutting.components:cutting.materials;
  const stitchingRows=stitching.materials.length?stitching.materials:stitching.issued;
  const sizeCells=sizesFor(lines);

  return <div className="job-card" style={{background:"#fff",color:BLACK,
      fontFamily:"Arial,Helvetica,sans-serif",maxWidth:820,margin:"0 auto"}}>
    <section className="job-card-page" data-job-card-page="1" style={PAGE}>
      <Header card={c} logo={config.logo||"/brand/rex-logo.jpg"}/>
      <SizeGrid sizes={sizeCells} total={totalPairs}/>
      <div style={{borderLeft:BB,borderRight:BB,borderBottom:BB,padding:"2px 5px",
                   fontSize:10,fontWeight:700,textDecoration:"underline"}}>Sign. Of Cutting -in charge</div>
      <IssueTable title="MATERIAL ISSUED" rows={cuttingRows} empty="No cutting BOM loaded"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",borderLeft:BB,borderRight:BB,borderBottom:BB,
                   minHeight:30,fontSize:9.5,fontWeight:700,alignItems:"end"}}>
        <div style={{padding:"3px 5px",textDecoration:"underline"}}>Sign. Of Cutting -in charge</div>
        <div style={{padding:"3px 5px",textAlign:"right",textDecoration:"underline"}}>Sign of Gate Man</div>
      </div>
      <IssueTable title="ISSUED MATERIALS" rows={stitchingRows} empty="No stitching BOM loaded"/>
      <div style={{borderLeft:BB,borderRight:BB,borderBottom:BB,minHeight:24,padding:"3px 5px",
                   fontSize:9.5,fontWeight:700,textAlign:"right",fontStyle:"italic"}}>Sign of Gate Man</div>
      <RepairGrid sizes={sizeCells}/>
      {!!missing_components.length&&<div data-noprint style={{marginTop:8,padding:"6px 8px",
          border:"1px solid #d97706",background:"#fffbeb",color:"#92400e",fontSize:10}}>
        <b>Cut-piece names still missing for:</b> {missing_components.map(nameOf).join(", ")}.
        They remain visible as materials; no component quantity has been invented.
      </div>}
    </section>

    <section className="job-card-page" data-job-card-page="2"
      style={{...PAGE,pageBreakBefore:"always",breakBefore:"page"}}>
      <MovementGrid title="RECEIVED UPPER" sizes={sizeCells}/>
      <MovementGrid title="SHORTAGE AFTER RECEIVED UPPER" sizes={sizeCells}/>
      <MovementGrid title="SHORTAGE RECEIVED UPPER" sizes={sizeCells}/>
      <div style={{textAlign:"center",fontWeight:700,fontSize:11,margin:"8px 0 2px",textDecoration:"underline"}}>REPAIR STATUS</div>
      <MovementGrid title="SEND FOR REPAIR" sizes={sizeCells} compact/>
      <MovementGrid title="RECEIVED AFTER REPAIR" sizes={sizeCells} compact/>
      <MovementGrid title="REJECTION" sizes={sizeCells} compact/>
      <div style={{border:BB,minHeight:148}}>
        <div style={{...LABEL,border:"none",borderBottom:BB,fontSize:10}}>REMARKS</div>
        {Array.from({length:8},(_,i)=><div key={i} style={{height:16,borderBottom:i===7?"none":B}}/>)}
      </div>
    </section>
  </div>;
}

function Header({card,logo}){return <table style={{width:"100%",borderCollapse:"collapse",border:BB}}><tbody>
  <tr><td style={{...CELL,borderBottom:BB,height:38}} colSpan={3}>
    <img src={logo} alt="REX" style={{height:30,width:120,objectFit:"contain",objectPosition:"left center"}}/>
  </td><td style={{...LABEL,borderBottom:BB,width:"23%",fontSize:11,textDecoration:"underline"}}>SR-NO.</td></tr>
  <tr><td style={{...LABEL,borderBottom:BB,height:32}} colSpan={2}>NAME OF FABRICATOR: <span style={{fontSize:11}}>{String(card.fabricator||"").toUpperCase()}</span></td>
    <td style={{...HEAD,borderBottom:BB,fontSize:20,width:"24%"}}>CUTTING</td>
    <td style={{...LABEL,borderBottom:BB,lineHeight:1.6}}>JOB CARD NO :- {card.card_no||""}<br/>DATE:- {fmtDate(card.date)}</td></tr>
  <tr><td style={{...LABEL,height:28,fontSize:11}} colSpan={3}>ARTICLE: {String(card.article||"").toUpperCase()}</td><td style={CELL}></td></tr>
</tbody></table>}

function SizeGrid({sizes,total}){const cells=sizes.length?sizes:[{size:"",qty:null}];return <table style={{width:"100%",borderCollapse:"collapse",borderLeft:BB,borderRight:BB,borderBottom:BB}}>
  <thead><tr><th style={{...HEAD,width:84}}>SIZE</th>{cells.map((s,i)=><th key={i} style={HEAD}>{s.size}</th>)}<th style={{...HEAD,width:92}}>TOTAL(PAIR)</th></tr></thead>
  <tbody><tr><td style={LABEL}>CUTTING</td>{cells.map((s,i)=><td key={i} style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(s.qty)}</td>)}<td style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(total)}</td></tr></tbody>
</table>}

function IssueTable({title,rows,empty}){return <table style={{width:"100%",borderCollapse:"collapse",borderLeft:BB,borderRight:BB,borderBottom:BB}}>
  <thead><tr><th style={{...LABEL,borderBottom:BB,fontSize:10}} colSpan={4}>{title}</th></tr>
    <tr><th style={{...HEAD,width:62}}>SL.NO</th><th style={HEAD}>{title}</th><th style={{...HEAD,width:82}}>QUANTITY</th><th style={{...HEAD,width:70}}>UNIT</th></tr></thead>
  <tbody>{(rows||[]).map((row,i)=><tr key={i}><td style={{...CELL,textAlign:"center"}}>{i+1}</td>
    <td style={CELL}>{String(row.name||row.material||"").trim()}</td><td style={{...CELL,textAlign:"right",fontWeight:600}}>{fmt(row.qty)}</td><td style={{...CELL,textAlign:"center"}}>{row.uom||""}</td></tr>)}
    {!rows.length&&<tr><td style={{...CELL,height:22}}></td><td style={CELL}>{empty}</td><td style={CELL}></td><td style={CELL}></td></tr>}</tbody>
</table>}

function RepairGrid({sizes}){const cells=sizes.length?sizes:[{size:""}];return <table style={{width:"100%",borderCollapse:"collapse",border:BB}}><tbody>
  <tr><td style={{...LABEL,borderBottom:BB}} colSpan={cells.length+1}>REPAIR / SHORTAGE</td></tr>
  {["SIZE","REPAIR","SHORTAGE","REJECTION"].map(label=><tr key={label}><td style={{...LABEL,width:84}}>{label}</td>
    {cells.map((s,i)=><td key={i} style={{...CELL,textAlign:"center",height:19}}>{label==="SIZE"?s.size:""}</td>)}</tr>)}
  <tr><td style={{...LABEL,height:24}} colSpan={Math.max(1,Math.ceil((cells.length+1)/2))}>SIG. REC. SUPERVISOR</td>
    <td style={{...LABEL,textAlign:"center"}} colSpan={Math.max(1,cells.length+1-Math.ceil((cells.length+1)/2))}>SIG. PASSING SUPERVISOR</td></tr>
  <tr><td style={{...LABEL,height:24}} colSpan={cells.length+1}>REJ. AFTER PASSING</td></tr>
</tbody></table>}

function MovementGrid({title,sizes,compact=false}){const cells=sizes.length?sizes:Array.from({length:12},()=>({size:""}));return <div style={{marginBottom:compact?8:14}}>
  <div style={{fontSize:10.5,fontWeight:700,textDecoration:"underline",textAlign:compact?"left":"center",marginBottom:2}}>{title}</div>
  <table style={{width:"100%",borderCollapse:"collapse",border:BB}}><tbody>
    {["DT:","SIZE:","QTY:"].map(label=><tr key={label}><td style={{...LABEL,width:78}}>{label}</td>{cells.map((s,i)=><td key={i} style={{...CELL,height:17,textAlign:"center"}}>{label==="SIZE:"?s.size:""}</td>)}</tr>)}
    {Array.from({length:compact?2:3},(_,r)=><tr key={r}><td style={{...CELL,height:17}}></td>{cells.map((_,i)=><td key={i} style={{...CELL,height:17}}></td>)}</tr>)}
  </tbody></table>
</div>}

function sizesFor(lines){const out=[];for(const line of lines){const order=line.size_order&&line.size_order.length?line.size_order:[line.combo];const split=line.sizes&&Object.keys(line.sizes).length?line.sizes:null;for(const size of order)out.push({size,qty:split?(Number(split[size])||0):null});}return out;}
function fmtDate(iso){if(!iso)return"";const d=String(iso).slice(0,10).split("-");return d.length===3?`${d[2]}.${d[1]}.${d[0]}`:String(iso);}
