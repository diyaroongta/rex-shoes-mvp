import { matchArticle, articleTypeCombos, comboSizesForArticle, pairsPerCarton } from "./bridge.js";

/* Bulk order import from a spreadsheet. Pure — no xlsx dependency, no I/O.
   Takes rows already read out of a sheet (array of arrays) and returns order
   drafts plus per-row errors.

   TEMPLATE (row 1 is the header; column order does not matter, names do):
     Party            required  customer name
     Order Date       required  YYYY-MM-DD, or a real Excel date cell
     Article          required  must match a known article exactly
     Size Range       required  a combo code for that article, e.g. 6X8
     Cartons          one of    cartons, converted with the packing chart
     Pairs            one of    pairs directly (wins if both are given)
     Priority         optional  integer >= 1, default 2
     Order Nature     optional  MTS / Institutional / MTO
     Remarks          optional  free text

   Rows sharing the same Party + Order Date + Article are merged into one order
   with several size lines, which is how the factory actually writes them. */

export const ORDER_TEMPLATE_HEADERS = [
  "Party","Order Date","Article","Size Range","Cartons","Pairs","Priority","Order Nature","Remarks",
];

export const ORDER_WIDE_BASE_HEADERS = [
  "PI No","Party","Order Date","Article","Priority","Order Nature","Print","V/L","Sole Colour","Upper Colour","Remarks",
];

/* The current template is deliberately wide: one article occupies one row and
   every size range is a quantity column. The legacy long template remains
   readable so old files do not break. */
export function wideTemplateHeaders(reference){
  const articles=(reference&&reference.articles)||{};
  const combos=[];
  for(const a of Object.values(articles))
    for(const c of (a.combo_order||Object.keys(a.combos||{}))) if(!combos.includes(c)) combos.push(c);
  return [...ORDER_WIDE_BASE_HEADERS,...combos.map(c=>`Pairs ${c}`)];
}

const norm = h => String(h||"").toLowerCase().replace(/[^a-z]/g,"");
const HEADER_ALIASES = {
  party:"party", customer:"party", customername:"party",
  pino:"pi_no",
  orderdate:"order_date", date:"order_date",
  article:"article", articlecode:"article", articlename:"article", product:"article",
  city:"city", customercity:"city",
  colour:"upper_colour", color:"upper_colour",
  sizerange:"combo", combo:"combo", size:"combo",
  cartons:"cartons", ctn:"cartons", carton:"cartons",
  pairs:"pairs", qty:"pairs", quantity:"pairs",
  priority:"priority", prio:"priority",
  ordernature:"order_nature", nature:"order_nature",
  print:"printing", printing:"printing", printrequired:"printing",
  vl:"vl", velcrolace:"vl", lacevelcro:"vl",
  solecolour:"sole_colour", solecolor:"sole_colour",
  sole:"sole_type",
  currentstatus:"current_status", currentstatuso:"current_status", status:"current_status",
  estimateddispatchdate:"estimated_dispatch_date", estdispatchdate:"estimated_dispatch_date",
  uppercolour:"upper_colour", uppercolor:"upper_colour",
  remarks:"remarks", remark:"remarks", notes:"remarks",
};

const yes = v => /^(yes|y|true|1)$/i.test(String(v||"").trim());

const headerRowIndex = rows => (rows||[]).findIndex(r =>
  (r||[]).some(c => HEADER_ALIASES[norm(c)] === "article"));

/* Workbooks often contain a Read me, summary, or print sheet beside the actual
   order tabs. Those sheets are not malformed orders and must not block an
   otherwise valid batch. Keep this aggregation pure so the browser workflow is
   covered by the same regression tests as the row parser. */
export function parseOrderWorkbook(sheets, reference, packing = {}){
  const combined={orders:[],errors:[],warnings:[],rowCount:0};
  let orderSheets=0;
  for(const sheet of (sheets||[])){
    const rows=(sheet&&sheet.rows)||[];
    if(headerRowIndex(rows)<0) continue;
    orderSheets++;
    const sheetName=String((sheet&&sheet.sheetName)||"");
    const parsed=parseOrderSheet(rows,reference,packing,{sheetName});
    combined.orders.push(...parsed.orders);
    combined.errors.push(...parsed.errors.map(e=>({...e,error:`${sheetName?sheetName+": ":""}${e.error}`})));
    combined.warnings.push(...(parsed.warnings||[]));
    combined.rowCount+=parsed.rowCount;
  }
  if(!orderSheets) combined.errors.push({row:0,error:'No order sheet found — include a column named "Article" or "Article Name".'});
  return combined;
}

