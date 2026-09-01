/* Safeguards on the account script.
 *
 * Everything here is about one failure: a password that is set to something
 * other than what the person believed they typed. It is the worst kind of bug
 * in this area because it is completely invisible — the prompt echoes nothing,
 * so a corrupted password looks identical to a good one, and the only symptom
 * is a login that can never succeed no matter how carefully it is retyped.
 */
import { strict as assert } from "node:assert";
import { newPromptState, feedKeys } from "../scripts/hidden-prompt.mjs";
import { hashPassword, verifyPassword, normalisePassword, MAX_PASSWORD } from "../api/_lib/auth.js";

const ESC = "\u001b", DEL = "\u007f", CTRL_C = "\u0003", CTRL_U = "\u0015";

/* Type a whole line and read back what the prompt captured. */
function typed(...chunks){
  const state = newPromptState();
  let out;
  for(const chunk of chunks) out = feedKeys(state, chunk);
  return out;
}

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

console.log("\nscripts/hidden-prompt.mjs — what the prompt captures");

check("plain typing is captured exactly", ()=>{
  assert.equal(typed("secretpass\r").value, "secretpass");
});

/* THE BUG THIS FILE EXISTS FOR. An arrow key sends ESC [ A. Skipping control
   characters one at a time keeps the "[A" and welds it into the password. */
check("an UP ARROW mid-password is swallowed whole, not turned into '[A'", ()=>{
  assert.equal(typed(`secret${ESC}[Apass\r`).value, "secretpass");
});
check("LEFT and RIGHT arrows are swallowed", ()=>{
  assert.equal(typed(`secret${ESC}[Dpa${ESC}[Css\r`).value, "secretpass");
});
check("Home, End and Delete are swallowed", ()=>{
  assert.equal(typed(`sec${ESC}[Hret${ESC}[Fpass${ESC}[3~\r`).value, "secretpass");
});
check("arrows in application mode (ESC O A) are swallowed", ()=>{
  assert.equal(typed(`secret${ESC}OApass\r`).value, "secretpass");
});
check("an escape sequence split across two reads is still swallowed", ()=>{
  // A terminal can deliver ESC[ and A in separate chunks; the state machine
  // has to survive the boundary or it leaks the letter into the password.
  assert.equal(typed("secret", `${ESC}[`, "Apass\r").value, "secretpass");
});

check("backspace deletes, and Ctrl-U clears the line", ()=>{
  assert.equal(typed(`secretX${DEL}pass\r`).value, "secretpass");
  assert.equal(typed(`throwaway${CTRL_U}secretpass\r`).value, "secretpass");
});

check("Ctrl-C cancels rather than submitting a partial password", ()=>{
  assert.equal(typed(`secret${CTRL_C}`).cancelled, true);
});

check("a password is only returned once Return is pressed", ()=>{
  assert.equal(typed("secretpass").done, false);
});

check("spaces inside a passphrase survive", ()=>{
  assert.equal(typed("correct horse battery staple\r").value, "correct horse battery staple");
});

check("accented and non-Latin characters survive", ()=>{
  assert.equal(typed("café-कारखाना-2026\r").value, "café-कारखाना-2026");
});

console.log("\napi/_lib/auth.js — password normalisation");

/* The same accented character has two valid encodings. A Mac keyboard and a
   paste from a web page can produce different bytes for a password that looks
   identical on screen, and scrypt would then disagree. Both sides normalise. */
check("the two Unicode spellings of an accent are treated as one password", ()=>{
  const composed   = "caf\u00e9-factory";     // é as one code point
  const decomposed = "cafe\u0301-factory";    // e + combining acute
  assert.notEqual(composed, decomposed);                       // genuinely different strings
  assert.equal(normalisePassword(composed), normalisePassword(decomposed));
  assert.equal(verifyPassword(decomposed, hashPassword(composed)), true);
});

check("a password is never silently trimmed", ()=>{
  // Trimming would mean the browser and the script disagree about a pasted
  // password with a trailing space. Neither trims; both keep it verbatim.
  const stored = hashPassword("  spaced out  ");
  assert.equal(verifyPassword("  spaced out  ", stored), true);
  assert.equal(verifyPassword("spaced out", stored), false);
});

check("a password carrying a control character is refused, not stored", ()=>{
  // Belt and braces behind the prompt fix: a browser password field cannot
  // contain these, so a password holding one could never be typed back in.
  assert.throws(()=>hashPassword(`secret${ESC}[Apass`.replace("[A","")), /control character/);
  assert.throws(()=>hashPassword("secret\tpass"), /control character/);
  assert.throws(()=>hashPassword("secret\npass"), /control character/);
});

check("an absurdly long password is refused rather than pinning a CPU", ()=>{
  assert.throws(()=>hashPassword("x".repeat(MAX_PASSWORD + 1)), /too long/);
  assert.equal(verifyPassword("x".repeat(MAX_PASSWORD + 1), hashPassword("x".repeat(64))), false);
});

check("a long passphrase well under the cap still works", ()=>{
  const long = "a-very-long-but-entirely-reasonable-factory-passphrase-2026";
  assert.equal(verifyPassword(long, hashPassword(long)), true);
});

console.log(`\n${passed} checks passed\n`);
