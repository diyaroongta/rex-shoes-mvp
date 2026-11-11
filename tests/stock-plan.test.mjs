/* Stock first: a new order is checked against finished goods and upper stock
 * before anything is put on a job card.
 *
 * The worked example these are built round (illustrative figures, not real
 * stock): REX GOLA (V), black, sizes 8 / 9 / 10 at 100 pairs each. Free at the
 * time: 60 pairs of size 8 in finished goods, 40 size-9 uppers. So 60 ship off
 * the shelf, 40 start at moulding and only 200 go through the whole routing.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { stockBalance, stockCheck, planReservations, releaseRows, reconcileAllocation, withOrdered,
         nextSizeUp, orderDemand, productionOrder, upperPairs, allocationSummary, dispatchPrefill,
         dispatchFromStock, checkWithdrawals, issueRowsFor, validateLock, validateReservationRow,
         outstandingFor, stockRegister, heldUppers, awaitingDecision, normalizeAllocation,
         fgPairs, splitLines, consumedFor, grantedFor } from "../shared/stock-plan.js";
import { productionUnits, releaseBalance, unitPairs, cardBalance, usesStock } from "../shared/production-units.js";
import { materialDone } from "../shared/material-demand.js";
import { materialTotals } from "../shared/bom-components.js";
import { pairsOf as customerPairs } from "../shared/customer-history.js";
import { buildMisSnapshot } from "../shared/mis.js";
import { compute, orderReq, route } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const ART = "REX GOLA (V)";
const ORDER = (over = {}) => ({ order_no:"JO5001", order_date:"2026-07-06", article_code:ART, priority:2,
  party:"Belgaum Traders", pi:{ upper_colour:"Black" },
  lines:[{ combo:"8X10B", qty:300, sizes:{ "8":100, "9":100, "10":100 } }], ...over });
const fgOpening = (size, qty, article = ART) => ({ article, size, qty, kind:"opening" });
const upperIn = (size, qty, over = {}) => ({ kind:"in", article:ART, colour:"BLACK", size, qty, mts:true,
  source_type:"line", source:"Line 1", status:"approved", moved_on:"2026-07-01", ...over });
const STOCK = (over = {}) => ({ finishedMoves:[fgOpening("8", 60)], upperMoves:[upperIn("9", 40)],
  reservations:[], locks:[], ...over });

/* What the server does with a decision: turn the planned rows into ledger rows. */
const decide = (order, input, stock) => {
  const plan = planReservations(order, input, stockBalance(stock), stock.reservations);
  return { plan, reservations:[...stock.reservations, ...plan.rows],
    order:{ ...order, stock_status:"decided", stock_allocation:withOrdered(plan.allocation, order) } };
};

console.log("\nA — on hand, reserved, free");
test("free is on hand less what is reserved", () => {
  const b = stockBalance(STOCK({ reservations:[
    { store:"FG", article:ART, size:"8", qty:25, kind:"reserve", order_no:"JO1", party:"A" }] }));
  const row = b.get("FG", ART, "", "8");
  assert.equal(row.on_hand, 60); assert.equal(row.reserved, 25); assert.equal(row.free, 35);
});
test("a release and a dispatch both take a reservation back down", () => {
  const b = stockBalance(STOCK({ reservations:[
    { store:"FG", article:ART, size:"8", qty:40, kind:"reserve", order_no:"JO1" },
    { store:"FG", article:ART, size:"8", qty:-10, kind:"release", order_no:"JO1" },
    { store:"FG", article:ART, size:"8", qty:-30, kind:"dispatch", order_no:"JO1" }],
    finishedMoves:[fgOpening("8", 60), { article:ART, size:"8", qty:-30, kind:"issued", order_no:"JO1" }] }));
  const row = b.get("FG", ART, "", "8");
  assert.equal(row.on_hand, 30); assert.equal(row.reserved, 0); assert.equal(row.free, 30);
});
test("reserved never exceeds what is physically there", () => {
  const b = stockBalance(STOCK({ reservations:[
    { store:"FG", article:ART, size:"8", qty:90, kind:"reserve", order_no:"JO1" }] }));
  assert.equal(b.get("FG", ART, "", "8").reserved, 60);
  assert.equal(b.get("FG", ART, "", "8").free, 0);
});
test("uppers stitched for a live order are held for it, not offered as free", () => {
  const moves = [upperIn("9", 40), upperIn("9", 30, { mts:false, order_no:"JO7" })];
  const b = stockBalance(STOCK({ upperMoves:moves, liveOrders:new Set(["JO7"]) }));
  const row = b.get("UPPER", ART, "BLACK", "9");
  assert.equal(row.on_hand, 70); assert.equal(row.held, 30); assert.equal(row.free, 40);
  /* Once that order is finished or cancelled its leftover uppers are free. */
  assert.equal(stockBalance(STOCK({ upperMoves:moves, liveOrders:new Set() })).get("UPPER", ART, "BLACK", "9").free, 70);
  assert.deepEqual([...heldUppers(moves, new Set(["JO7"])).values()], [{ JO7:30 }]);
});
test("uppers issued back out against their order are no longer held", () => {
  const moves = [upperIn("9", 30, { mts:false, order_no:"JO7" }),
    { kind:"out", article:ART, colour:"BLACK", size:"9", qty:30, order_no:"JO7", destination:"MOULDING", status:"approved" }];
  assert.equal(heldUppers(moves, new Set(["JO7"])).size, 0);
});
test("the register lists each SKU with who holds it", () => {
  const b = stockBalance(STOCK({ reservations:[
    { store:"FG", article:ART, size:"8", qty:25, kind:"reserve", order_no:"JO1", party:"A" }] }));
  const [row] = stockRegister(b, "FG");
  assert.deepEqual(row.orders, [{ order_no:"JO1", pairs:25 }]);
  assert.equal(stockRegister(b, "UPPER").length, 1);
});

