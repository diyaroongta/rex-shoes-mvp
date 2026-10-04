/* THE FACTORY'S OWN SHEETS, BUILT FROM THE SYSTEM.
 *
 * Each builder returns plain rows ([[header...], [cells...]]) so it can be
 * tested without a spreadsheet library, and the screen writes them with XLSX.
 * Nothing here invents a figure: a column the system does not know (a
 * physical count, a supplier's rate that was never entered) is left BLANK for
 * the factory to fill, never zero.
 *
 * Pure: no database, no clock — dates are passed in.
 */
import { fromDay, dayIndex, workCalendar } from "./engine.js";
import { draftFromOrder, buildPackingList } from "./packing-list.js";

const r0 = n => Math.round(Number(n) || 0);
const WEEKDAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* 1. PRODUCTION PLANNING SHEET — machine by machine, day by day, the way the
   factory's weekly plan reads ("Vertical M/C 1 · GOLA BLK · ALL SIZES · 500").
   From the live plan, so it is the plan, not a copy of it. Off days (Sundays,
   holidays) carry a row saying so, because a blank Sunday looks like a gap. */
export function planningSheet(state, origin, from, to, workcenters = {}, calendar = null){
  const { off } = workCalendar(calendar, origin);
  const header = ["Date","Day","Machine","Stage","Job card","Order","Party","Article","Size ranges","Planned pairs","Achieved pairs","Remarks"];
  const rows = [];
  const a = dayIndex(from, origin), b = dayIndex(to, origin);
  const units = (state && state.units && state.units.length ? state.units : (state && state.orders) || []);
  for(let d = a; d <= b; d++){
    const iso = fromDay(d, origin), day = WEEKDAY[new Date(iso + "T00:00:00Z").getUTCDay()];
    if(off(d)){ rows.push([iso, day, "— factory shut —", "", "", "", "", "", "", "", "", ""]); continue; }
    const today = [];
    for(const u of units) for(const st of u.stages || []){
      const pairs = st.alloc && st.alloc[d];
      if(!pairs || !st.work_center) continue;
      today.push([iso, day, (workcenters[st.work_center] || {}).name || st.work_center, st.stage,
        u.card_no || "", u.order_no, u.party || "", u.article || "",
        (u.lines || []).map(l => l.combo).join(", "), r0(pairs), "", ""]);
    }
    today.sort((x, y) => String(x[2]).localeCompare(String(y[2])) || String(x[5]).localeCompare(String(y[5])));
    rows.push(...today);
  }
  return [header, ...rows];
}

/* 2. MTS STOCK SHEET — the shelf, size by size, with the book figure filled in
   and a blank PHYSICAL COUNT beside it. Uploaded back on Finished goods →
   Enter stock (as opening stock, or as a count adjustment). */
export function mtsStockSheet(stock, articleSizes = () => [], date = ""){
  const header = ["Article","Size","Book stock","Physical count","Pairs","Kind","Date","Note"];
  const rows = [];
  for(const a of (stock && stock.articles) || []){
    const have = Object.fromEntries(a.size_list.map(s => [s.size, s.pairs]));
    const sizes = [...new Set([...articleSizes(a.article), ...Object.keys(have)])];
    for(const size of sizes) rows.push([a.article, size, have[size] || 0, "", "", "adjust", date, ""]);
  }
  return [header, ...rows];
}
/* A blank one for articles with nothing recorded yet — the opening count. */
export function mtsOpeningSheet(articles = [], articleSizes = () => [], date = ""){
  const header = ["Article","Size","Book stock","Physical count","Pairs","Kind","Date","Note"];
  const rows = [];
  for(const art of articles) for(const size of articleSizes(art)) rows.push([art, size, 0, "", "", "opening", date, ""]);
  return [header, ...rows];
}

/* 3. MTO STOCK SHEET. */
export function mtoStockSheet(mto){
  return [["Order","Party","Article","Ordered","Packed","Shipped","Ready to ship","Still to make"],
    ...((mto && mto.rows) || []).map(r => [r.order_no, r.party, r.article, r.ordered, r.packed, r.dispatched, r.ready, r.to_make])];
}

/* 4. PACKING REPORT SHEET — for one order, filled from the order's own sizes
   (what is still owed), cartons left blank: they are counted. */
export function packingReportSheet(order, sizesFor, previous = []){
  const leaving = {};
  for(const l of (order && order.lines) || []) leaving[l.combo] = r0(l.qty);
  const draft = draftFromOrder(order, sizesFor, leaving, previous);
  const header = ["S.No","Article","Closure","Colour","Size range","Size","Pairs","Cartons (counted)","C/N"];
  const rows = [];
  draft.lines.forEach((line, i) => {
    for(const g of line.groups) for(const s of g.sizes)
      rows.push([i + 1, line.article, line.closure, line.colour, line.combo, s.size, s.pairs, "", ""]);
  });
  const total = rows.reduce((a, r) => a + r0(r[6]), 0);
  return [["PACKING LIST"], ["Customer", draft.customer, "", "Order No", draft.order_no, "", "Order qty", draft.order_qty || ""],
    ["Date", "", "", "Dispatch qty", total], [], header, ...rows, [], ["", "", "", "", "", "TOTAL", total, "", ""]];
}

/* 6. Purchase orders live in shared/purchase-orders.js (Procurement). */

/* 7. PRODUCTION / PACKING JOB CARD — the card as issued, with the columns the
   floor fills in (received, rejected, repair, cartons) blank, or filled from
   what was already recorded against it. */
export function jobCardSheet(job, recorded = []){
  const card = (job && job.card) || {};
  const rec = { rejected:0, repair:0, cartons:0, actual:0 };
  for(const r of recorded || []){ rec.rejected += r0(r.rejected_pairs); rec.repair += r0(r.repair_pairs); rec.cartons += r0(r.cartons); rec.actual += r0(r.actual_pairs); }
  const rows = [["JOB CARD", "", "", card.card_no || `#${job && job.id}`],
    ["Date", card.date || (job && job.issued_on) || "", "", "Order", (job && job.order_no) || "For stock"],
    ["Article", (job && job.article) || "", "", "Stage", (job && job.stage) || ""],
    ["Issued to", (job && job.fabricator) || ""], [],
    ["Size range","Size","Issued","Received","Rejected","Repair","Cartons","Remarks"]];
  for(const l of card.lines || [])
    for(const [size, q] of Object.entries(l.sizes || {})) if(r0(q)) rows.push([l.combo, size, r0(q), "", "", "", "", ""]);
  rows.push([], ["Recorded so far", "", r0(job && job.qty), rec.actual || "", rec.rejected || "", rec.repair || "", rec.cartons || ""],
    [], ["Supervisor", "", "", "Signature", ""]);
  return rows;
}

/* Re-exported so the screen can total a sheet the same way dispatch does. */
export { buildPackingList };
