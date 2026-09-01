/* Reading a password from a terminal without echoing it.
 *
 * Split out of create-user.mjs so the key handling can be tested directly.
 * It has to be tested, because every failure here is invisible: nothing is
 * echoed, so a password that picked up stray bytes looks exactly like one that
 * did not — and the damage only shows up later, at a login that cannot
 * possibly succeed.
 */

const ESC = "\u0003";              // Ctrl-C
const DEL = "\u007f";              // Backspace on macOS
const ESCAPE = "\u001b";           // start of an ANSI sequence

/* An arrow key does not send "an arrow". It sends ESC [ A — three bytes. A
 * loop that merely skips control characters keeps the "[A" and silently welds
 * it into the middle of the password. The user sees nothing, types the same
 * arrow again at the confirm prompt or does not, and either sets a password
 * containing "[A" or is told the two do not match with no idea why.
 *
 * So escape sequences are parsed and swallowed WHOLE:
 *   phase 0  ordinary text
 *   phase 1  seen ESC, waiting to see what kind of sequence it is
 *   phase 2  inside CSI (ESC[) or SS3 (ESCO), until the final byte @..~
 */
export function newPromptState(){ return { value:"", phase:0 }; }

export function feedKeys(state, chunk){
  for(const c of chunk){
    if(state.phase === 1){
      // ESC [ ... (CSI, arrows/Home/End) or ESC O ... (SS3, application mode)
      state.phase = (c === "[" || c === "O") ? 2 : 0;   // anything else: Alt+key, drop both
      continue;
    }
    if(state.phase === 2){
      // Final byte of the sequence is anything in @ .. ~
      if(c >= "@" && c <= "~") state.phase = 0;
      continue;
    }
    if(c === ESCAPE){ state.phase = 1; continue; }
    if(c === "\r" || c === "\n") return { done:true, value:state.value };
    if(c === ESC) return { cancelled:true };
    if(c === DEL || c === "\b"){ state.value = state.value.slice(0, -1); continue; }
    if(c === "\u0015"){ state.value = ""; continue; }          // Ctrl-U: kill the line
    if(c < " ") continue;                                       // any other control byte
    state.value += c;
  }
  return { done:false };
}

/* Ask several questions inside ONE raw-mode session. Restoring the terminal
   between them reopens a window in canonical mode, where the tty itself
   echoes — anyone typing ahead of the second prompt watches their password
   appear on screen. */
export function hiddenPrompts(questions, io = process){
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = io;
    if(!stdin.isTTY){
      reject(new Error("Run this in a terminal — the password prompt needs one."));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    /* Throw away anything typed BEFORE the prompt appeared. There is a real
       gap here — the caller talks to the database first — and in that gap the
       terminal is still echoing, so type-ahead is both visible on screen and,
       worse, would be prepended to the password. Discarding it means the
       password is exactly what was typed at the prompt and nothing else. */
    let drained; do { drained = stdin.read(); } while(drained);

    const answers = [];
    let state = newPromptState();
    const restore = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); };
    const onData = chunk => {
      const out = feedKeys(state, chunk);
      if(out.cancelled){ restore(); stdout.write("\n"); io.exit(130); return; }
      if(!out.done) return;
      answers.push(out.value);
      state = newPromptState();
      stdout.write("\n");
      if(answers.length === questions.length){ restore(); resolve(answers); return; }
      stdout.write(questions[answers.length]);
    };
    stdin.on("data", onData);
    stdout.write(questions[0]);
  });
}
