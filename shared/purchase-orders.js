/* Purchase-order validation and progress arithmetic.
 *
 * Pure and shared by the browser, API and tests. A PO is about material units
 * (metres, kilograms, pairs, pieces), so quantities may be decimal; they must
 * still be finite and positive. Receipt totals are derived from the immutable
 * receipt log rather than trusted from a status field stored by the browser.
 */

const text = value => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

export function realDate(value){
  const s=text(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d]=s.split("-").map(Number), date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}

const number = (value,label,{positive=false}={}) => {
  const n=Number(value);
  if(!Number.isFinite(n) || (positive?n<=0:n<0))
    throw new Error(`${label} must be ${positive?"more than 0":"0 or more"}`);
  return Math.round(n*10000)/10000;
};

export function validatePurchaseOrder(input={}){
  try{
    const supplier=text(input.supplier);
    if(!supplier) throw new Error("Supplier is required");
    if(supplier.length>200) throw new Error("Supplier must be 200 characters or fewer");
    const po_date=text(input.po_date);
    if(!realDate(po_date)) throw new Error("PO date must be a real date");
    const expected_on=text(input.expected_on);
    if(expected_on && !realDate(expected_on)) throw new Error("Expected date must be a real date");
    if(expected_on && expected_on<po_date) throw new Error("Expected date cannot be before the PO date");
    const additional_information=text(input.additional_information);
    if(additional_information.length>2000)
      throw new Error("Additional information must be 2,000 characters or fewer");
    if(!Array.isArray(input.lines)||!input.lines.length) throw new Error("Add at least one material");
    if(input.lines.length>100) throw new Error("A PO can contain at most 100 materials");
    const seen=new Set(), lines=input.lines.map((line,index)=>{
      const material_key=text(line.material_key), name=text(line.name), uom=text(line.uom).toUpperCase();
      if(!material_key||!name||!uom) throw new Error(`Line ${index+1} needs a material and unit`);
      if(seen.has(material_key)) throw new Error(`${name} appears more than once`);
      seen.add(material_key);
      const ordered_qty=number(line.ordered_qty,`${name} quantity`,{positive:true});
      const rate=line.rate==null||text(line.rate)===""?null:number(line.rate,`${name} rate`);
      return {material_key,name,uom,ordered_qty,...(rate==null?{}:{rate})};
    });
    return {ok:true,value:{supplier,po_date,expected_on:expected_on||null,
      additional_information,lines}};
  }catch(error){ return {ok:false,error:error.message||String(error)}; }
}

export function receivedByMaterial(receipts=[]){
  const totals={};
  for(const receipt of receipts||[])
    for(const line of receipt.lines||[]){
      const key=text(line.material_key);
      if(key) totals[key]=(totals[key]||0)+(Number(line.quantity)||0);
    }
  return totals;
}

export function purchaseOrderProgress(order={}){
  const received=receivedByMaterial(order.receipts||[]);
  const lines=(order.lines||[]).map(line=>{
    const ordered=Number(line.ordered_qty)||0;
    const got=Math.min(ordered,Math.max(0,Number(received[line.material_key])||0));
    return {...line,received_qty:got,balance_qty:Math.max(0,ordered-got)};
  });
  const ordered_qty=lines.reduce((sum,line)=>sum+Number(line.ordered_qty||0),0);
  const received_qty=lines.reduce((sum,line)=>sum+line.received_qty,0);
  const balance_qty=lines.reduce((sum,line)=>sum+line.balance_qty,0);
  const value=lines.reduce((sum,line)=>sum+(Number(line.ordered_qty)||0)*(Number(line.rate)||0),0);
  const cancelled=String(order.status||"")==="cancelled";
  const status=cancelled?"cancelled":balance_qty<=1e-6?"received":received_qty>0?"partial":"open";
  return {...order,lines,ordered_qty,received_qty,balance_qty,value,status};
}