/* Excel serial dates come through as numbers; convert without a date library. */
function toIsoDate(v){
  if(v == null || v === "") return null;
  if(typeof v === "number" && isFinite(v)){
    const ms = Math.round((v - 25569) * 86400 * 1000);   // Excel epoch -> Unix
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0,10);
  }
  const s = String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(dmy){                                    // Indian sheets write day first
    let [,d,m,y] = dmy;
    if(y.length === 2) y = "20" + y;
    const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }
  const parsed = new Date(s);
  return isNaN(parsed) ? null : parsed.toISOString().slice(0,10);
}

function orderBookSizeColumns(headers){
  const candidates=[];
  for(let i=0;i<headers.length;i++){
    const raw=String(headers[i]??"").trim().toLowerCase();
    if(/^\d+(?:\.5)?s$/.test(raw)) candidates.push({index:i,raw,kids:true,size:raw.replace(/s$/i,"")});
    else if(/^\d+(?:\.5)?$/.test(raw)) candidates.push({index:i,raw,kids:null,size:raw});
  }
  const firstAdultOne=candidates.findIndex(c=>c.kids==null&&c.size==="1");
  const hasNumericKids=firstAdultOne>0 && candidates.slice(0,firstAdultOne).some(c=>c.size==="6");
  return candidates.map((c,n)=>({...c,kids:c.kids==null?(hasNumericKids&&n<firstAdultOne):c.kids,
    key:(c.kids==null?(hasNumericKids&&n<firstAdultOne):c.kids)?c.size+"s":c.size}));
}

function parseOrderBook(rows,headerRow,map,reference,opts){
  const articles=(reference&&reference.articles)||{};
  const headers=rows[headerRow]||[];
  const sizeCols=orderBookSizeColumns(headers);
  const out={orders:[],errors:[],warnings:[],rowCount:0};
  const get=(r,k)=>map[k]==null?null:r[map[k]];
  const nature=/mto/i.test(opts.sheetName||"")?"MTO":/institution/i.test(opts.sheetName||"")?"Institutional":"";
  for(let i=headerRow+1;i<rows.length;i++){
    const r=rows[i]||[]; const row=i+1;
    if(!r.some(v=>v!=null&&String(v).trim()!=="")) continue;
    const rawArticle=String(get(r,"article")||"").trim();
    if(!rawArticle || /^total$/i.test(rawArticle)) continue;
    out.rowCount++;
    const direct=Object.keys(articles).find(a=>a.toUpperCase()===rawArticle.toUpperCase());
    const article=direct||matchArticle(rawArticle,"");
    if(!article||!articles[article]){out.errors.push({row,error:`${opts.sheetName?opts.sheetName+": ":""}Unknown article "${rawArticle}" — add its catalogue/BOM before importing`});continue;}
    const party=String(get(r,"party")||"").trim();
    const date=toIsoDate(get(r,"order_date"));
    if(!party||!date){out.errors.push({row,error:`${opts.sheetName?opts.sheetName+": ":""}${!party?"Customer is blank":"Order date is blank or unreadable"}`});continue;}
    const vl=String(get(r,"vl")||"").trim();
    const combos=articleTypeCombos(article,vl);
    const lines=[];
    const unsupported=[];
    for(const sc of sizeCols){
      const qty=Number(r[sc.index]);
      if(!Number.isFinite(qty)||qty<=0) continue;
      const combo=combos.find(c=>comboSizesForArticle(article,c,vl).includes(sc.key));
      if(!combo){unsupported.push(sc.key);continue;}
      let line=lines.find(l=>l.combo===combo);
      if(!line){line={combo,qty:0,label:combo,sizes:{},size_order:comboSizesForArticle(article,combo,vl),ppc:pairsPerCarton(article,combo)};lines.push(line);}
      line.sizes[sc.key]=(line.sizes[sc.key]||0)+qty; line.qty+=qty;
    }
    if(unsupported.length){out.errors.push({row,error:`${article}: sizes ${unsupported.join(", ")} do not match its ${vl||"selected"} packing ranges`});continue;}
    if(!lines.length){out.errors.push({row,error:`${article}: no positive supported size quantities`});continue;}
    out.orders.push({
      order_date:date,article_code:article,party,priority:Math.max(1,Math.round(Number(get(r,"priority"))||2)),lines,
      printing:yes(get(r,"printing")),
      pi:{pi_no:String(get(r,"pi_no")||"").trim()||undefined,customer_city:String(get(r,"city")||"").trim()||undefined,
        order_nature:nature||undefined,vl:vl||undefined,sole_type:String(get(r,"sole_type")||"").trim()||undefined,
        sole_colour:String(get(r,"sole_colour")||"").trim()||undefined,upper_colour:String(get(r,"upper_colour")||"").trim()||undefined,
        current_status:String(get(r,"current_status")||"").trim()||undefined,printing:yes(get(r,"printing"))}
    });
  }
  return out;
}

