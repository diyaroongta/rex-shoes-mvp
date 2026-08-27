import assert from "node:assert/strict";
import { buildPhotoCards } from "../shared/intake.js";
import { buildMultiPI } from "../shared/pi.js";
import { INPUTS } from "../shared/inputs.js";
import { readPrompt, setReference } from "../shared/bridge.js";

setReference(INPUTS);
console.log("\nhandwritten intake — exact sizes survive through PI");

const parsed={date:"2026-08-19",orders:[{
  party:"KP Gurgaon",category:"Spike",color:"N.Blue / S.Blue",lines:[
    {sizes:["10"],cartons:1},
    {sizes:["12"],cartons:1},
    {sizes:["13"],cartons:2},
    {sizes:["1"],cartons:2},
    {sizes:["3"],cartons:1},
    {sizes:["4"],cartons:1},
    {sizes:["5"],cartons:1},
    {sizes:["6"],cartons:2,type:"LACE"},
    {sizes:["8"],cartons:1,type:"LACE"},
    {sizes:["10"],cartons:1,type:"LACE"},
    {sizes:["11"],cartons:1,type:"LACE"},
  ]
}]};

const built=buildPhotoCards(parsed,INPUTS);
assert.deepEqual(built.issues,[],"an omitted S/L marker follows the written Small-then-Large sequence");

/* SPIKE IS ONE SHOE. A slip that writes a Velcro section and a Lace section
   under one heading ordered one article in two rolls — not two articles. The
   type therefore rides on each LINE, derived from its size range, and the
   article stays whole through the invoice and into the plan. */
assert.equal(built.cards.length,1,"one handwritten article stays ONE article, whatever rolls it was ordered in");
const card=built.cards[0];
assert.equal(card.article,"SPIKE");
assert.deepEqual(card.types,["VELCRO","LACE"],"both rolls are recorded on the one card");
assert.equal(card.vl,"","a shoe ordered in both rolls has no single card-level type");
assert.deepEqual(card.lines.map(l=>l.combo),["7X10S","11X1","2X5","6X8","9X12"]);
assert.deepEqual(card.lines.map(l=>l.type),["VELCRO","VELCRO","VELCRO","LACE","LACE"],
  "the size range decides the roll, not the section heading");
assert.deepEqual(card.lines.find(l=>l.combo==="11X1").sizes,{"12s":24,"13s":48,"1":48});
assert.deepEqual(card.lines.find(l=>l.combo==="9X12").sizes,{"10":18,"11":18},
  "adult SPIKE sizes must use ARMOUR's 18-pair single-size packing rate");

// One PI item, both rolls, and V/L printed per size range.
const pi=buildMultiPI([{
  article_code:card.article,vl:card.vl,
  lines:card.lines.map(l=>({...l,vl:l.type})),
  mrp:Object.fromEntries(card.lines.map(line=>[line.combo,100])),
}]);
assert.equal(pi.groups.length,1,"the invoice shows ONE article, not the same shoe twice");
const qtyBySize=Object.fromEntries(pi.lines.map(line=>[`${line.vl}:${line.size}`,line.qty]));
assert.equal(qtyBySize["VELCRO:12s"],24);
assert.equal(qtyBySize["VELCRO:13s"],48);
assert.equal(qtyBySize["LACE:10"],18);
assert.equal(qtyBySize["LACE:11"],18);
assert.equal(pi.lines.filter(l=>l.vl==="LACE").length,4,
  "the lace rows are only the four sizes actually ordered, not every size in both ranges");
// Velcro and lace both print an "8": 8s from the kids roll, 8 from the adult.
assert.ok(pi.lines.some(l=>l.size==="13s") && pi.lines.some(l=>l.size==="11"),
  "both rolls keep their own size labels on the one invoice");

const ambiguous=buildPhotoCards({orders:[{category:"Spike",lines:[{sizes:["11"],cartons:1}]}]},INPUTS);
assert.deepEqual(Object.keys(ambiguous.cards[0].lines[0].sizes),["11s"],
  "an unmarked opening size is Small; it is not misread as Lace");
assert.ok(readPrompt().includes("L always means Large here; NEVER interpret L as Lace"));

/* THE TWO FAMILIES BEHAVE OPPOSITELY, and the intake has to get both right.

   SPIKE/ARMOUR/JILL: one article, two rolls        -> ONE card
   REX GOLA (V)/(L) : two articles, two BOMs        -> TWO cards

   "Gala (L)" must therefore reach REX GOLA (L), not the (V) article with a
   lace label stuck on it — those are different bills of material. */
