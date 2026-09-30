import { validatePurchaseOrder } from "./purchase-orders.js";

const text=value=>String(value==null?"":value).replace(/\s+/g," ").trim();
const header=value=>text(value).toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();

const FIELDS={
  group:["PO GROUP","GROUP","PO GROUP ID"],
  supplier:["SUPPLIER","SUPPLIER NAME","VENDOR","VENDOR NAME"],
  po_date:["PO DATE","PURCHASE ORDER DATE","ORDER DATE"],
  expected_on:["EXPECTED DELIVERY","EXPECTED DELIVERY DATE","EXPECTED DATE","DELIVERY DATE"],
  additional_information:["ADDITIONAL INFORMATION","ADDITIONAL INFO","NOTES","REMARKS"],
  material_key:["MATERIAL KEY","MATERIAL CODE","ITEM CODE"],
  name:["MATERIAL NAME","ITEM NAME","MATERIAL","ITEM"],
  uom:["UOM","UNIT","UNIT OF MEASURE"],
  ordered_qty:["ORDER QUANTITY","ORDER QTY","QUANTITY","QTY"],
  rate:["RATE","UNIT RATE","PRICE","UNIT PRICE"],
};

function excelDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  if(typeof value==="number"&&Number.isFinite(value)){
    const d=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);
    return d.toISOString().slice(0,10);
  }
  const raw=text(value);
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)){
    const [y,m,d]=raw.split("-").map(Number);
    return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  const match=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(match)return `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  return raw;
}

function columnMap(row=[]){
  const normalized=row.map(header), result={};
  for(const [field,aliases] of Object.entries(FIELDS)){
    const index=normalized.findIndex(value=>aliases.includes(value));
    if(index>=0)result[field]=index;
  }
  return result;
}

function oneValue(rows,field,label,convert=text){
  const values=rows.map(row=>convert(row[field])).filter(Boolean);
  const unique=[...new Set(values)];
  return unique.length>1?{error:`${label} conflicts within this PO group: ${unique.join(" / ")}`}:{value:unique[0]||""};
}

/** Parse one worksheet represented as an array of rows.
 * One PO GROUP becomes one purchase order. Commercial fields may be entered
 * once anywhere in a group; material rows never inherit quantities or rates.
 */
export function parsePurchaseOrderRows(matrix=[],materials=[]){
  const errors=[], warnings=[];
  if(!Array.isArray(matrix)||!matrix.length)return {purchase_orders:[],errors:["The workbook is empty"],warnings,row_count:0};
  let headerIndex=-1, columns={};
  for(let i=0;i<Math.min(matrix.length,25);i++){
    const candidate=columnMap(Array.isArray(matrix[i])?matrix[i]:[]);
    if(candidate.group!=null&&candidate.supplier!=null&&candidate.ordered_qty!=null){headerIndex=i;columns=candidate;break;}
  }
  if(headerIndex<0)return {purchase_orders:[],errors:["Could not find the PO upload headings. Use the downloaded Factory OS template."],warnings,row_count:0};
  for(const required of ["group","supplier","po_date","material_key","name","uom","ordered_qty"])
    if(columns[required]==null)errors.push(`Missing required column: ${FIELDS[required][0]}`);
  if(errors.length)return {purchase_orders:[],errors,warnings,row_count:0};

  const masterByKey=new Map(), masterByNameUnit=new Map();
  for(const material of materials||[]){
    const key=text(material.material_key), name=text(material.name), uom=text(material.uom).toUpperCase();
    if(key)masterByKey.set(key.toUpperCase(),{...material,material_key:key,name,uom});
    if(name&&uom)masterByNameUnit.set(`${name.toUpperCase()}||${uom}`,{...material,material_key:key,name,uom});
  }

  const rawRows=[];let previousGroup="";
  for(let i=headerIndex+1;i<matrix.length;i++){
    const row=Array.isArray(matrix[i])?matrix[i]:[];
    if(row.every(value=>text(value)===""))continue;
    const get=field=>columns[field]==null?"":row[columns[field]];
    const enteredGroup=text(get("group"));if(enteredGroup)previousGroup=enteredGroup;
    const group=enteredGroup||previousGroup;
    if(!group){errors.push(`Row ${i+1}: PO GROUP is required`);continue;}
    rawRows.push({row_number:i+1,group,supplier:get("supplier"),po_date:get("po_date"),
      expected_on:get("expected_on"),additional_information:get("additional_information"),
      material_key:get("material_key"),name:get("name"),uom:get("uom"),
      ordered_qty:get("ordered_qty"),rate:get("rate")});
  }
  if(!rawRows.length)errors.push("There are no purchase-order lines below the headings");

  const grouped=new Map();
  for(const row of rawRows){if(!grouped.has(row.group))grouped.set(row.group,[]);grouped.get(row.group).push(row);}
  if(grouped.size>50)errors.push("One upload can create at most 50 purchase orders");
  const purchase_orders=[];
  for(const [group,rows] of grouped){
    const supplier=oneValue(rows,"supplier",`${group} supplier`);
    const poDate=oneValue(rows,"po_date",`${group} PO date`,excelDate);
    const expected=oneValue(rows,"expected_on",`${group} expected delivery`,excelDate);
    const additional=oneValue(rows,"additional_information",`${group} additional information`);
    for(const answer of [supplier,poDate,expected,additional])if(answer.error)errors.push(answer.error);
    const lines=[];
    for(const row of rows){
      const enteredKey=text(row.material_key), enteredName=text(row.name), enteredUom=text(row.uom).toUpperCase();
      const material=(enteredKey&&masterByKey.get(enteredKey.toUpperCase()))||
        (enteredName&&enteredUom&&masterByNameUnit.get(`${enteredName.toUpperCase()}||${enteredUom}`));
      if(!material){errors.push(`Row ${row.row_number}: material is not in Factory OS. Keep the downloaded MATERIAL KEY unchanged.`);continue;}
      const qty=Number(row.ordered_qty), rawRate=text(row.rate), rate=rawRate===""?undefined:Number(row.rate);
      if(!Number.isFinite(qty)||qty<=0){errors.push(`Row ${row.row_number}: ORDER QUANTITY must be more than 0`);continue;}
      if(rawRate!==""&&(!Number.isFinite(rate)||rate<0)){errors.push(`Row ${row.row_number}: RATE must be 0 or more`);continue;}
      lines.push({material_key:material.material_key,name:material.name,uom:material.uom,
        ordered_qty:qty,...(rate==null?{}:{rate})});
    }
    if(supplier.error||poDate.error||expected.error||additional.error)continue;
    const draft={supplier:supplier.value,po_date:poDate.value,expected_on:expected.value||null,
      additional_information:additional.value,lines};
    const checked=validatePurchaseOrder(draft);
    if(!checked.ok)errors.push(`${group}: ${checked.error}`);
    else purchase_orders.push({...checked.value,upload_group:group});
  }
  return {purchase_orders,errors:[...new Set(errors)],warnings,row_count:rawRows.length};
}

export const PURCHASE_ORDER_TEMPLATE_HEADERS=["PO GROUP","SUPPLIER","PO DATE","EXPECTED DELIVERY",
  "ADDITIONAL INFORMATION","MATERIAL KEY","MATERIAL NAME","UOM","ORDER QUANTITY","RATE"];