export function validatePurchaseReceipt(input={},order={}){
  try{
    const po_no=text(input.po_no);
    if(!po_no) throw new Error("PO number is required");
    const received_on=text(input.received_on);
    if(!realDate(received_on)) throw new Error("Receipt date must be a real date");
    const note=text(input.note);
    if(note.length>500) throw new Error("Receipt note must be 500 characters or fewer");
    if(!Array.isArray(input.lines)||!input.lines.length) throw new Error("Enter at least one received quantity");
    const progress=purchaseOrderProgress(order);
    const available=new Map(progress.lines.map(line=>[line.material_key,line]));
    const seen=new Set(), lines=[];
    for(const raw of input.lines){
      const material_key=text(raw.material_key), line=available.get(material_key);
      if(!line) throw new Error(`Material ${material_key||"(blank)"} is not on ${po_no}`);
      if(seen.has(material_key)) throw new Error(`${line.name} appears more than once in this receipt`);
      seen.add(material_key);
      const quantity=number(raw.quantity,`${line.name} received quantity`,{positive:true});
      if(quantity-line.balance_qty>1e-6)
        throw new Error(`${line.name}: only ${line.balance_qty} ${line.uom} remains on ${po_no}`);
      lines.push({material_key,quantity});
    }
    return {ok:true,value:{po_no,received_on,note,lines}};
  }catch(error){ return {ok:false,error:error.message||String(error)}; }
}

/* PO TRACKING — the three questions the buyer asks every morning:
     outstanding  POs still expecting goods (open or part received)
     received     POs that came in full
     pending      what is still to arrive, in units and in rupees, and how
                  much of it is already past its expected date
   Derived from the receipt log, like everything else here. */
export function purchaseOrderSummary(orders = [], today = ""){
  const live = (orders || []).map(purchaseOrderProgress);
  const outstanding = live.filter(o => o.status === "open" || o.status === "partial");
  const pendingValue = outstanding.reduce((sum, o) =>
    sum + o.lines.reduce((s, l) => s + (Number(l.balance_qty) || 0) * (Number(l.rate) || 0), 0), 0);
  const overdue = outstanding.filter(o => today && o.expected_on && String(o.expected_on).slice(0,10) < today);
  return {
    total: live.length,
    outstanding: outstanding.length,
    open: live.filter(o => o.status === "open").length,
    partial: live.filter(o => o.status === "partial").length,
    received: live.filter(o => o.status === "received").length,
    cancelled: live.filter(o => o.status === "cancelled").length,
    pending_lines: outstanding.reduce((n, o) => n + o.lines.filter(l => l.balance_qty > 1e-6).length, 0),
    pending_value: Math.round(pendingValue * 100) / 100,
    overdue: overdue.length,
    overdue_po_nos: overdue.map(o => o.po_no),
  };
}

/* THE PREFILLED PO TEMPLATE, filled from the stock register: one PO group per
   SUPPLIER, the supplier's rate (else the register rate), and where the
   supplier dispatches from. A material with no supplier recorded gets its own
   group with the supplier left BLANK — the upload then refuses it until a
   supplier is typed, rather than a PO going to nobody. */
export function templateRows(materials = [], stockMeta = {}, date = ""){
  const groups = new Map();
  const rows = [];
  for(const m of materials || []){
    const meta = stockMeta[m.material_key] || {};
    const supplier = String(meta.supplier || "").trim();
    const key = supplier || "\u0000unassigned";
    if(!groups.has(key)) groups.set(key, `PO-${groups.size + 1}`);
    const rate = meta.supplier_rate != null && meta.supplier_rate !== "" ? Number(meta.supplier_rate)
      : (m.rate != null ? Number(m.rate) : (meta.rate != null ? Number(meta.rate) : ""));
    rows.push([groups.get(key), supplier, date, "",
      meta.dispatch_location ? `Dispatch from: ${meta.dispatch_location}` : "",
      m.material_key, m.name, m.uom, Number(m.shortfall) || "", rate === 0 ? "" : rate]);
  }
  /* Same supplier together, unassigned last, so each PO reads as one block. */
  return rows.sort((a, z) => (a[1] === "") - (z[1] === "") || Number(a[0].slice(3)) - Number(z[0].slice(3)));
}
