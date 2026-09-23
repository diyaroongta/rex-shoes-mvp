/* The pasting and packing job cards, against the client's own two formats
 * (PASTING JC FORMATE.xlsx, PACKING JC FORMATE.xlsx).
 *
 * The rule under test is the one the cutting card already keeps: a quantity is
 * the BOM rate times the pairs on the card, and a stage with no BOM prints the
 * factory's blank list with an EMPTY quantity column rather than a figure
 * somebody made up.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { stageCard, cardKinds, sizeCells, CARD_KINDS, DEFAULT_AVG_NOTES } from "../shared/job-card-stages.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Their sample card: sizes 1..5 at 90, 91, 91, 140, 39 = 451 pairs. */
const LINES = () => [{ combo:"1X5", qty:451, size_order:["1","2","3","4","5"],
                       sizes:{ "1":90, "2":91, "3":91, "4":140, "5":39 } }];

const ARTICLE = () => ({ combos: { "1X5": { rates: {
  MOLDING: { "ADHESIVE||KG": 0.02, "INSOLE BOARD||PCS": 2 },
  PACKING: { "TAG PIN||PCS": 1, "CTN TAPE||MTR": 2 },
} } } });

test("the pasting card reads the MOLDING stage, which is where the sole goes on", () => {
  const card = stageCard(LINES(), ARTICLE(), "PASTING");
  assert.equal(card.stage, "MOLDING");
  assert.equal(card.title, "PASTING");
  assert.equal(card.from_bom, true);
  assert.deepEqual(card.rows.map(r => [r.name, r.qty, r.uom]),
    [["ADHESIVE", 9.02, "KG"], ["INSOLE BOARD", 902, "PCS"]]);
});

test("the packing card reads the PACKING stage", () => {
  const card = stageCard(LINES(), ARTICLE(), "PACKING");
  assert.equal(card.stage, "PACKING");
  assert.deepEqual(card.rows.map(r => [r.name, r.qty]), [["TAG PIN", 451], ["CTN TAPE", 902]]);
});

test("both cards total the pairs their format totals — 451", () => {
  for(const kind of ["PASTING","PACKING"]){
    const card = stageCard(LINES(), ARTICLE(), kind);
    assert.equal(card.total_pairs, 451, kind);
    assert.deepEqual(card.sizes.map(s => s.qty), [90, 91, 91, 140, 39], kind);
  }
});

test("the packing card signs for three issues, the pasting card for one", () => {
  assert.deepEqual(stageCard(LINES(), ARTICLE(), "PACKING").plan_rows,
    ["UPPER ISSUE","INSOLE ISSUE","TEXTION ISSUE"]);
  assert.deepEqual(stageCard(LINES(), ARTICLE(), "PASTING").plan_rows, ["UPPER"]);
});

test("a stage with no BOM prints the blank checklist and NO quantities", () => {
  const card = stageCard(LINES(), { combos: { "1X5": { rates: {} } } }, "PASTING");
  assert.equal(card.from_bom, false);
  assert.equal(card.rows[0].name, "Adhesive / Solvent Cement");
  assert.ok(card.rows.length >= 12);
  assert.ok(card.rows.every(r => r.qty == null),
    "a quantity was invented for a stage the BOM says nothing about");
});

test("a packing stage with no BOM has no checklist to fall back on, and says so", () => {
  const card = stageCard(LINES(), { combos: { "1X5": { rates: {} } } }, "PACKING");
  assert.equal(card.from_bom, false);
  assert.deepEqual(card.rows, []);
});

test("the movement blocks are the ones on their sheets", () => {
  assert.deepEqual(stageCard(LINES(), ARTICLE(), "PASTING").movements,
    ["UPPER RECEIVED","SHORTAGE / PENDING AFTER RECEIPT","SHORTAGE RECEIPT"]);
  const packing = stageCard(LINES(), ARTICLE(), "PACKING");
  assert.deepEqual(packing.movements,
    ["MOULDED/PASTED SHOE","SENT FOR REPAIR / REJECTION","PACKING","CARTON RECEIVED"]);
  assert.deepEqual(packing.summary, ["REJECTION/REPAIR","PACKING","CARTON RECEIVED","LOOSE PAIRS"]);
});

test("a line with no quantity is not on the card at all", () => {
  const card = stageCard([...LINES(), { combo:"6X8", qty:0 }], ARTICLE(), "PACKING");
  assert.equal(card.sizes.length, 5);
});

test("the average note ships with the form and can be replaced", () => {
  assert.deepEqual(stageCard(LINES(), ARTICLE(), "PASTING").avg_notes, DEFAULT_AVG_NOTES);
  const own = [{ label:"NYLON THREAD", value:"52 CM" }];
  assert.deepEqual(stageCard(LINES(), ARTICLE(), "PASTING", { avg_notes: own }).avg_notes, own);
});

test("components win over materials where the BOM names the cut pieces", () => {
  const article = { combos: { "1X5": {
    rates: { MOLDING: { "ADHESIVE||KG": 0.02 } },
    components: { MOLDING: { "ADHESIVE||KG": [{ name:"SOLE PASTE", per_pair:0.02, uom:"KG" }] } },
  } } };
  const card = stageCard(LINES(), article, "PASTING");
  assert.equal(card.from_components, true);
  assert.deepEqual(card.rows.map(r => r.name), ["SOLE PASTE"]);
});

test("an unknown card is refused rather than printed empty", () => {
  assert.throws(() => stageCard(LINES(), ARTICLE(), "STITCHING"), /Unknown job card/);
});

test("both kinds are listed for the screen to offer", () => {
  assert.deepEqual(cardKinds().map(k => k.kind), ["PASTING","PACKING"]);
  assert.equal(CARD_KINDS.PACKING.issue_title, "PACKING MATERIAL ISSUED");
});

test("sizes keep the order the job order was entered in", () => {
  assert.deepEqual(sizeCells([{ combo:"11X1", qty:3, size_order:["11","12","13","1"],
                                sizes:{ "11":1, "12":1, "13":1, "1":0 } }]).map(s => s.size),
    ["11","12","13","1"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