console.log("\nB — one size larger, and never anything else");
test("the next size up follows the roll and stops where it is uncertain", () => {
  assert.equal(nextSizeUp("8s"), "9s");
  assert.equal(nextSizeUp("13s"), "1");
  assert.equal(nextSizeUp("4"), "5");
  assert.equal(nextSizeUp("8"), "9");
  assert.equal(nextSizeUp("5"), null);
  assert.equal(nextSizeUp("5.5"), null);
  assert.equal(nextSizeUp("13"), null);
  assert.equal(nextSizeUp("L"), null);
});
test("a size 4 line is offered size 4 and size 5 uppers — never 3, never 6", () => {
  const order = ORDER({ lines:[{ combo:"4X5", qty:100, sizes:{ "4":100 } }] });
  const uppers = ["3", "4", "5", "6"].map(s => upperIn(s, 10));
  const check = stockCheck(order, stockBalance(STOCK({ finishedMoves:[], upperMoves:uppers })));
  assert.deepEqual(check.rows[0].use_upper, { "4":10, "5":10 });
  assert.equal(check.rows[0].produce, 80);
});
test("uppers of another article or another colour are never offered", () => {
  const uppers = [upperIn("9", 40, { article:"REX GOLA PLUS" }), upperIn("9", 25, { colour:"WHITE" })];
  const check = stockCheck(ORDER(), stockBalance(STOCK({ finishedMoves:[], upperMoves:uppers })));
  assert.equal(check.totals.upper, 0);
  assert.equal(check.any, false);
  /* ...but the other colour is NAMED, so nothing offered is not read as nothing there. */
  assert.deepEqual(check.upper_other_colours, [{ colour:"WHITE", pairs:25 }]);
});
test("a size borrows from the size above only after that size has taken its own", () => {
  const order = ORDER({ lines:[{ combo:"8X10B", qty:60, sizes:{ "8":30, "9":30 } }] });
  const check = stockCheck(order, stockBalance(STOCK({ finishedMoves:[], upperMoves:[upperIn("9", 40)] })));
  const by = Object.fromEntries(check.rows.map(r => [r.size, r.use_upper]));
  assert.deepEqual(by["9"], { "9":30 });
  assert.deepEqual(by["8"], { "9":10 });
});
test("the order's colour falls back to nothing rather than to a guess", () => {
  const order = ORDER({ pi:{} });
  const check = stockCheck(order, stockBalance(STOCK()));
  assert.equal(check.totals.upper, 0);
  assert.equal(stockCheck(order, stockBalance(STOCK()), { colour:"black" }).totals.upper, 40);
});

