import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(()=>({ q: vi.fn(), connect: vi.fn() }));
vi.mock("../../api/_lib/db.js", ()=>({ q: dbMocks.q, db: ()=>({ connect: dbMocks.connect }) }));

process.env.AUTH_SECRET = "test-only-secret-of-at-least-32-characters";

import authHandler from "../../api/auth.js";
import ordersHandler from "../../api/orders/index.js";
import { COOKIE, hashPassword, verifyPassword, signSession, readSession,
         parseCookies, SESSION_SECONDS } from "../../api/_lib/auth.js";

const SECRET = process.env.AUTH_SECRET;

function response(){
  return {
    statusCode:200, body:null, headers:{},
    status(c){ this.statusCode=c; return this; },
    json(b){ this.body=b; return this; },
    setHeader(k,v){ this.headers[k]=v; return this; },
  };
}
const cookieHeader = token => ({ cookie: `${COOKIE}=${token}` });
/* A real account row, as api/auth.js selects it. */
const userRow = (over={}) => ({
  username:"abhay", password_hash: hashPassword("factory-floor-2026"),
  display_name:"Abhay", role:"admin", active:true,
  failed_attempts:0, locked_until:null, locked:false, ...over,
});

beforeEach(()=>{ vi.resetAllMocks(); process.env.AUTH_SECRET = SECRET; });
afterEach(()=>{ process.env.AUTH_SECRET = SECRET; });

describe("password hashing", ()=>{
  it("round-trips a password and rejects a wrong one", ()=>{
    const stored = hashPassword("factory-floor-2026");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("factory-floor-2026");     // no plaintext anywhere
    expect(verifyPassword("factory-floor-2026", stored)).toBe(true);
    expect(verifyPassword("factory-floor-2027", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", ()=>{
    expect(hashPassword("factory-floor-2026")).not.toBe(hashPassword("factory-floor-2026"));
  });

  it("refuses a short password and any hash it cannot read", ()=>{
    expect(()=>hashPassword("short")).toThrow(/at least 8/);
    // A hash written by some other scheme must never be treated as a match.
    expect(verifyPassword("anything", "bcrypt$2b$10$whatever")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });
});

describe("session tokens", ()=>{
  it("verifies its own token and rejects a tampered one", ()=>{
    const token = signSession({ username:"abhay", role:"admin", display_name:"Abhay" });
    expect(readSession(token)).toMatchObject({ username:"abhay", role:"admin", display_name:"Abhay" });
    expect(readSession(token.slice(0,-2)+"aa")).toBe(null);
    expect(readSession("nonsense")).toBe(null);
    expect(readSession(undefined)).toBe(null);
  });

  it("cannot be forged with a different secret", ()=>{
    const token = signSession({ username:"abhay" }, { secret:"an-attackers-own-secret-32-characters" });
    expect(readSession(token)).toBe(null);            // verified against the real one
  });

  it("expires", ()=>{
    const token = signSession({ username:"abhay" });
    expect(readSession(token, { now: Date.now() + (SESSION_SECONDS - 60)*1000 })).toBeTruthy();
    expect(readSession(token, { now: Date.now() + (SESSION_SECONDS + 60)*1000 })).toBe(null);
  });

  it("reads the session cookie out of a raw header", ()=>{
    expect(parseCookies({ headers:{ cookie:`other=1; ${COOKIE}=abc.def` } })[COOKIE]).toBe("abc.def");
    expect(parseCookies({ headers:{} })[COOKIE]).toBe(undefined);
  });
});

describe("the guard on every endpoint", ()=>{
  it("refuses a request with no session", async ()=>{
    const res = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.auth).toBe("required");
    expect(dbMocks.q).not.toHaveBeenCalled();          // never reached the database
  });

  it("refuses a tampered session", async ()=>{
    const bad = signSession({ username:"abhay" }).slice(0,-3) + "zzz";
    const res = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{}, headers:cookieHeader(bad) }, res);
    expect(res.statusCode).toBe(401);
    expect(dbMocks.q).not.toHaveBeenCalled();
  });

  it("admits a valid session", async ()=>{
    dbMocks.q.mockResolvedValue({ rows:[] });
    const res = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{},
                          headers:cookieHeader(signSession({ username:"abhay" })) }, res);
    expect(res.statusCode).toBe(200);
  });

  /* Fail closed. An unset AUTH_SECRET means signatures could be forged, so the
     portal must refuse rather than look protected while accepting anything. */
  it("refuses everyone, with a fixable message, when AUTH_SECRET is missing", async ()=>{
    delete process.env.AUTH_SECRET;
    const res = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/AUTH_SECRET/);
  });
});