export function parseOrderSheet(rows, reference, packing = {}, opts={}){
  const articles = (reference && reference.articles) || {};
  const out = { orders: [], errors: [], warnings: [], rowCount: 0 };
  if(!rows || !rows.length){ out.errors.push({ row:0, error:"The sheet is empty." }); return out; }

  const headerRow = headerRowIndex(rows);
  if(headerRow < 0){
    out.errors.push({ row:0, error:'No header row found — it must include a column named "Article".' });
    return out;
  }
  const map = {};
  (rows[headerRow]||[]).forEach((c,i) => { const k = HEADER_ALIASES[norm(c)]; if(k) map[k] = i; });
  const allCombos=[...new Set(Object.values(articles).flatMap(a=>a.combo_order||Object.keys(a.combos||{})))];
  const comboCols=[];
  (rows[headerRow]||[]).forEach((c,i)=>{
    const token=String(c||"").toUpperCase().trim().replace(/^PAIRS?\s*[:\-]?\s*/,"").replace(/\s+/g,"");
    if(allCombos.includes(token)) comboCols.push({combo:token,index:i});
  });
  const wide=comboCols.length>0 && map.combo==null;
  const orderBook=!wide && map.combo==null && orderBookSizeColumns(rows[headerRow]||[]).length>0;
  if(orderBook) return parseOrderBook(rows,headerRow,map,reference,opts);
  for(const req of ["party","order_date","article",...(wide?[]:["combo"])]){
    if(map[req] == null) out.errors.push({ row:headerRow+1, error:`Missing required column: ${req.replace("_"," ")}` });
  }
  if(out.errors.length) return out;

  const get = (r,k) => map[k] == null ? null : r[map[k]];
  const buckets = new Map();

  for(let i = headerRow + 1; i < rows.length; i++){
    const r = rows[i] || [];
    const rowNo = i + 1;
    if(!r.some(c => c != null && String(c).trim() !== "")) continue;   // blank line
    out.rowCount++;

    const party   = String(get(r,"party")   || "").trim();
    const article = String(get(r,"article") || "").trim().toUpperCase();
    const combo   = wide ? "" : String(get(r,"combo")||"").trim().toUpperCase().replace(/\s+/g,"");
    const date    = toIsoDate(get(r,"order_date"));

    // The downloadable wide template has one pre-labelled row per article.
    // An untouched row is a placeholder, not a malformed order.
    if(wide && article && !party && !get(r,"order_date")
       && !comboCols.some(c=>Number(r[c.index])>0)){ out.rowCount--; continue; }

    if(!party)   { out.errors.push({ row:rowNo, error:"Party is blank" }); continue; }
    if(!date)    { out.errors.push({ row:rowNo, error:`Could not read the order date "${get(r,"order_date")}"` }); continue; }
    if(!articles[article]) { out.errors.push({ row:rowNo, error:`Unknown article "${article}"` }); continue; }

    const combos = articles[article].combo_order || Object.keys(articles[article].combos || {});
    if(!wide && !combos.includes(combo)){
      out.errors.push({ row:rowNo, error:`"${combo}" is not a size range of ${article} (has: ${combos.join(", ")})` });
      continue;
    }

    if(wide){
      const lines=[];
      for(const c of comboCols){
        if(!combos.includes(c.combo)) continue;
        const qty=Number(r[c.index]);
        if(Number.isFinite(qty)&&qty>0) lines.push({combo:c.combo,qty,label:c.combo});
      }
      if(!lines.length){ out.errors.push({row:rowNo,error:`Enter pairs in at least one size column for ${article}`}); continue; }
      const requiredMeta=[["Order Nature","order_nature"],["V/L","vl"],["Sole Colour","sole_colour"],["Upper Colour","upper_colour"]];
      const missingMeta=requiredMeta.filter(([,k])=>!String(get(r,k)||"").trim()).map(([label])=>label);
      if(missingMeta.length){ out.errors.push({row:rowNo,error:`Complete ${missingMeta.join(", ")} for ${article}`}); continue; }
      out.orders.push({order_date:date,article_code:article,party,
        priority:Math.max(1,Math.round(Number(get(r,"priority"))||2)), lines,
        printing:yes(get(r,"printing")),
        pi:{pi_no:String(get(r,"pi_no")||"").trim()||undefined,
          customer_city:String(get(r,"city")||"").trim()||undefined,
          order_nature:String(get(r,"order_nature")||"").trim()||undefined,
          vl:String(get(r,"vl")||"").trim()||undefined,
          sole_type:String(get(r,"sole_type")||"").trim()||undefined,
          sole_colour:String(get(r,"sole_colour")||"").trim()||undefined,
          upper_colour:String(get(r,"upper_colour")||"").trim()||undefined,
          current_status:String(get(r,"current_status")||"").trim()||undefined,
          printing:yes(get(r,"printing")),
          remarks:String(get(r,"remarks")||"").trim()||undefined}});
      continue;
    }

    // Legacy long format: pairs wins when both are given.
    let pairs = Number(get(r,"pairs"));
    if(!isFinite(pairs) || pairs <= 0){
      const cartons = Number(get(r,"cartons"));
      const ppc = (packing[article] || {})[combo];
      if(!isFinite(cartons) || cartons <= 0){
        out.errors.push({ row:rowNo, error:"Give either Pairs or Cartons" }); continue;
      }
      if(ppc == null){
        out.errors.push({ row:rowNo, error:`No pairs-per-carton on file for ${article} ${combo} — enter Pairs directly` });
        continue;
      }
      pairs = cartons * ppc;
    }

    const priority = Math.max(1, Math.round(Number(get(r,"priority")) || 2));
    const piNo=String(get(r,"pi_no")||"").trim();
    const vl=String(get(r,"vl")||"").trim();
    const soleColour=String(get(r,"sole_colour")||"").trim();
    const upperColour=String(get(r,"upper_colour")||"").trim();
    // PI identity wins. Without it, two different PIs for the same customer,
    // date and article collapsed into one order and lost their line boundary.
    const key = piNo
      ? `PI||${piNo}||${article}||${vl}||${soleColour}||${upperColour}`
      : `${party}||${date}||${article}||${vl}||${soleColour}||${upperColour}`;
    if(!buckets.has(key)) buckets.set(key, {
      order_date: date, article_code: article, party, priority,
      lines: [],
      pi: {
        pi_no:        piNo || undefined,
        customer_city:String(get(r,"city")||"").trim() || undefined,
        order_nature: String(get(r,"order_nature")||"").trim() || undefined,
        vl:           vl || undefined,
        sole_type:    String(get(r,"sole_type")||"").trim() || undefined,
        sole_colour:  soleColour || undefined,
        upper_colour: upperColour || undefined,
        current_status:String(get(r,"current_status")||"").trim() || undefined,
        printing:     yes(get(r,"printing")),
        remarks:      String(get(r,"remarks")||"").trim()      || undefined,
      },
      printing: yes(get(r,"printing")),
    });
    const b = buckets.get(key);
    const existing = b.lines.find(l => l.combo === combo);
    if(existing) existing.qty += pairs;                 // same combo twice = add
    else b.lines.push({ combo, qty: pairs, label: combo });
  }

  if(!wide) out.orders = [...buckets.values()].filter(o => o.lines.length);
  return out;
}
