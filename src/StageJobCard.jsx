import React from "react";
import { familyOf, prefixOf } from "../shared/product-codes.js";
import { stageCard } from "../shared/job-card-stages.js";
import { isClosureWord } from "../shared/product-codes.js";

/* The factory's PASTING and PACKING job cards, following the two formats they
 * sent (PASTING JC FORMATE.xlsx, PACKING JC FORMATE.xlsx).
 *
 * The figures come from the job order and its BOM — `shared/job-card-stages.js`
 * works them out and is tested against their own sample card of 451 pairs.
 * A field the app does not know, SKU code above all, prints as an empty box for
 * the floor to write in rather than as a guess.
 */

const BLACK="#000", B=`1px solid ${BLACK}`, BB=`2px solid ${BLACK}`;
const CELL={border:B,padding:"2px 4px",fontSize:10,verticalAlign:"middle"};
const HEAD={...CELL,fontWeight:700,textAlign:"center"};
const LABEL={...CELL,fontWeight:700};
const PAGE={background:"#fff",padding:8,minHeight:1060,boxSizing:"border-box"};
const fmt=n=>n==null||isNaN(n)?"":Number(n).toLocaleString("en-IN",{maximumFractionDigits:3});
const fmtDate=iso=>{if(!iso)return"";const d=String(iso).slice(0,10).split("-");return d.length===3?`${d[2]}.${d[1]}.${d[0]}`:String(iso);};

/* The closure is a word in the article's own name — "ARMOUR (VELCRO)" — and
   `shared/product-codes.js` already owns that vocabulary, so the card reads it
   from there rather than keeping a second list that can drift. */
function closureOf(name){
  const word=String(name||"").toUpperCase().replace(/[()]/g," ").split(/[^A-Z]+/)
    .filter(Boolean).find(isClosureWord);
  if(!word) return "";
  return word==="V"?"VELCRO":word==="L"?"LACE":word;
}

const prefixCodeOf = article => (article ? prefixOf(article) : "");