console.log("\nC — the worked example");
test("the stock check offers 60 from finished goods and 40 uppers, FG first", () => {
  const check = stockCheck(ORDER(), stockBalance(STOCK()));
  assert.deepEqual(check.totals, { ordered:300, fg:60, upper:40, produce:200 });
  assert.equal(check.ready_pairs, 100);
  assert.equal(check.sizes_with_stock, 2);
  assert.deepEqual(check.rows.map(r => [r.size, r.use_fg, r.use_upper_total, r.produce]),
    [["8", 60, 0, 40], ["9", 0, 40, 60], ["10", 0, 0, 100]]);
});
test("finished goods are taken before uppers when both could cover a size", () => {
  const stock = STOCK({ upperMoves:[upperIn("8", 100), upperIn("9", 40)] });
  const row = stockCheck(ORDER(), stockBalance(stock)).rows[0];
  assert.equal(row.use_fg, 60); assert.equal(row.use_upper_total, 40); assert.equal(row.produce, 0);
});
test("using the stock reserves 60 FG and 40 uppers against the order", () => {
  const stock = STOCK();
  const { plan } = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map(r => [r.store, r.size, r.for_size, r.kind, r.qty, r.order_no]),
    [["FG", "8", "8", "reserve", 60, "JO5001"], ["UPPER", "9", "9", "reserve", 40, "JO5001"]]);
});
test("JO-A is 200 pairs from cutting and JO-B is 40 pairs from moulding", () => {
  const stock = STOCK();
  const { order } = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const units = productionUnits([order], []);
  assert.deepEqual(units.map(u => [u.unit_key, u.start_stage || "CUTTING", unitPairs(u)]),
    [["JO5001#BALU", "MOLDING", 40], ["JO5001#BAL", "CUTTING", 200]]);
  assert.deepEqual(units[1].lines[0].sizes, { "8":40, "9":60, "10":100 });
  assert.deepEqual(units[0].lines[0].sizes, { "9":40 });
});
test("a moulding-start job skips cutting, preparation, stitching and upper QC", () => {
  const stages = route(articles[ART], { start_stage:"MOLDING" }).map(r => r[0]);
  assert.deepEqual(stages, ["MOLDING", "PACKING", "DISPATCH"]);
  assert.deepEqual(route(articles[ART], {}).map(r => r[0]),
    ["CUTTING", "PREPARATION", "STITCHING", "UPPER_QC", "MOLDING", "PACKING", "DISPATCH"]);
  /* A start stage the routing does not have is ignored, not obeyed into an empty route. */
  assert.equal(route(articles[ART], { start_stage:"NOWHERE" }).length, 7);
});
test("raw material is bought for the pairs to be produced only", () => {
  const stock = STOCK();
  const { order } = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const line = n => ({ lines:[{ combo:"8X10B", qty:n }] });
  const whole = orderReq(line(1), articles[ART]);
  const mould = orderReq({ ...line(1), start_stage:"MOLDING" }, articles[ART]);
  const state = compute([order], articles, materials, wcs, origin, { units:productionUnits([order], []) });
  const required = Object.fromEntries(state.netted.map(n => [n.material_key, n.required]));
  for(const key of Object.keys(whole)){
    /* 200 pairs through the whole routing + 40 pairs from moulding on. 60 are never made. */
    const want = 200 * whole[key] + 40 * (mould[key] || 0);
    assert.ok(Math.abs(required[key] - want) < 0.02, `${key}: ${required[key]} is not ${want}`);
  }
  /* The moulding-start pairs ask for no cutting or stitching material at all. */
  const upperOnly = Object.keys(whole).filter(k => !(k in mould));
  assert.ok(upperOnly.length > 0, "the fixture has no cutting/stitching material to prove this with");
});
test("the order still counts every pair, and names the ones coming from stock", () => {
  const stock = STOCK();
  const { order } = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const state = compute([order], articles, materials, wcs, origin, { units:productionUnits([order], []) });
  const row = state.orders[0];
  assert.equal(state.totals.total_pairs, 300);
  assert.equal(row.pending_pairs, 240);
  assert.equal(row.from_stock_pairs, 60);
  /* Seen in the browser: the Order Book read 240 for a 300-pair order, because
     everything that totals an order added released + waiting and nothing else. */
  assert.equal(customerPairs(row), 300);
  assert.equal(buildMisSnapshot(state, [], { today:"2026-07-06" }).total_pairs, 300);
  assert.equal(state.totals.pending_orders, 1);
  assert.deepEqual(state.pending_release.map(r => [r.start_stage || null, r.pairs]), [[null, 200], ["MOLDING", 40]]);
  assert.deepEqual(allocationSummary(order).rows.map(r => [r.size, r.fg, r.upper, r.produce]),
    [["8", 60, 0, 40], ["9", 0, 40, 60], ["10", 0, 0, 100]]);
});

