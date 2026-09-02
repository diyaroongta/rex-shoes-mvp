import React from "react";
import { buildPackingList, cartonNumbers } from "../shared/packing-list.js";

/* The Packing List, laid out as the factory's own sheet.
 *
 * Deliberately a faithful copy rather than a tidied-up version: this document
 * travels with the lorry and is checked against by the customer's gate, so the
 * columns, their order and the C/N notation all have to be the ones people
 * already read. The screen and the print are the same markup for the same
 * reason the invoice is — a layout that only looks right on screen is one that
 * gets discovered at the printer.
 */

const B  = "1px solid #000";
const CELL = { border:B, padding:"3px 5px", fontSize:11, verticalAlign:"middle" };
const HEAD = { ...CELL, fontWeight:700, textAlign:"center", background:"#fff" };
const LBL  = { ...CELL, fontWeight:600 };

/* The letterhead, mark and footer are part of the FORM — they are printed on
   every one of these the factory issues, so they ship as defaults rather than
   being something to configure before the first sheet can go out. Everything
   below them is data: customer, numbers, sizes, cartons.
   `logo` and `footer_logo` take image data URLs (the same way catalogue photos
   are stored) so the real artwork can be dropped in without a code change; the
   wordmark below is what prints until it is. */
export const DEFAULT_PACKING_CONFIG = {
  company_name: "REX",
  tagline: "Mark Of Originality",
  logo: null,
  footer_logo: null,
  footer_note: "",
};

export default function PackingList({ data, articleName, config = {} }){
  const cfg = { ...DEFAULT_PACKING_CONFIG, ...(config || {}) };
  const list = buildPackingList(data || {});
  const { lines, total_pairs, total_cartons } = list;

  return <div className="packing-list" style={{background:"#fff",color:"#000",padding:16,
      fontFamily:"Arial,Helvetica,sans-serif",maxWidth:900,margin:"0 auto"}}>
    <style>{`
      @media print {
        .packing-list { max-width:none; padding:0; }
        [data-noprint] { display:none !important; }
        @page { size: A4 portrait; margin: 10mm; }
      }
    `}</style>

    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:6}}>
      {cfg.logo
        ? <img src={cfg.logo} alt={cfg.company_name} style={{height:44,objectFit:"contain"}} />
        : <div style={{textAlign:"center"}}>
            <div style={{fontSize:26,fontWeight:800,letterSpacing:"-.02em"}}>{cfg.company_name}</div>
            {cfg.tagline && <div style={{fontSize:9,color:"#444",marginTop:-2}}>{cfg.tagline}</div>}
          </div>}
      {cfg.footer_logo && <img src={cfg.footer_logo} alt="" style={{height:52,objectFit:"contain"}} />}
    </div>
    <div style={{textAlign:"center",fontSize:16,fontWeight:700,margin:"8px 0 10px"}}>Packing List</div>

    {/* The header block, in the sheet's own two rows. */}
    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:0}}>
      <tbody>
        <tr>
          <td style={LBL}>Name of Customer :-</td>
          <td style={{...CELL,fontWeight:700}} colSpan={2}>{list.customer || ""}</td>
          <td style={LBL}>Order Quantity :-</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{list.order_qty ?? ""}</td>
          <td style={LBL}>Order No</td>
          <td style={{...CELL,textAlign:"center"}}>{list.order_no || ""}</td>
        </tr>
        <tr>
          <td style={LBL}>Dispatch Quantity :-</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}} colSpan={2}>{total_pairs || ""}</td>
          <td style={LBL}>Dispatch C/N :-</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{total_cartons || ""}</td>
          <td style={LBL}>Date : -</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{fmtDate(list.date)}</td>
        </tr>
      </tbody>
    </table>

    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead>
        <tr>
          <th style={{...HEAD,width:"6%"}}>S.NO</th>
          <th style={{...HEAD,width:"18%"}}>Article Name</th>
          <th style={{...HEAD,width:"13%"}}>Velcro/Lace</th>
          <th style={{...HEAD,width:"16%"}}>COLOUR</th>
          <th style={{...HEAD,width:"10%"}}>Size</th>
          <th style={{...HEAD,width:"11%"}}>PAIRS</th>
          <th style={{...HEAD,width:"8%"}}>C/N</th>
          <th style={{...HEAD,width:"18%"}}>C/N Numbers</th>
        </tr>
      </thead>
      <tbody>
        {lines.map(line => {
          /* Two spans, not one. The identifying columns span the whole S.NO;
             the carton count and its numbers span only the sizes sharing that
             box — which is what makes 8+9 in one carton print a single 5/49
             while 8, 9 and 10 in their own cartons print 1/49, 2/49, 3/49. */
          let first = true;
          return line.groups.map((g, gi) => {
            const rows = Math.max(1, g.sizes.length);
            return (g.sizes.length ? g.sizes : [{ size:"", pairs:0 }]).map((s, si) => {
              const head = first; if(si === 0 && gi === 0) first = false;
              return <tr key={`${line.sno}-${gi}-${si}`}>
                {head && si === 0 && gi === 0 && <>
                  <td style={{...CELL,textAlign:"center"}} rowSpan={line.rows}>{line.sno}</td>
                  <td style={{...CELL,textAlign:"center"}} rowSpan={line.rows}>{line.article || articleName || ""}</td>
                  <td style={{...CELL,textAlign:"center"}} rowSpan={line.rows}>{line.closure}</td>
                  <td style={{...CELL,textAlign:"center"}} rowSpan={line.rows}>{line.colour}</td>
                </>}
                <td style={{...CELL,textAlign:"center"}}>{s.size}</td>
                <td style={{...CELL,textAlign:"center"}}>{s.pairs || ""}</td>
                {si === 0 && <>
                  <td style={{...CELL,textAlign:"center"}} rowSpan={rows}>{g.cartons || ""}</td>
                  <td style={{...CELL,textAlign:"center",fontWeight:700}} rowSpan={rows}>
                    {cartonNumbers(g, total_cartons)}</td>
                </>}
              </tr>;
            });
          });
        })}
        {!lines.length && <tr><td style={{...CELL,textAlign:"center"}} colSpan={8}>No lines entered</td></tr>}
      </tbody>
      <tfoot>
        <tr>
          <td style={CELL} colSpan={4}>AUTH SIGN :-</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>TOTAL</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{total_pairs}</td>
          <td style={{...CELL,textAlign:"center",fontWeight:700}}>{total_cartons}</td>
          <td style={CELL}></td>
        </tr>
      </tfoot>
    </table>

    {cfg.footer_note && <div style={{fontSize:9,color:"#444",textAlign:"center",marginTop:6}}>{cfg.footer_note}</div>}

    {!list.ok && <div data-noprint style={{marginTop:10,padding:"8px 10px",border:"1px solid #FECDD3",
        background:"#FFF1F2",color:"#9F1239",fontSize:11.5,borderRadius:6}}>
      <b>This sheet does not add up yet</b>
      <ul style={{margin:"4px 0 0 16px",padding:0}}>
        {list.problems.slice(0,8).map((p,i)=><li key={i}>{p}</li>)}
      </ul>
    </div>}
  </div>;
}

/* The sheet prints 15-04-2026. */
function fmtDate(iso){
  if(!iso) return "";
  const d = String(iso).slice(0,10).split("-");
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : String(iso);
}
