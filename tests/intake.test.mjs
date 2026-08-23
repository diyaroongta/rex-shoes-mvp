import assert from "node:assert/strict";
import { buildPhotoCards } from "../shared/intake.js";
import { buildMultiPI } from "../shared/pi.js";
import { INPUTS } from "../shared/inputs.js";
import { setReference } from "../shared/bridge.js";

setReference(INPUTS);
console.log("\nhandwritten intake — exact sizes survive through PI");

const parsed={date:"2026-08-19",orders:[{
  party:"KP Gurgaon",category:"Spike",color:"N.Blue / S.Blue",lines:[
    {sizes:["10"],cartons:1,type:"VELCRO"},
    {sizes:["12"],cartons:1,type:"VELCRO"},
    {sizes:["13"],cartons:2,type:"VELCRO"},
    {sizes:["1"],cartons:2,type:"VELCRO"},
    {sizes:["3"],cartons:1,type:"VELCRO"},
    {sizes:["4"],cartons:1,type:"VELCRO"},
    {sizes:["5"],cartons:1,type:"VELCRO"},
    {sizes:["6"],cartons:2,type:"LACE"},
    {sizes:["8"],cartons:1,type:"LACE"},
    {sizes:["10"],cartons:1,type:"LACE"},
    {sizes:["11"],cartons:1,type:"LACE"},
  ]
}]};

const built=buildPhotoCards(parsed,INPUTS);
assert.deepEqual(built.issues,[]);
assert.equal(built.cards.length,2,"one handwritten article with V and L sections becomes two typed order items");
const velcro=built.cards.find(c=>c.vl==="VELCRO");
const lace=built.cards.find(c=>c.vl==="LACE");
assert.deepEqual(velcro.lines.map(l=>l.combo),["7X10S","11X1","2X5"]);
assert.deepEqual(velcro.lines.find(l=>l.combo==="11X1").sizes,{"12s":24,"13s":48,"1":48});
assert.deepEqual(lace.lines.find(l=>l.combo==="9X12").sizes,{"10":18,"11":18},
  "adult SPIKE sizes must use ARMOUR's 18-pair single-size packing rate");

const pi=buildMultiPI(built.cards.map(card=>({
  article_code:card.article,vl:card.vl,lines:card.lines,
  mrp:Object.fromEntries(card.lines.map(line=>[line.combo,100])),
})));
const qtyBySize=Object.fromEntries(pi.lines.map(line=>[`${line.article_code}:${cardType(line.item)}:${line.size}`,line.qty]));
function cardType(index){return built.cards[index].vl;}
assert.equal(qtyBySize["SPIKE:VELCRO:12s"],24);
assert.equal(qtyBySize["SPIKE:VELCRO:13s"],48);
assert.equal(qtyBySize["SPIKE:LACE:10"],18);
assert.equal(qtyBySize["SPIKE:LACE:11"],18);
assert.equal(pi.lines.filter(line=>line.item===1).length,4,
  "the lace PI contains only the four sizes actually ordered, not every size in both ranges");

const ambiguous=buildPhotoCards({orders:[{category:"Spike",lines:[{sizes:["11"],cartons:1}]}]},INPUTS);
assert.ok(ambiguous.issues.some(issue=>issue.includes("V/L was not readable")));

console.log("  pass  photo stacks retain exact sizes, type and packing rate\n");
