/* Convert a PI-master snapshot back into the exact live-order shape consumed by
   the production engine. Pure and deliberately strict: a stale article or size
   range is reported instead of being silently scheduled without its BOM. */
export function ordersFromPiSnapshot(snapshot, reference){
  const source=Array.isArray(snapshot&&snapshot.orders)?snapshot.orders:[];
  const articles=(reference&&reference.articles)||{};
  const orders=[];
  const errors=[];
  const seen=new Set();

  for(let index=0;index<source.length;index++){
    const raw=source[index]||{};
    const label=`PI order ${index+1}`;
    const orderNo=String(raw.order_no||"").trim();
    const articleCode=String(raw.article_code||"").trim();
    const orderDate=raw.order_date instanceof Date
      ? raw.order_date.toISOString().slice(0,10) : String(raw.order_date||"").slice(0,10);
    const article=articles[articleCode];

    if(!orderNo){errors.push(`${label}: order number is missing`);continue;}
    if(seen.has(orderNo)){errors.push(`${label}: duplicate order number ${orderNo}`);continue;}
    seen.add(orderNo);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)){errors.push(`${orderNo}: order date is unreadable`);continue;}
    if(!article){errors.push(`${orderNo}: unknown article ${articleCode||"(blank)"}`);continue;}
    if(!Array.isArray(raw.lines)||!raw.lines.length){errors.push(`${orderNo}: no order lines`);continue;}

    const lines=[];
    let bad=false;
    for(const line of raw.lines){
      const combo=String((line&&line.combo)||"").trim();
      const qty=Number(line&&line.qty);
      if(!article.combos[combo]){errors.push(`${orderNo}: ${combo||"(blank)"} is not a size range of ${articleCode}`);bad=true;continue;}
      if(!(qty>0)){errors.push(`${orderNo}: ${combo} quantity must be above zero`);bad=true;continue;}
      lines.push({combo,qty,label:line.label||combo,
        ...(line.sizes&&typeof line.sizes==="object"?{sizes:line.sizes}:{}),
        ...(Array.isArray(line.size_order)?{size_order:line.size_order}:{}),
        ...(Number(line.ppc)>0?{ppc:Number(line.ppc)}:{})});
    }
    if(bad) continue;

    orders.push({
      order_no:orderNo,
      order_date:orderDate,
      article_code:articleCode,
      priority:Math.max(1,Math.round(Number(raw.priority)||2)),
      party:String(raw.party||"—"),
      lines,
      pi:raw.pi&&typeof raw.pi==="object"?{...raw.pi}:{},
    });
  }
  if(!source.length) errors.push("The PI snapshot contains no orders");
  return {orders,errors};
}

/* A PI is an audit snapshot, so syncing the current queue may replace matching
   orders but must never erase an older order merely because it is temporarily
   absent from the live schedule. */
export function mergePiSnapshot(existingSnapshot,liveOrders){
  const existing=Array.isArray(existingSnapshot&&existingSnapshot.orders)?existingSnapshot.orders:[];
  const merged=new Map();
  for(const order of existing) if(order&&order.order_no) merged.set(String(order.order_no),order);
  for(const order of (liveOrders||[])) if(order&&order.order_no) merged.set(String(order.order_no),order);
  return {...(existingSnapshot&&typeof existingSnapshot==="object"?existingSnapshot:{}),orders:[...merged.values()]};
}
