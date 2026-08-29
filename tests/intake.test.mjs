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
/* The single-packsize chart is banded kids 24 / adult 18, and those are SIZE
   bands, not closures. 12s and 13s are kids sizes so they pack at 24; size 1
   is an adult size and packs at 18, even though it sits in the Velcro half.
   Reading the V marker as "kids" is what charged 2X5 at 24 a carton when its
   own range says 18. */
assert.deepEqual(card.lines.find(l=>l.combo==="11X1").sizes,{"12s":24,"13s":48,"1":36});
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
assert.ok(readPrompt().includes("A free-standing L, or L beside a size, always means Large"));
assert.ok(readPrompt().includes("LEGACY ARTICLE-CODE EXCEPTION"),
  "an official catalogue suffix such as REX GOLA (L) remains the legacy Lace article");

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

/* A bare 8 on REX GOLA fits 8X10 (as 8s) and 8X10B (as 8). Both ranges are
   real, and the ASCENDING RULE is what separates them: nothing on the sheet has
   started the Large run, so this is the Small 8X10. The run and the CLOSURE are
   independent facts — knowing the line is Velcro used to switch the ascending
   rule off entirely, which left every such range unresolved for the clerk to
   pick by hand. */
const tie=buildPhotoCards({orders:[{category:"Gala",lines:[{sizes:["8","10"],cartons:2,type:"VELCRO"}]}]},INPUTS);
assert.deepEqual(tie.issues,[],tie.issues.join(" | "));
const tieLine=tie.cards[0].lines[0];
assert.equal(tieLine.combo,"8X10","the ascending rule reads an unmarked leading 8X10 as the Small run");
assert.deepEqual(tieLine.size_order,["8s","9s","10s"],"and it is costed against the Small range's own sizes");

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

/* ---- 27-Aug-2026, Bansal Barnala, "Gola V BLACK" ----------------------------
   Five stacks written across one line, two of them with a RANGE on top:

       7X10   11X13   11   2   6
       ----   -----   --   -   -
         5      4      2   5   7

   Every failure this slip produced is asserted here.

   1. Each stack is its OWN line. Three separate single sizes used to collapse
      into one row labelled "11s, 2, 6" carrying 12.75 cartons, because two
      lines that had both failed to resolve compared equal on `combo === null`.
   2. The run comes from the ascending sequence and NOT from the closure. Gola
      is a Velcro article, and knowing that used to switch the sequence off, so
      no size was ever spelled 11s.
   3. 11 is Small (nothing has started the Large run); 2 restarts the numerals
      so it is Large, and the 6 after it stays Large.
   4. A Large 6 is costed against the adult 6X7B and must pack at that range's
      18 pairs a carton, not the kids band's 24. */
const bansal=buildPhotoCards({orders:[{party:"Bansal Barnala",category:"Gola",color:"Black",type:"VELCRO",lines:[
  {sizes:["7","10"],cartons:5},
  {sizes:["11","13"],cartons:4},
  {sizes:["11"],cartons:2},
  {sizes:["2"],cartons:5},
  {sizes:["6"],cartons:7},
]}]},INPUTS);
const bansalCard=bansal.cards[0];
assert.equal(bansalCard.article,"REX GOLA (V)");
assert.equal(bansalCard.lines.length,5,"five stacks are five lines — unresolved sizes must never merge into one row");
assert.deepEqual(bansalCard.lines.map(l=>l.raw),["7X10","11X13","11","2","6"],
  "the line label is provenance: what the slip wrote, not a spelling the app inferred");
assert.deepEqual(bansalCard.lines.map(l=>l.combo),[null,"11X13","11X13","1X3","6X7B"],
  "ranges resolve as ranges; 11 is Small, then 2 restarts the numerals so 2 and 6 are Large");
assert.deepEqual(bansalCard.lines[2].sizes,{"11s":48},"an unmarked 11 before any Large size is the Small 11s");
assert.deepEqual(bansalCard.lines[3].sizes,{"2":90});
assert.deepEqual(bansalCard.lines[4].sizes,{"6":126},
  "a Large 6 packs at its own 6X7B range rate of 18, not the kids band's 24");
/* REX GOLA's kids run starts at 8s, so 7X10 is not a range this article has.
   That is reported and left uncosted — it is never snapped to the nearby 8X10,
   which would silently change both the BOM and the price. */
assert.equal(bansalCard.lines[0].combo,null);
assert.equal(bansalCard.lines[0].qty,0);
assert.ok(bansal.issues.some(i=>i.includes("7s×10s is not an exact configured size range")),
  "a range the article does not have must be surfaced, not snapped to its neighbour");