const belgaum=buildPhotoCards({orders:[{party:"",category:"Gala",color:"",lines:[
  {sizes:["11"],cartons:3,type:"VELCRO"},
  {sizes:["11","13"],cartons:1,type:"VELCRO"},
  {sizes:["1","3"],cartons:1,type:"VELCRO"},
  {sizes:["5"],cartons:1,type:"LACE"},
  {sizes:["4","5"],cartons:1,type:"LACE"},
]}]},INPUTS);
assert.deepEqual(belgaum.cards.map(c=>c.article).sort(),["REX GOLA (L)","REX GOLA (V)"],
  "a legacy (V)/(L) pair is two articles with two BOMs, not one article with a label");
assert.deepEqual(belgaum.issues,[],
  "a single-type article can never have an unreadable V/L — its code already states it");

// The legacy ranges keep the ORDINARY roll. Relabelling them to the adult roll
// (which is only right for split articles) matched nothing and priced at zero.
const gv=belgaum.cards.find(c=>c.article==="REX GOLA (V)");
assert.deepEqual(gv.lines.find(l=>l.combo==="11X13").size_order,["11s","12s","13s"],
  "REX GOLA is a Lace/Velcro CLOSURE, not a kids/adult roll — 11X13 stays 11s..13s");
assert.deepEqual(gv.lines.find(l=>l.combo==="1X3").size_order,["1","2","3"]);

// A bare 8 on REX GOLA fits 8X10 (as 8s) and 8X10B (as 8). Both are real, so
// the tie is reported and the clerk picks — it is never broken silently.
const tie=buildPhotoCards({orders:[{category:"Gala",lines:[{sizes:["8","10"],cartons:2,type:"VELCRO"}]}]},INPUTS);
assert.ok(tie.issues.some(i=>i.includes("fits both 8X10 and 8X10B")),
  "an genuinely ambiguous roll must be reported, never guessed");

const unknown=buildPhotoCards({orders:[{
  party:"KP Gurgaon",category:"GLAMOUR",color:"WHI / U COL",lines:[
    {sizes:["13"],cartons:1,type:"VELCRO"},
  ],
}]},INPUTS);
assert.equal(unknown.cards.length,0,"an unknown handwritten article must not fall back to the first catalogue article");
assert.ok(unknown.issues.some(issue=>issue.includes("GLAMOUR: no configured article match")));
assert.ok(readPrompt().includes("NEVER force an unknown product onto the closest catalogue name"),
  "the AI reader must preserve an unknown heading so intake can block it safely");

/* Screenshot fallback: the client normally writes S/L. If the marks are absent,
   preserve the written sequence instead of treating every repeated numeral as
   the same run. */
const glamourRef={...INPUTS,articles:{...INPUTS.articles,GLAMOUR:{sole_type:"PVC",packing_source:"SELF",
  combo_order:["7X10","11X1","2X5","6X7","8X12"],combos:{
    "7X10":{},"11X1":{},"2X5":{},"6X7":{},"8X12":{},
  }}},packing:{...INPUTS.packing,GLAMOUR:{"7X10":24,"11X1":24,"2X5":18,"6X7":18,"8X12":18}}};
setReference(glamourRef);
const ascending=buildPhotoCards({orders:[{category:"GLAMOUR",lines:[
  {sizes:["7"],cartons:1},{sizes:["8"],cartons:1},{sizes:["1"],cartons:1},
  {sizes:["2"],cartons:1},{sizes:["3"],cartons:1},
]}]},glamourRef);
assert.deepEqual(ascending.issues,[],ascending.issues.join(" | "));
assert.deepEqual(ascending.cards[0].lines.flatMap(line=>Object.keys(line.sizes)),["7s","8s","1","2","3"],
  "unmarked 7,8,1,2,3 must retain the Small-then-Large sequence from the slip");
setReference(INPUTS);

/* A customer is frequently just a town — Belgaum, Indore. The reader must read
   the heading as written rather than deciding a name is "only a place", and it
   is given the real customer list so rough handwriting resolves to a customer
   that exists instead of a plausible invention. */
assert.ok(readPrompt().includes("A PARTY IS OFTEN JUST A TOWN"),
  "a town name is a customer here, not a delivery destination");
const withParties=readPrompt([{name:"Belgaum"},{name:"Paras Indore"}]);
assert.ok(withParties.includes("KNOWN CUSTOMERS")&&withParties.includes("Belgaum, Paras Indore"));
assert.ok(!readPrompt([]).includes("KNOWN CUSTOMERS"),
  "with no party master the reader simply returns what it reads");
assert.ok(withParties.includes("Never bend a name that does not fit onto the nearest one"),
  "a new customer must survive the known-customer list rather than being snapped to it");

console.log("  pass  photo stacks retain exact sizes, type and packing rate; unknown articles are blocked\n");
