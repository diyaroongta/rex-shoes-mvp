/* The stitching line board.
 *
 * The point of it is the IDLE line: a board built from the jobs alone shows
 * only lines that are busy, which is the opposite of what someone deciding
 * where the next card goes needs to see.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { lineBoard } from "../shared/line-load.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const FABS = () => [
  { name:"Line 1", type:"internal_line", active:true },
  { name:"Line 2", type:"internal_line", active:true },
  { name:"New Durga Line", type:"external", active:true },
  { name:"Old Line", type:"internal_line", active:false },
];
const JOBS = () => [
  { fabricator:"Line 1", fabricator_type:"internal_line", qty:500, received:200, status:"issued" },
  { fabricator:"New Durga Line", fabricator_type:"external", qty:300, received:300, status:"closed" },
];

test("every active line is on the board, busy or not", () => {
  const board = lineBoard(FABS(), JOBS());
  assert.deepEqual(board.rows.map(r => r.fabricator), ["Line 1","Line 2","New Durga Line"]);
  assert.equal(board.internal_lines, 2);
});

test("an idle line is named as idle — it is the one that can take the next card", () => {
  const board = lineBoard(FABS(), JOBS());
  assert.equal(board.rows.find(r => r.fabricator === "Line 2").idle, true);
  assert.equal(board.rows.find(r => r.fabricator === "Line 1").idle, false);
  assert.equal(board.idle_lines, 1);
});

test("a partial return is still OUT, not short", () => {
  const line1 = lineBoard(FABS(), JOBS()).rows.find(r => r.fabricator === "Line 1");
  assert.equal(line1.with_them, 300);
  assert.equal(line1.shortage, 0);
});

test("a closed job leaves nothing with the fabricator", () => {
  const durga = lineBoard(FABS(), JOBS()).rows.find(r => r.fabricator === "New Durga Line");
  assert.equal(durga.with_them, 0);
  assert.equal(durga.open_jobs, 0);
});

test("a deactivated line takes no new work and is off the board", () => {
  assert.ok(!lineBoard(FABS(), JOBS()).rows.some(r => r.fabricator === "Old Line"));
});

test("pairs out with a name no longer in the master are not lost", () => {
  const board = lineBoard(FABS(), [...JOBS(),
    { fabricator:"Old Line", fabricator_type:"internal_line", qty:100, received:0, status:"issued" }]);
  const row = board.rows.find(r => r.fabricator === "Old Line");
  assert.equal(row.not_in_master, true);
  assert.equal(row.with_them, 100);
});

test("internal lines lead, then outside work", () => {
  const types = lineBoard(FABS(), JOBS()).rows.map(r => r.type);
  assert.deepEqual(types, ["internal_line","internal_line","external"]);
});

test("the board totals what is out across every line", () => {
  assert.equal(lineBoard(FABS(), JOBS()).totals.with_them, 300);
});

test("no lines set up is reported as none, not as an empty board", () => {
  const board = lineBoard([], []);
  assert.deepEqual(board.rows, []);
  assert.equal(board.internal_lines, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