console.log("\nD — ignore stock, and an order covered completely");
test("ignoring the stock reserves nothing and plans the full quantity", () => {
  const stock = STOCK();
  const { plan, order } = decide(ORDER(), { ignore:true }, stock);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows, []);
  assert.equal(order.stock_allocation.mode, "ignore");
  const units = productionUnits([order], []);
  assert.deepEqual(units.map(u => [u.unit_key, unitPairs(u)]), [["JO5001#BAL", 300]]);
  /* ...and the 60 + 40 stay free for the next order. */
  assert.equal(stockCheck(ORDER({ order_no:"JO5002" }), stockBalance(stock)).ready_pairs, 100);
});
test("an order covered wholly by finished goods has nothing to make and is ready to dispatch", () => {
  const order = ORDER({ lines:[{ combo:"8X10B", qty:50, sizes:{ "8":50 } }] });
  const stock = STOCK();
  const d = decide(order, { sizes:stockCheck(order, stockBalance(stock)).suggestion }, stock);
  assert.equal(fgPairs(d.order), 50);
  const units = productionUnits([d.order], []);
  assert.deepEqual(units.map(unitPairs), [0]);
  const state = compute([d.order], articles, materials, wcs, origin, { units });
  assert.equal(state.units.length, 0, "nothing may be scheduled");
  assert.equal(state.netted.length, 0, "nothing may be bought");
  assert.equal(state.orders[0].ready_from_stock, true);
  assert.equal(state.orders[0].production_complete, true);
  assert.equal(state.totals.pending_orders, 0);
});
test("an order nobody has decided about is planned exactly as before", () => {
  const order = ORDER({ stock_status:"awaiting" });
  assert.equal(awaitingDecision(order), true);
  assert.equal(awaitingDecision(ORDER()), false);
  assert.equal(productionOrder(order), order);
  assert.deepEqual(productionUnits([order], []).map(u => [u.unit_key, unitPairs(u)]), [["JO5001#BAL", 300]]);
});

console.log("\nE — the same stock is never promised twice");
test("two decisions on one SKU cannot together exceed what is on hand", () => {
  const stock = STOCK();
  const first = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  assert.equal(first.plan.ok, true);
  const second = planReservations(ORDER({ order_no:"JO5002", party:"Other" }), { sizes:{ "8":{ fg:60 } } },
    stockBalance({ ...stock, reservations:first.reservations }), first.reservations);
  assert.equal(second.ok, false);
  assert.equal(second.stale, true);
  assert.deepEqual(second.rows, []);
  assert.match(second.problems[0], /Only 0 pair\(s\) of finished goods size 8 are free now/);
});
test("one decision cannot draw the same uppers for two sizes", () => {
  const order = ORDER({ lines:[{ combo:"8X10B", qty:80, sizes:{ "8":40, "9":40 } }] });
  const plan = planReservations(order, { sizes:{ "8":{ upper:{ "9":40 } }, "9":{ upper:{ "9":40 } } } },
    stockBalance(STOCK()), []);
  assert.equal(plan.ok, false);
  assert.equal(plan.rows.reduce((a, r) => a + r.qty, 0), 40);
});
test("a decision is refused when it asks for more than was ordered, or the wrong upper size", () => {
  const b = stockBalance(STOCK({ upperMoves:[upperIn("10", 40)] }));
  assert.match(planReservations(ORDER(), { sizes:{ "8":{ fg:60, upper:{ "9":50 } } } }, b, []).problems.join(" "),
    /more than the 100 ordered/);
  assert.match(planReservations(ORDER(), { sizes:{ "8":{ upper:{ "10":10 } } } }, b, []).problems.join(" "),
    /size 8 or 9 only — not size 10/);
  assert.match(planReservations(ORDER(), { sizes:{ "7":{ fg:1 } } }, b, []).problems.join(" "), /not on JO5001/);
  assert.match(planReservations(ORDER(), { sizes:{ "8":{ fg:-1 } } }, b, []).problems.join(" "), /whole number/);
});
test("finished goods cannot take over pairs already on a job card", () => {
  const plan = planReservations(ORDER(), { sizes:{ "8":{ fg:60 } } }, stockBalance(STOCK()), [], { onCards:{ "8":70 } });
  assert.match(plan.problems[0], /70 pairs are already on job cards, so at most 30/);
});
test("party-locked stock is never offered to another party's order", () => {
  const stock = STOCK({ locks:[{ store:"FG", article:ART, size:"8", party:"St. Mary School", qty:50 }] });
  const b = stockBalance(stock);
  assert.equal(b.get("FG", ART, "", "8").locked, 50);
  assert.equal(stockCheck(ORDER(), b).rows[0].use_fg, 10);
  assert.equal(stockCheck(ORDER({ party:"st. mary  school" }), b).rows[0].use_fg, 60);
  const refused = planReservations(ORDER(), { sizes:{ "8":{ fg:30 } } }, b, []);
  assert.equal(refused.ok, false);
});
test("a party's own reservation uses up its lock instead of adding to it", () => {
  const stock = STOCK({ locks:[{ store:"FG", article:ART, size:"8", party:"School", qty:50 }],
    reservations:[{ store:"FG", article:ART, size:"8", qty:30, kind:"reserve", order_no:"JO1", party:"School" }] });
  const row = stockBalance(stock).get("FG", ART, "", "8");
  assert.equal(row.reserved, 30); assert.equal(row.locked, 20); assert.equal(row.free, 10);
});
test("a lock is checked before it is stored", () => {
  assert.equal(validateLock({ store:"fg", article:ART, size:"8", party:"School", qty:20 }).problems.length, 0);
  assert.equal(validateLock({ store:"RM", article:"", size:"", party:"", qty:-1 }).problems.length, 5);
});

