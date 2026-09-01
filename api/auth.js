import { q } from "./_lib/db.js";
import { fail, wrap } from "./_lib/http.js";
import { verifyPassword, hashPassword, signSession, sessionOf, authSecret,
         sessionCookie, clearedCookie, SESSION_SECONDS } from "./_lib/auth.js";

/* The only endpoint that is reachable without a session — everything else is
   guarded by wrap(). It is therefore also the only one an attacker can talk
   to, which is why the lockout and the timing below matter here and nowhere
   else. */

const LOCK_AFTER = 5;              // consecutive failures
const LOCK_MINUTES = 15;

/* One reply for "no such user", "wrong password" and "inactive account". A
   different message for each tells an attacker which usernames exist. */
const BAD = "Incorrect username or password";

export default wrap(async (req, res) => {
  /* Who am I? The browser calls this before the first render to decide
     between the login screen and the app. */
  if(req.method === "GET"){
    const user = sessionOf(req);
    return res.status(200).json(user ? { authenticated:true, user } : { authenticated:false });
  }

  if(req.method === "DELETE"){
    res.setHeader("Set-Cookie", clearedCookie(req));
    return res.status(200).json({ ok:true });
  }

  if(req.method === "POST"){
    const b = req.body || {};

    if(b.action === "logout"){
      res.setHeader("Set-Cookie", clearedCookie(req));
      return res.status(200).json({ ok:true });
    }

    /* Changing your own password needs the current one, so a session left open
       on a shared terminal cannot be used to lock the owner out. */
    if(b.action === "change_password"){
      const me = sessionOf(req);
      if(!me) return fail(res, 401, "Sign in required");
      const next = String(b.new_password || "");
      if(next.length < 8) return fail(res, 400, "The new password must be at least 8 characters");
      const { rows } = await q("select password_hash from users where username = $1 and active", [me.username]);
      if(!rows.length || !verifyPassword(String(b.current_password || ""), rows[0].password_hash))
        return fail(res, 403, "Current password is incorrect");
      await q("update users set password_hash = $2, updated_at = now() where username = $1",
              [me.username, hashPassword(next)]);
      return res.status(200).json({ ok:true });
    }

    /* Checked before the password, so an unconfigured deployment says so
       instead of failing as though the password were wrong. Without this the
       first symptom of a missing environment variable is a correct password
       being rejected, which sends people to reset an account that is fine. */
    try{ authSecret(); }
    catch(e){ return fail(res, 503, `${e.message}. Set it in Vercel → Settings → Environment Variables and redeploy.`); }

    const username = String(b.username || "").trim().toLowerCase();
    const password = String(b.password || "");
    if(!username || !password) return fail(res, 400, "Enter your username and password");

    const { rows } = await q(
      `select username, password_hash, display_name, role, active, failed_attempts,
              locked_until, locked_until > now() as locked
         from users where username = $1`, [username]);
    const row = rows[0];

    if(row && row.locked){
      const mins = Math.max(1, Math.ceil((new Date(row.locked_until) - Date.now()) / 60000));
      return fail(res, 429, `Too many failed attempts. Try again in ${mins} minute${mins===1?"":"s"}.`);
    }

    /* Verify even when the user does not exist, against a hash that cannot
       match, so a missing username does not answer noticeably faster than a
       wrong password. */
    const ok = row && row.active
      ? verifyPassword(password, row.password_hash)
      : (verifyPassword(password, DUMMY_HASH), false);

    if(!ok){
      /* First run has exactly one cause and it is not a typo: the schema is
         applied but nobody has been created yet. Saying so reveals nothing —
         there are no usernames to enumerate — and saying nothing instead sends
         people round in circles retyping a password that was never stored. */
      if(!row){
        const { rows:[{ n }] } = await q("select count(*)::int as n from users");
        if(n === 0) return fail(res, 401,
          "No accounts exist yet. Create the first one with: npm run user:create -- <username>");
      }
      if(row){
        const attempts = Number(row.failed_attempts || 0) + 1;
        /* The lock is worked out here rather than in SQL. Expressed as a CASE
           over the same placeholder, Postgres had to deduce one type for $2
           from both `failed_attempts = $2` and `$2 >= $3` and refused the
           statement outright (42P08) — so a wrong password answered 500
           instead of 401 AND the counter never advanced, quietly disabling the
           lockout. One parameter, one type, is what makes that impossible. */
        const lockedUntil = attempts >= LOCK_AFTER
          ? new Date(Date.now() + LOCK_MINUTES * 60000)
          : (row.locked_until || null);
        await q(`update users set failed_attempts = $2, locked_until = $3, updated_at = now()
                  where username = $1`, [username, attempts, lockedUntil]);
      }
      return fail(res, 401, BAD);
    }

    await q(`update users set failed_attempts = 0, locked_until = null,
                    last_login_at = now(), updated_at = now()
              where username = $1`, [username]);

    const user = { username: row.username, role: row.role, display_name: row.display_name || row.username };
    res.setHeader("Set-Cookie", sessionCookie(signSession(user), req, SESSION_SECONDS));
    return res.status(200).json({ authenticated:true, user });
  }

  return fail(res, 405, `${req.method} not allowed`);
}, { public: true });

/* A real scrypt hash of a value nobody will ever type, used only to spend the
   same time on an unknown username as on a known one. */
const DUMMY_HASH = hashPassword("factory-os-timing-equaliser-not-a-password");