/* The notation rules the reader is given. The fraction bar and the range
   joiner look alike once transcribed flat, and conflating them is what turned
   "11 over 2 cartons" into the size pair 11-and-2. */
assert.ok(readPrompt().includes("A FRACTION BAR IS NEVER A RANGE JOINER"));
assert.ok(readPrompt().includes("THE TOP OF A STACK IS OFTEN A RANGE"));
assert.ok(readPrompt().includes('"sizes":["7","10"],"cartons":5'),
  "the reader is shown a worked slip that mixes ranges and single sizes");

/* ---- K.P. Gurgaon, "Spike N.Blue/S.Blue" --------------------------------
   The slip writes two ROWS of columns under one product, the second marked
   "(2)", each with its own subtotal and a grand total of 14 CTN:

       10  12  13  1  3  4  5   = 9        (2)  6  8  10  11   = 5
        1   1   2  2  1  1  1                   2  1   1   1        = 14 CTN

   1. Eleven columns are eleven lines. "(2)" is the second LOT of the same
      Spike, not a second customer — the reader used to drop that whole row.
   2. Cartons are ADDED, never re-derived. 11X1 holds 12s and 13s at 24 to a
      carton and size 1 at 18, so 1+2+2 = 5 written cartons came back as
      108 pairs / 24 = 4.5, and the sheet's own total stopped adding up.
   3. The stated total is CHECKED, because a dropped row otherwise produces
      lines that each look perfectly reasonable. */
const kpLines=[
  {sizes:["10"],cartons:1},{sizes:["12"],cartons:1},{sizes:["13"],cartons:2},
  {sizes:["1"],cartons:2},{sizes:["3"],cartons:1},{sizes:["4"],cartons:1},{sizes:["5"],cartons:1},
  {sizes:["6"],cartons:2},{sizes:["8"],cartons:1},{sizes:["10"],cartons:1},{sizes:["11"],cartons:1},
];
const kp=buildPhotoCards({orders:[{party:"K.P. Gurgaon",category:"Spike",
  color:"N.Blue / S.Blue",stated_cartons:14,lines:kpLines}]},INPUTS);
assert.deepEqual(kp.issues,[],kp.issues.join(" | "));
const kpCard=kp.cards[0];
assert.equal(kpCard.lines.reduce((a,l)=>a+Number(l.cartons),0),14,
  "the cartons the slip wrote must survive to the card — they are counted, not re-derived");
const oneToOne=kpCard.lines.find(l=>l.combo==="11X1");
assert.equal(oneToOne.cartons,5,"1 + 2 + 2 written cartons is 5, whatever the sizes pack at");
assert.deepEqual(oneToOne.sizes,{"12s":24,"13s":48,"1":36},
  "each size still uses its OWN packing rate for pairs: 24, 24, and 18");
// The same numeral in both runs is two different sizes, and both are kept.
assert.ok(kpCard.lines.some(l=>l.sizes&&l.sizes["10s"]),"the Small 10 from the first row");
assert.ok(kpCard.lines.some(l=>l.sizes&&l.sizes["10"]), "the Large 10 from the second row");

/* THE CHECKSUM EARNS ITS KEEP. Drop the second lot, exactly as the reader did,
   and the lines that remain are individually plausible — only the total says
   the read is short. */
const dropped=buildPhotoCards({orders:[{party:"K.P. Gurgaon",category:"Spike",
  color:"N.Blue / S.Blue",stated_cartons:14,lines:kpLines.slice(0,7)}]},INPUTS);
assert.ok(dropped.issues.some(i=>i.includes("totals 14 cartons but only 9")),
  "a dropped row must be caught by the sheet's own total: "+dropped.issues.join(" | "));
// With no total written there is nothing to check, and nothing is invented.
const noTotal=buildPhotoCards({orders:[{party:"K.P. Gurgaon",category:"Spike",
  color:"N.Blue / S.Blue",lines:kpLines.slice(0,7)}]},INPUTS);
assert.deepEqual(noTotal.issues,[],"no stated total means no checksum, not a guessed one");

assert.ok(readPrompt().includes("A BARE NUMBER IN BRACKETS IS NOT A CUSTOMER"),
  "a row headed (2) is the second lot of the product above, not a new party");
assert.ok(readPrompt().includes("A ROW OF COLUMNS IS THE SAME THING, REPEATED"));
assert.ok(readPrompt().includes('"stated_cartons"'),
  "the reader must hand back the total so the app can check it independently");

console.log("  pass  photo stacks retain exact sizes, type and packing rate; unknown articles are blocked\n");