console.log("\nF — releasing");
test("cancelling the order returns everything it held to free stock", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  assert.equal(stockBalance({ ...stock, reservations:d.reservations }).get("FG", ART, "", "8").free, 0);
  const released = [...d.reservations, ...releaseRows(d.reservations, "JO5001", "Order cancelled")];
  const b = stockBalance({ ...stock, reservations:released });
  assert.equal(b.get("FG", ART, "", "8").free, 60);
  assert.equal(b.get("UPPER", ART, "BLACK", "9").free, 40);
  assert.deepEqual(outstandingFor(released, "JO5001"), []);
});
test("reducing a size releases the excess — uppers before finished goods", () => {
  const order = ORDER({ lines:[{ combo:"8X10B", qty:100, sizes:{ "8":100 } }] });
  const stock = STOCK({ upperMoves:[upperIn("8", 40)] });
  const d = decide(order, { sizes:{ "8":{ fg:60, upper:{ "8":40 } } } }, stock);
  const smaller = { ...d.order, lines:[{ combo:"8X10B", qty:70, sizes:{ "8":70 } }] };
  const fix = reconcileAllocation(smaller, d.order.stock_allocation, d.reservations);
  assert.equal(fix.changed, true); assert.equal(fix.grew, false);
  assert.deepEqual(fix.allocation.sizes, { "8":{ fg:60, upper:{ "8":10 } } });
  const plan = planReservations(smaller, fix.allocation, stockBalance({ ...stock, reservations:d.reservations }), d.reservations);
  assert.deepEqual(plan.rows.map(r => [r.store, r.kind, r.qty]), [["UPPER", "release", -30]]);
});
test("removing a size releases all of it", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const without8 = { ...d.order, lines:[{ combo:"8X10B", qty:200, sizes:{ "9":100, "10":100 } }] };
  const fix = reconcileAllocation(without8, d.order.stock_allocation, d.reservations);
  assert.deepEqual(Object.keys(fix.allocation.sizes), ["9"]);
  const plan = planReservations(without8, fix.allocation, stockBalance({ ...stock, reservations:d.reservations }), d.reservations);
  assert.deepEqual(plan.rows.map(r => [r.store, r.kind, r.qty]), [["FG", "release", -60]]);
});
test("an increase sends only the added pairs back through the stock check", () => {
  const stock = STOCK({ finishedMoves:[fgOpening("8", 60), fgOpening("10", 30)] });
  const d = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  const bigger = { ...d.order, lines:[{ combo:"8X10B", qty:350, sizes:{ "8":100, "9":100, "10":150 } }] };
  const fix = reconcileAllocation(bigger, d.order.stock_allocation, d.reservations);
  assert.equal(fix.grew, true); assert.equal(fix.changed, false);
  /* What it already holds is its own; only free stock is offered for the rest. */
  const check = stockCheck(bigger, stockBalance({ ...stock, reservations:d.reservations }),
    { current:d.order.stock_allocation.sizes });
  assert.equal(check.rows[0].use_fg, 60);
  assert.equal(check.rows[2].use_fg, 30);
  const plan = planReservations(bigger, { sizes:check.suggestion },
    stockBalance({ ...stock, reservations:d.reservations }), d.reservations);
  /* Nothing is re-reserved for the 60 it already holds. */
  assert.deepEqual(plan.rows.map(r => [r.store, r.size, r.kind, r.qty]).sort(),
    [["FG", "10", "reserve", 30], ["UPPER", "9", "reserve", 40]]);
});
test("an allocation cannot be cut below what has already been dispatched", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  const shipped = [...d.reservations,
    { store:"FG", article:ART, size:"8", for_size:"8", qty:-45, kind:"dispatch", order_no:"JO5001" }];
  const plan = planReservations(d.order, { sizes:{ "8":{ fg:20 } } },
    stockBalance({ ...stock, reservations:shipped }), shipped);
  assert.equal(plan.ok, false);
  assert.match(plan.problems[0], /45 pair\(s\) of finished goods size 8 have already been dispatched/);
  /* An edit that shrinks the size keeps what already went. */
  const smaller = { ...d.order, lines:[{ combo:"8X10B", qty:30, sizes:{ "8":30 } }] };
  assert.deepEqual(reconcileAllocation(smaller, d.order.stock_allocation, shipped).allocation.sizes, { "8":{ fg:45, upper:{} } });
});