describe("signing in", ()=>{
  it("sets an HttpOnly session cookie and returns the user", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow()] }).mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{ host:"factory.vercel.app" },
                        body:{ username:"Abhay", password:"factory-floor-2026" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({ username:"abhay", role:"admin" });
    const setCookie = res.headers["Set-Cookie"];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    // The cookie the browser gets is a session this deployment will accept.
    expect(readSession(setCookie.split(";")[0].slice(COOKIE.length+1))).toMatchObject({ username:"abhay" });
    // The username is matched lower-case, so "Abhay" signs in as "abhay".
    expect(dbMocks.q.mock.calls[0][1]).toEqual(["abhay"]);
  });

  it("never leaks a password or its hash back to the browser", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow()] }).mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"factory-floor-2026" } }, res);
    expect(JSON.stringify(res.body)).not.toContain("factory-floor-2026");
    expect(JSON.stringify(res.body)).not.toContain("scrypt$");
  });

  it("gives the same answer for a wrong password and an unknown user", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow()] }).mockResolvedValueOnce({ rows:[] });
    const wrong = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"not-the-password" } }, wrong);

    dbMocks.q.mockResolvedValueOnce({ rows:[] })                 // no such user
             .mockResolvedValueOnce({ rows:[{ n:1 }] });         // but accounts do exist
    const unknown = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"nobody", password:"not-the-password" } }, unknown);

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    // Identical, or the login form tells an attacker which usernames exist.
    expect(wrong.body.error).toBe(unknown.body.error);
    expect(wrong.headers["Set-Cookie"]).toBe(undefined);
  });

  it("counts failures and locks the account before a password can be guessed", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow({ failed_attempts:4 })] })
             .mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"wrong" } }, res);
    expect(res.statusCode).toBe(401);
    const [sql, params] = dbMocks.q.mock.calls[1];
    expect(String(sql)).toMatch(/failed_attempts\s*=\s*\$2/);
    expect(params[1]).toBe(5);                 // the fifth failure
    /* The lock is a real timestamp in the future, computed here rather than in
       SQL. Written as a CASE over $2, Postgres refused the whole statement
       (42P08, "inconsistent types deduced for parameter $2"), so a wrong
       password answered 500 instead of 401 and the counter never advanced —
       the lockout was silently dead. Mocked SQL cannot catch a type deduction
       error, so what this asserts instead is the shape that removes it: one
       placeholder, one type, no CASE. */
    expect(params[2]).toBeInstanceOf(Date);
    expect(params[2].getTime()).toBeGreaterThan(Date.now());
    expect(String(sql)).not.toMatch(/case\s+when/i);
  });

  it("leaves an existing lock alone while the count is still climbing", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow({ failed_attempts:1 })] })
             .mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"wrong" } }, res);
    const params = dbMocks.q.mock.calls[1][1];
    expect(params[1]).toBe(2);
    expect(params[2]).toBe(null);              // not locked, and not wrongly locked
  });

  it("turns a locked account away without checking the password at all", async ()=>{
    const locked = new Date(Date.now() + 10*60*1000);
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow({ locked:true, locked_until:locked })] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"factory-floor-2026" } }, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/minute/);
    expect(dbMocks.q).toHaveBeenCalledTimes(1);      // no update, no sign-in
  });

  it("refuses a deactivated account that still has a valid password", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow({ active:false })] })
             .mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"factory-floor-2026" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.headers["Set-Cookie"]).toBe(undefined);
  });

  /* The two refusals a person can actually act on. Both were previously
     indistinguishable from "you typed it wrong", which is the worst possible
     answer because the obvious response — retype it, then reset the account —
     cannot fix either one. */
  it("says the deployment is unconfigured rather than blaming the password", async ()=>{
    delete process.env.AUTH_SECRET;
    dbMocks.q.mockResolvedValue({ rows:[userRow()] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"factory-floor-2026" } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/AUTH_SECRET/);
    expect(res.body.error).toMatch(/Environment Variables/);
    expect(dbMocks.q).not.toHaveBeenCalled();       // decided before touching the database
  });

  it("says no accounts exist yet, instead of 'incorrect password', on a fresh install", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[] })               // no such user
             .mockResolvedValueOnce({ rows:[{ n:0 }] });       // ...because there are none
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"abhay", password:"anything-here" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/No accounts exist yet/);
    expect(res.body.error).toMatch(/user:create/);
  });

  it("still refuses to confirm which usernames exist once accounts are present", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[] })               // no such user
             .mockResolvedValueOnce({ rows:[{ n:3 }] });       // but others exist
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{},
                        body:{ username:"ghost", password:"anything-here" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Incorrect username or password");
  });

  it("clears the session on sign out", async ()=>{
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{ host:"factory.vercel.app" },
                        body:{ action:"logout" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Set-Cookie"]).toMatch(/Max-Age=0/);
  });

  it("reports who is signed in, without a session and with one", async ()=>{
    const out = response();
    await authHandler({ method:"GET", url:"/api/auth", headers:{} }, out);
    expect(out.body).toEqual({ authenticated:false });

    const inn = response();
    await authHandler({ method:"GET", url:"/api/auth",
                        headers:cookieHeader(signSession({ username:"abhay", role:"admin" })) }, inn);
    expect(inn.body.authenticated).toBe(true);
    expect(inn.body.user.username).toBe("abhay");
  });

  it("needs the current password to change the password", async ()=>{
    const session = cookieHeader(signSession({ username:"abhay", role:"admin" }));
    dbMocks.q.mockResolvedValueOnce({ rows:[{ password_hash: hashPassword("factory-floor-2026") }] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:session,
                        body:{ action:"change_password", current_password:"guessing",
                               new_password:"a-new-long-password" } }, res);
    expect(res.statusCode).toBe(403);
    expect(dbMocks.q).toHaveBeenCalledTimes(1);        // nothing written
  });

  it("stores the new password as a hash when the current one is right", async ()=>{
    const session = cookieHeader(signSession({ username:"abhay", role:"admin" }));
    dbMocks.q.mockResolvedValueOnce({ rows:[{ password_hash: hashPassword("factory-floor-2026") }] })
             .mockResolvedValueOnce({ rows:[] });
    const res = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:session,
                        body:{ action:"change_password", current_password:"factory-floor-2026",
                               new_password:"a-new-long-password" } }, res);
    expect(res.statusCode).toBe(200);
    const params = dbMocks.q.mock.calls[1][1];
    expect(params[1].startsWith("scrypt$")).toBe(true);
    expect(params[1]).not.toContain("a-new-long-password");
    expect(verifyPassword("a-new-long-password", params[1])).toBe(true);
  });
});

