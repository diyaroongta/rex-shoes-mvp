/* Stock workbook round-trip.
 * Calculated columns remain in the workbook for the store team, but only
 * maintained inputs are read back. Stock, alert, order quantity and value are
 * always recalculated by Factory OS.
 */

export const STOCK_INPUT_HEADERS = [
  "S.N","MATERIAL KEY","CATEGORY","ITEM DESCRIPTION","SIZE","UOM",
  "OPENING STOCK","TOTAL RECEIVED","TOTAL ISSUED","STOCK",
  "MIN. STOCK","ALERT","ORDER QUANTITY","RATE","STOCK VALUE",
];

const clean = value => String(value == null ? "" : value).replace(/\s+/g," ").trim();
const keyOf = value => clean(value).toUpperCase();
const number = (value, label, rowNo, problems) => {
  if(value === "" || value == null) return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0){ problems.push(`Row ${rowNo}: ${label} must be 0 or more`); return null; }
  return n;
};

export function stockSheetRows(rows=[]){
  return [STOCK_INPUT_HEADERS,...rows.map(r=>[
    r.sn,r.key,r.category||"",r.name,r.size||"",r.uom,
    r.opening,r.rec,r.issue,r.stock,r.min,r.alert?"LOW":"",r.order_qty,r.rate,r.value,
  ])];
}

/* Matching prefers the protected material key, with description + UOM as a
   fallback for older exported stock sheets. */
export function stockPatchFromRows(uploaded=[], current=[]){
  const problems=[];
  const byKey=new Map(current.map(r=>[keyOf(r.key),r]));
  const byName=new Map(current.map(r=>[`${keyOf(r.name)}||${keyOf(r.uom)}`,r]));
  const seen=new Set(),patch={},changes=[];

  for(let i=0;i<uploaded.length;i++){
    const row=uploaded[i]||{},rowNo=i+2;
    const materialKey=row["MATERIAL KEY"] ?? row["Material Key"] ?? "";
    const name=row["ITEM DESCRIPTION"] ?? row["Item Description"] ?? "";
    const uom=row.UOM ?? row.Uom ?? "";
    const currentRow=byKey.get(keyOf(materialKey))||byName.get(`${keyOf(name)}||${keyOf(uom)}`);
    if(!currentRow){
      if(clean(materialKey)||clean(name)) problems.push(`Row ${rowNo}: material was not found in Factory OS`);
      continue;
    }
    if(seen.has(currentRow.key)){ problems.push(`Row ${rowNo}: ${currentRow.name} appears more than once`); continue; }
    seen.add(currentRow.key);

    const next={};
    const category=clean(row.CATEGORY ?? row.Category);
    const size=clean(row.SIZE ?? row.Size);
    if(category!==clean(currentRow.category)) next.category=category;
    if(size!==clean(currentRow.size)) next.size=size;

    const fields=[
      ["opening",row["OPENING STOCK"] ?? row["Opening Stock"],"Opening stock",currentRow.opening],
      ["rec",row["TOTAL RECEIVED"] ?? row["REC."] ?? row.Received,"Total received",currentRow.rec],
      ["issue",row["TOTAL ISSUED"] ?? row.ISSUE ?? row.Issued,"Total issued",currentRow.issue],
      ["min",row["MIN. STOCK"] ?? row["MIN STOCK"] ?? row.Minimum,"Minimum stock",currentRow.min],
      ["rate",row.RATE ?? row.Rate,"Rate",currentRow.rate],
    ];
    for(const [field,value,label,was] of fields){
      const n=number(value,label,rowNo,problems);
      if(n!=null&&n!==Number(was||0)) next[field]=n;
    }
    if(Object.keys(next).length){ patch[currentRow.key]=next; changes.push({key:currentRow.key,name:currentRow.name,fields:Object.keys(next)}); }
  }
  return {ok:problems.length===0,problems,patch,changes};
}
