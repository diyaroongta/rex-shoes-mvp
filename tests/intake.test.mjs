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
assert.ok(built.issues.some(issue=>issue.includes("V/L was not readable for sizes 10, 12, 13")));

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
assert.ok(ambiguous.issues.some(issue=>issue.includes("V/L was not readable")));

const unknown=buildPhotoCards({orders:[{
  party:"KP Gurgaon",category:"GLAMOUR",color:"WHI / U COL",lines:[
    {sizes:["13"],cartons:1,type:"VELCRO"},
  ],
}]},INPUTS);
assert.equal(unknown.cards.length,0,"an unknown handwritten article must not fall back to the first catalogue article");
assert.ok(unknown.issues.some(issue=>issue.includes("GLAMOUR: no configured article match")));
assert.ok(readPrompt().includes("NEVER force an unknown product onto the closest catalogue name"),
  "the AI reader must preserve an unknown heading so intake can block it safely");

console.log("  pass  photo stacks retain exact sizes, type and packing rate; unknown articles are blocked\n");