test("an undone dispatch is negated, so the pairs can be released again later", () => {
  /* Found against a real database: the undo used to RE-RESERVE the pairs,
     which left the order granted 120 and consumed 60 — and an edit that then
     shrank the size could never release any of it. */
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  const shipped = { store:"FG", article:ART, size:"8", for_size:"8", qty:-60, kind:"dispatch", order_no:"JO5001" };
  const ledger = [...d.reservations, shipped, { ...shipped, qty:60 }];
  assert.deepEqual(consumedFor(ledger, "JO5001"), { "8":{ fg:0, upper:{} } });
  assert.deepEqual(grantedFor(ledger, "JO5001"), { "8":{ fg:60, upper:{} } });
  assert.equal(outstandingFor(ledger, "JO5001")[0].qty, 60);
  const smaller = { ...d.order, lines:[{ combo:"8X10B", qty:50, sizes:{ "8":50 } }] };
  const fix = reconcileAllocation(smaller, d.order.stock_allocation, ledger);
  assert.deepEqual(fix.allocation.sizes, { "8":{ fg:50, upper:{} } });
  const plan = planReservations(smaller, fix.allocation, stockBalance({ ...stock, reservations:ledger }), ledger);
  assert.deepEqual(plan.rows.map(r => [r.kind, r.qty]), [["release", -10]]);
});

console.log("\nG — dispatch");
test("the dispatch slip is told what is reserved in finished goods, for pre-filling", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const pre = dispatchPrefill(d.order, d.reservations, stockBalance({ ...stock, reservations:d.reservations }));
  assert.deepEqual(pre.reserved, [{ size:"8", pairs:60 }]);
  assert.equal(pre.reserved_pairs, 60);
  assert.equal(pre.free_pairs, 0);
});
test("an order planned with Ignore stock is still reminded of matching free stock", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { ignore:true }, stock);
  const pre = dispatchPrefill(d.order, d.reservations, stockBalance(stock));
  assert.equal(pre.reserved_pairs, 0);
  assert.deepEqual(pre.free, [{ size:"8", pairs:60 }]);
  /* ...but not for a size the customer has already had in full. */
  assert.equal(dispatchPrefill(d.order, d.reservations, stockBalance(stock), { "8":100 }).free_pairs, 0);
});
test("dispatching reserved pairs issues them from stock and clears the reservation", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  const out = dispatchFromStock(d.order, { "8":60 }, d.reservations, stockBalance({ ...stock, reservations:d.reservations }));
  assert.equal(out.ok, true); assert.equal(out.pairs, 60);
  assert.deepEqual(out.issues, [{ article:ART, size:"8", qty:-60, kind:"issued", order_no:"JO5001" }]);
  assert.deepEqual(out.rows.map(r => [r.kind, r.qty]), [["dispatch", -60]]);
  const after = stockBalance({ finishedMoves:[...stock.finishedMoves, ...out.issues], upperMoves:stock.upperMoves,
    reservations:[...d.reservations, ...out.rows] });
  assert.equal(after.get("FG", ART, "", "8").on_hand, 0);
  assert.equal(after.get("FG", ART, "", "8").reserved, 0);
});
test("a dispatch can never take stock below zero or another order's pairs", () => {
  const stock = STOCK();
  const other = decide(ORDER({ order_no:"JO5002" }), { sizes:{ "8":{ fg:50 } } }, stock);
  const b = stockBalance({ ...stock, reservations:other.reservations });
  const out = dispatchFromStock(ORDER(), { "8":20 }, other.reservations, b);
  assert.equal(out.ok, false);
  assert.match(out.problems[0], /only 10 are available to this order/);
  assert.equal(dispatchFromStock(ORDER(), { "8":10 }, other.reservations, b).ok, true);
  assert.equal(dispatchFromStock(ORDER(), { "8":61 }, [], stockBalance(stock)).ok, false);
  assert.match(dispatchFromStock(ORDER(), { "7":1 }, [], stockBalance(stock)).problems[0], /not on JO5001/);
});
test("pairs shipped from finished goods do not cancel material for pairs still to be made", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "8":{ fg:60 } } }, stock);
  const units = productionUnits([d.order], []);
  const fromShelf = [{ order_no:"JO5001", dispatched:{ "8X10B":60 }, from_stock:{ combos:{ "8X10B":60 } } }];
  assert.deepEqual(materialDone(units, [], fromShelf), {});
  /* The same dispatch WITHOUT the marker would have taken 60 pairs of material off the plan. */
  assert.deepEqual(materialDone(units, [], [{ order_no:"JO5001", dispatched:{ "8X10B":60 } }]), { "JO5001#BAL":{ "8X10B":60 } });
});

