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

const norm = h => String(h||"").toLowerCase().replace(/[^a-z]/g,"");
const HEADER_ALIASES = {
  party:"party", customer:"party", customername:"party",
  orderdate:"order_date", date:"order_date",
  article:"article", articlecode:"article", product:"article",
  sizerange:"combo", combo:"combo", size:"combo",
  cartons:"cartons", ctn:"cartons", carton:"cartons",
  pairs:"pairs", qty:"pairs", quantity:"pairs",
  priority:"priority", prio:"priority",
  ordernature:"order_nature", nature:"order_nature",
  remarks:"remarks", remark:"remarks", notes:"remarks",
};

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

export function parseOrderSheet(rows, reference, packing = {}){
  const articles = (reference && reference.articles) || {};
  const out = { orders: [], errors: [], rowCount: 0 };
  if(!rows || !rows.length){ out.errors.push({ row:0, error:"The sheet is empty." }); return out; }

  const headerRow = rows.findIndex(r => (r||[]).some(c => HEADER_ALIASES[norm(c)] === "article"));
  if(headerRow < 0){
    out.errors.push({ row:0, error:'No header row found — it must include a column named "Article".' });
    return out;
  }
  const map = {};
  (rows[headerRow]||[]).forEach((c,i) => { const k = HEADER_ALIASES[norm(c)]; if(k) map[k] = i; });
  for(const req of ["party","order_date","article","combo"]){
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
    const combo   = String(get(r,"combo")   || "").trim().toUpperCase().replace(/\s+/g,"");
    const date    = toIsoDate(get(r,"order_date"));

    if(!party)   { out.errors.push({ row:rowNo, error:"Party is blank" }); continue; }
    if(!date)    { out.errors.push({ row:rowNo, error:`Could not read the order date "${get(r,"order_date")}"` }); continue; }
    if(!articles[article]) { out.errors.push({ row:rowNo, error:`Unknown article "${article}"` }); continue; }

    const combos = articles[article].combo_order || Object.keys(articles[article].combos || {});
    if(!combos.includes(combo)){
      out.errors.push({ row:rowNo, error:`"${combo}" is not a size range of ${article} (has: ${combos.join(", ")})` });
      continue;
    }

    // Pairs wins when both are given — it needs no packing assumption.
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
    const key = `${party}||${date}||${article}`;
    if(!buckets.has(key)) buckets.set(key, {
      order_date: date, article_code: article, party, priority,
      lines: [],
      pi: {
        order_nature: String(get(r,"order_nature")||"").trim() || undefined,
        remarks:      String(get(r,"remarks")||"").trim()      || undefined,
      },
    });
    const b = buckets.get(key);
    const existing = b.lines.find(l => l.combo === combo);
    if(existing) existing.qty += pairs;                 // same combo twice = add
    else b.lines.push({ combo, qty: pairs, label: combo });
  }

  out.orders = [...buckets.values()].filter(o => o.lines.length);
  return out;
}
