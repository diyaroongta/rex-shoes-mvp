import assert from "node:assert/strict";
import { materialCheck } from "../shared/can-we-make-it.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nshared/can-we-make-it.js — material availability at PI time");

const article = { combos:{ "2X5":{ rates:{ CUTTING:{ "REXINE||MTR":0.5, "FOAM||SHEET":0.1 } } } } };
const materials = { "REXINE||MTR":{ name:"REXINE", uom:"MTR", stock:0 },
                    "FOAM||SHEET":{ name:"FOAM", uom:"SHEET", stock:0 } };
const lines = [{ combo:"2X5", qty:1000 }];

ok("uses the register's own balance, not the opening figure", () => {
  /* Opening 100, received 600, issued 50 = 650 — the number the store screen
     prints. Reading `stock` alone would have said 100 and cried shortage. */
  const out = materialCheck(lines, article,
    materials, { "REXINE||MTR":{ opening:100, rec:600, issue:50 }, "FOAM||SHEET":{ opening:500 } });
  const rexine = out.rows.find(r => r.key === "REXINE||MTR");
  assert.equal(rexine.required, 500, "1,000 pairs at 0.5");
  assert.equal(rexine.available, 650);
  assert.equal(rexine.shortfall, 0);
  assert.equal(out.can_make, true);
});

ok("names what is short, worst first", () => {
  const out = materialCheck(lines, article, materials,
    { "REXINE||MTR":{ opening:200 }, "FOAM||SHEET":{ opening:10 } });
  assert.equal(out.can_make, false);
  assert.equal(out.short_count, 2);
  assert.equal(out.short[0].name, "REXINE", "300 short beats 90 short");
  assert.equal(out.short[0].shortfall, 300);
});

/* A material the BOM names but the master does not hold is unknown, not zero:
   "I do not know" and "there is none" are different answers. */
ok("a material the master does not hold reads as unknown, not as zero", () => {
  const out = materialCheck(lines, article, { "REXINE||MTR":materials["REXINE||MTR"] },
    { "REXINE||MTR":{ opening:9999 } });
  assert.equal(out.unknown_count, 1);
  assert.equal(out.unknown[0].available, null);
  assert.equal(out.unknown[0].shortfall, null);
  assert.equal(out.can_make, false, "an unknown material is not a green light");
});

/* THE SILENT CASE. An article with size ranges and no rates produces no rows.
   Reporting that as "we can make it" is exactly the fault that let REX GOLA
   PLUS carry 10,015 pairs and generate no material demand at all. */
ok("an article with no BOM rates is 'not costed', never 'can make it'", () => {
  const out = materialCheck([{ combo:"2X5", qty:1000 }], { combos:{ "2X5":{ rates:{} } } }, materials, {});
  assert.equal(out.materials, 0);
  assert.equal(out.costed, false);
  assert.equal(out.can_make, false);
});

ok("no lines, no article, no materials — answers rather than throwing", () => {
  assert.equal(materialCheck([], {}, {}, {}).can_make, false);
  assert.equal(materialCheck(undefined, undefined).materials, 0);
});

console.log(`\n${checks} checks passed`);