console.log("\nH — withdrawals from the stores");
test("an issue may take free stock and its own reservation, never another order's", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "9":{ upper:{ "9":40 } } } }, stock);
  const b = stockBalance({ ...stock, reservations:d.reservations });
  const move = (order_no, qty) => ({ store:"UPPER", article:ART, colour:"black", size:"9", qty, order_no });
  assert.deepEqual(checkWithdrawals([move("JO5001", 40)], b), []);
  const refused = checkWithdrawals([move("JO9", 1)], b);
  assert.match(refused[0], /0 pair\(s\) can be taken — 40 more are reserved for JO5001/);
  /* Checked row by row through a batch: the second 30 is not there. */
  assert.equal(checkWithdrawals([move("JO5001", 30), move("JO5001", 30)], b).length, 1);
});
test("uppers merely held for the order they were stitched for can still be issued elsewhere", () => {
  const moves = [upperIn("9", 30, { mts:false, order_no:"JO7" })];
  const b = stockBalance(STOCK({ upperMoves:moves, liveOrders:new Set(["JO7"]) }));
  assert.equal(b.get("UPPER", ART, "BLACK", "9").free, 0);
  assert.deepEqual(checkWithdrawals([{ store:"UPPER", article:ART, colour:"BLACK", size:"9", qty:30, order_no:"JO8" }], b), []);
});
test("uppers issued to moulding for an order consume its reservation", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:{ "9":{ upper:{ "9":40 } } } }, stock);
  const rows = issueRowsFor([{ kind:"out", article:ART, colour:"BLACK", size:"9", qty:25, order_no:"JO5001" },
                             { kind:"out", article:ART, colour:"BLACK", size:"9", qty:25, order_no:"JO5001" },
                             { kind:"out", article:ART, colour:"BLACK", size:"9", qty:5, order_no:"JO77" }], d.reservations);
  assert.deepEqual(rows.map(r => [r.kind, r.qty, r.order_no]), [["issue", -25, "JO5001"], ["issue", -15, "JO5001"]]);
});
test("an upper used one size down leaves the larger size's stock, against the size ordered", () => {
  const order = ORDER({ lines:[{ combo:"4X5", qty:20, sizes:{ "4":20 } }] });
  const stock = STOCK({ upperMoves:[upperIn("5", 20)] });
  const d = decide(order, { sizes:{ "4":{ upper:{ "5":20 } } } }, stock);
  assert.deepEqual(d.plan.rows.map(r => [r.size, r.for_size, r.qty]), [["5", "4", 20]]);
  assert.deepEqual(upperPairs(d.order), { "4":20 });
  /* The job is for size 4 — that is what is moulded, invoiced and dispatched. */
  assert.deepEqual(productionUnits([d.order], [])[0].lines[0].sizes, { "4":20 });
});

console.log("\nI — the balance the floor releases");
test("a moulding-start card takes the upper pairs; a full card takes the rest", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  const card = (id, sizes, start_stage) => ({ id, order_no:"JO5001", article:ART, status:"issued",
    qty:Object.values(sizes).reduce((a, n) => a + n, 0),
    card:{ card_no:`JC${id}`, ...(start_stage ? { start_stage } : {}),
           lines:[{ combo:"8X10B", qty:Object.values(sizes).reduce((a, n) => a + n, 0), sizes }] } });
  const first = releaseBalance(d.order, []);
  assert.equal(first.from_upper_pairs, 40); assert.equal(first.full_pairs, 200);
  const afterMould = releaseBalance(d.order, [card(1, { "9":40 }, "MOLDING")]);
  assert.equal(afterMould.from_upper_pairs, 0); assert.equal(afterMould.full_pairs, 200);
  const units = productionUnits([d.order], [card(1, { "9":40 }, "MOLDING"), card(2, { "8":40, "9":60 })]);
  assert.deepEqual(units.map(u => [u.unit_kind, u.start_stage || null, unitPairs(u)]),
    [["job", "MOLDING", 40], ["job", null, 100], ["balance", null, 100]]);
});