/* The join between the two halves. Each half can pass its own tests while the
   cookie one writes is not the cookie the other accepts — a wrong flag, a
   wrong name, a wrong encoding — and the portal is then unusable or, worse,
   open. This drives a real sign-in and spends the cookie it hands back. */
describe("end to end: the cookie a sign-in issues opens a guarded endpoint", ()=>{
  it("goes from username and password to a listed order sheet", async ()=>{
    dbMocks.q.mockResolvedValueOnce({ rows:[userRow()] }).mockResolvedValueOnce({ rows:[] });
    const login = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{ host:"factory.vercel.app" },
                        body:{ username:"abhay", password:"factory-floor-2026" } }, login);
    expect(login.statusCode).toBe(200);

    // Exactly what a browser would send back: the name=value pair, no flags.
    const jar = login.headers["Set-Cookie"].split(";")[0];

    dbMocks.q.mockResolvedValue({ rows:[] });
    const orders = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{}, headers:{ cookie: jar } }, orders);
    expect(orders.statusCode).toBe(200);
  });

  it("and the same endpoint is shut again after signing out", async ()=>{
    const out = response();
    await authHandler({ method:"POST", url:"/api/auth", headers:{ host:"factory.vercel.app" },
                        body:{ action:"logout" } }, out);
    const jar = out.headers["Set-Cookie"].split(";")[0];      // fos_session=

    dbMocks.q.mockResolvedValue({ rows:[] });
    const orders = response();
    await ordersHandler({ method:"GET", url:"/api/orders", query:{}, headers:{ cookie: jar } }, orders);
    expect(orders.statusCode).toBe(401);
  });
});

/* Shape, not example: the point of putting the guard in wrap() is that it
   cannot be forgotten. This is the test that says so. */
describe("no endpoint ships unguarded", ()=>{
  const apiFiles = (dir="api") => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if(statSync(path).isDirectory()) return name === "_lib" ? [] : apiFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });

  it("wraps every handler, and only api/auth.js opts out", ()=>{
    const unguarded = [];
    for(const file of apiFiles()){
      const src = readFileSync(file, "utf8");
      const isPublic = /public\s*:\s*true/.test(src);
      if(!/\bwrap\(/.test(src) || (isPublic && file !== "api/auth.js")) unguarded.push(file);
    }
    expect(unguarded).toEqual([]);
  });

  it("keeps the Postgres driver out of the guard's import path", ()=>{
    // http.js guards every endpoint, so anything it imports lands in the cold
    // start of the AI endpoints that deliberately avoid pg.
    for(const file of ["api/_lib/http.js", "api/_lib/auth.js"]){
      expect(readFileSync(file, "utf8")).not.toMatch(/from\s+["'](pg|\.\/db\.js)["']/);
    }
  });
});