export default function StageJobCard({card,article,kind="PACKING",config={}}){
  const c=card||{};
  const lines=(c.lines||[]).filter(l=>Number(l.qty)>0);
  const doc=stageCard(lines,article||{},kind,{avg_notes:config.avg_notes});
  const cells=doc.sizes.length?doc.sizes:[{size:"",qty:null}];
  const colour=[(article||{}).upper_colour,(article||{}).sole_colour].filter(Boolean).join(" / ");

  return <div className="job-card" style={{background:"#fff",color:BLACK,
      fontFamily:"Arial,Helvetica,sans-serif",maxWidth:820,margin:"0 auto"}}>
    <section className="job-card-page" data-job-card-page="1" data-stage-card={doc.kind} style={PAGE}>

      <table style={{width:"100%",borderCollapse:"collapse",border:BB}}><tbody>
        <tr>
          <td style={{...CELL,borderBottom:BB,width:"30%",height:36}}>
            <img src={config.logo||"/brand/rex-logo.jpg"} alt="REX" style={{height:28,width:110,objectFit:"contain",objectPosition:"left center"}}/>
          </td>
          <td style={{...HEAD,borderBottom:BB,fontSize:18}}>{doc.title}</td>
          <td style={{...LABEL,borderBottom:BB,width:"30%",lineHeight:1.6}}>
            JOB CARD NO :- {c.card_no||""}<br/>DATE:- {fmtDate(c.date)}</td>
        </tr>
        {/* THE FACTORY HAS TOLD US WHAT ITS TWO CODES MEAN: the ARTICLE is the
            shoe SERIES (AXEL, JACK) and the SKU is one colour and closure of
            it. An article row in our master IS a colour and a closure, so its
            assigned product code is the SKU code and the family prefix is the
            series code. Both print blank until codes are assigned — an
            invented code on a job card is worse than none — and both cards
            print the same two fields, or the floor would have to learn which
            document lies. */}
        <tr><td style={LABEL}>ARTICLE: {String(familyOf(c.article)||c.article||"").toUpperCase()}</td>
            <td style={CELL}>ARTICLE CODE: {c.series_code||prefixCodeOf(c.article)}</td>
            <td style={CELL}>{c.order_no?`ORDER: ${c.order_no}`:""}</td></tr>
        <tr><td style={LABEL}>COLOUR: {colour}</td>
            <td style={CELL}>VELCRO/LACE: {closureOf(c.article)}</td>
            <td style={CELL}>SKU CODE: {c.sku_code||(article||{}).product_code||""}</td></tr>
      </tbody></table>

      <table style={{width:"100%",borderCollapse:"collapse",borderLeft:BB,borderRight:BB,borderBottom:BB}}><tbody>
        <tr><td style={{...LABEL,borderBottom:B}} colSpan={cells.length+1}>PLAN</td>
            <td style={{...HEAD,borderBottom:B,width:110}}>TOTAL(PAIR)</td></tr>
        {doc.plan_rows.map((row,r)=><React.Fragment key={row}>
          <tr><th style={{...HEAD,width:110}}>SIZE</th>
            {cells.map((s,i)=><th key={i} style={HEAD}>{s.size}</th>)}
            <th style={HEAD}>{r===0?"":"AUTHORITY SIGNATORY"}</th></tr>
          <tr><td style={LABEL}>{row}</td>
            {cells.map((s,i)=><td key={i} style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(s.qty)}</td>)}
            <td style={{...CELL,textAlign:"center",fontWeight:700}}>{fmt(doc.total_pairs)}</td></tr>
        </React.Fragment>)}
        {doc.plan_rows.length>1&&<tr><td style={{...CELL,height:20}} colSpan={cells.length+1}></td>
          <td style={{...HEAD,fontSize:9}}>AUTHORITY SIGNATORY</td></tr>}
      </tbody></table>

      <div style={{display:"grid",gridTemplateColumns:"1fr 210px",gap:0}}>
        <table style={{width:"100%",borderCollapse:"collapse",borderLeft:BB,borderBottom:BB}}>
          <thead>
            <tr><th style={{...HEAD,width:54}}>SL.NO</th><th style={HEAD}>{doc.issue_title}</th>
              <th style={{...HEAD,width:84}}>QUANTITY</th><th style={{...HEAD,width:62}}>UNIT</th></tr>
          </thead>
          <tbody>
            {doc.rows.map((row,i)=><tr key={i}>
              <td style={{...CELL,textAlign:"center"}}>{i+1}</td>
              <td style={CELL}>{row.name}</td>
              <td style={{...CELL,textAlign:"right",fontWeight:600}}>{fmt(row.qty)}</td>
              <td style={{...CELL,textAlign:"center"}}>{row.uom}</td></tr>)}
            {Array.from({length:Math.max(0,12-doc.rows.length)},(_,i)=><tr key={`blank${i}`}>
              <td style={{...CELL,textAlign:"center",height:17}}>{doc.rows.length+i+1}</td>
              <td style={CELL}></td><td style={CELL}></td><td style={CELL}></td></tr>)}
          </tbody>
        </table>
        <table style={{width:"100%",borderCollapse:"collapse",border:BB,alignSelf:"start"}}><tbody>
          <tr><td style={{...HEAD,borderBottom:B}} colSpan={2}>AVG</td></tr>
          {doc.avg_notes.map(n=><tr key={n.label}>
            <td style={{...CELL,fontWeight:600}}>{n.label}</td>
            <td style={{...CELL,textAlign:"center",width:70}}>{n.value}</td></tr>)}
          {doc.summary.map(label=><tr key={label}>
            <td style={{...LABEL,fontSize:9.5}}>{label}</td><td style={{...CELL,height:20}}></td></tr>)}
        </tbody></table>
      </div>

      {!doc.from_bom&&<div data-noprint style={{margin:"6px 0",padding:"6px 8px",
          border:"1px solid #d97706",background:"#fffbeb",color:"#92400e",fontSize:10}}>
        <b>No {doc.stage.toLowerCase()} BOM is loaded for this article.</b> The card prints the
        factory&rsquo;s own list with the quantity column empty; no quantity has been invented.
      </div>}

      <div style={{display:"grid",gridTemplateColumns:`repeat(${doc.signatures.length},1fr)`,
                   borderLeft:BB,borderRight:BB,borderBottom:BB,minHeight:34,fontSize:9.5,fontWeight:700,alignItems:"end"}}>
        {doc.signatures.map(s=><div key={s} style={{padding:"3px 5px"}}>
          <div style={{borderTop:B,paddingTop:2}}>{s}</div></div>)}
      </div>

      {doc.movements.map(title=><div key={title} style={{marginTop:8}}>
        <div style={{fontSize:10.5,fontWeight:700,textDecoration:"underline",marginBottom:2}}>{title}</div>
        <table style={{width:"100%",borderCollapse:"collapse",border:BB}}><tbody>
          {["DT:","SIZE:","QTY:"].map(label=><tr key={label}>
            <td style={{...LABEL,width:78}}>{label}</td>
            {cells.map((s,i)=><td key={i} style={{...CELL,height:17,textAlign:"center"}}>{label==="SIZE:"?s.size:""}</td>)}
          </tr>)}
        </tbody></table>
      </div>)}
    </section>
  </div>;
}