test("the job order screen is offered each part as its own balance", () => {
  const stock = STOCK();
  const d = decide(ORDER(), { sizes:stockCheck(ORDER(), stockBalance(stock)).suggestion }, stock);
  assert.equal(usesStock(d.order), true);
  assert.equal(usesStock(ORDER()), false);
  const full = cardBalance(d.order, [], false), mould = cardBalance(d.order, [], true);
  assert.equal(full.remaining, 200);
  assert.deepEqual(full.lines[0].remaining_sizes, { "8":40, "9":60, "10":100 });
  assert.equal(mould.remaining, 40);
  assert.deepEqual(mould.lines[0].remaining_sizes, { "9":40 });
  /* A card belonging to another order, or cancelled with its order, takes nothing. */
  const stray = [{ id:9, order_no:"JO5001", cancelled:true, qty:40, card:{ start_stage:"MOLDING", lines:[{ combo:"8X10B", qty:40, sizes:{ "9":40 } }] } }];
  assert.equal(cardBalance(d.order, stray, true).remaining, 40);
});

test("a moulding-start card books no cutting or stitching material out of the store", () => {
  const whole = materialTotals([{ combo:"8X10B", qty:40 }], articles[ART]);
  const mould = materialTotals([{ combo:"8X10B", qty:40, from_stage:"MOLDING" }], articles[ART]);
  const rates = articles[ART].combos["8X10B"].rates;
  const upstream = Object.keys({ ...rates.CUTTING, ...rates.STITCHING });
  const downstream = Object.keys({ ...rates.MOLDING, ...rates.PACKING });
  assert.ok(upstream.length, "the fixture needs cutting or stitching material");
  for(const key of upstream.filter(k => !downstream.includes(k))) assert.equal(mould[key], undefined, `${key} was booked for a moulding-start card`);
  for(const key of downstream.filter(k => !upstream.includes(k))) assert.equal(mould[key], whole[key]);
  /* Moulding and packing material is still taken — shown on a BOM that has some. */
  const soled = { combos:{ X:{ rates:{ CUTTING:{ REXINE:1 }, MOLDING:{ PVC:2 }, PACKING:{ BOX:0.5 } } } } };
  assert.deepEqual(materialTotals([{ combo:"X", qty:40, from_stage:"MOLDING" }], soled), { PVC:80, BOX:20 });
  assert.deepEqual(materialTotals([{ combo:"X", qty:40 }], soled), { REXINE:40, PVC:80, BOX:20 });
  /* The same answer the planner gives for a moulding-start unit. */
  const planned = orderReq({ lines:[{ combo:"8X10B", qty:40 }], start_stage:"MOLDING" }, articles[ART]);
  for(const key of Object.keys(mould)) assert.ok(Math.abs(mould[key] - planned[key]) < 1e-3, key);
  assert.deepEqual(Object.keys(mould).sort(), Object.keys(planned).sort());
});

console.log("\nJ — small parts");
test("a range with no sizes cannot be matched to a shelf counted per size", () => {
  const order = ORDER({ lines:[{ combo:"8X10B", qty:120 }] });
  assert.deepEqual(orderDemand(order), { sizes:[], unsized:120 });
  const check = stockCheck(order, stockBalance(STOCK()));
  assert.equal(check.any, false); assert.equal(check.unsized, 120); assert.equal(check.totals.produce, 120);
});
test("an empty selection is the same decision as ignoring the stock", () => {
  assert.equal(normalizeAllocation({ sizes:{ "8":{ fg:0 } } }).mode, "ignore");
  assert.equal(normalizeAllocation({ sizes:{ "8":{ fg:5 } } }).mode, "use");
});
test("lines are split by size and keep everything else about the line", () => {
  const { taken, left } = splitLines([{ combo:"A", qty:30, label:"x", sizes:{ "8":10, "9":20 } }, { combo:"B", qty:5 }], { "9":15 });
  assert.deepEqual(taken, [{ combo:"A", qty:15, label:"x", sizes:{ "9":15 } }]);
  assert.deepEqual(left, [{ combo:"A", qty:15, label:"x", sizes:{ "8":10, "9":5 } }, { combo:"B", qty:5 }]);
});
test("a reservation row's sign follows its kind", () => {
  const row = validateReservationRow({ store:"FG", article:ART, size:"8", qty:12, kind:"release", order_no:"JO1" });
  assert.equal(row.qty, -12);
  assert.equal(validateReservationRow({ store:"FG", article:ART, size:"8", qty:12, kind:"wish", order_no:"JO1" }), null);
  assert.equal(validateReservationRow({ store:"UPPER", article:ART, size:"8", qty:3, kind:"reserve", order_no:"JO1", colour:"black" }).colour, "BLACK");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
