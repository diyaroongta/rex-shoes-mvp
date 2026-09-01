/* Authentication primitives. Deliberately free of any database import, for the
   same reason api/_lib/http.js is: http.js guards every endpoint with the
   session check below, and dragging the Postgres driver in through that path
   would put it into the cold start of the AI endpoints that avoid it.

   Passwords are hashed with scrypt from node:crypto — no dependency to add, no
   native build to break on Vercel. Sessions are a signed cookie rather than a
   sessions table, so verifying one is pure arithmetic on the request itself. */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

export const COOKIE = "fos_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
/* Twelve hours: a full factory shift, so nobody is signed out mid-order, and a
   laptop left open overnight is not still signed in the next morning. */
export const SESSION_SECONDS = 12 * 60 * 60;

const b64 = buf => Buffer.from(buf).toString("base64url");

/* ---- passwords ---- */

export const MIN_PASSWORD = 8;
/* A cap, because scrypt's cost is paid per byte and the login endpoint is the
   one thing an anonymous caller can reach. Far above any real passphrase. */
export const MAX_PASSWORD = 512;

/* The SAME text can be two different strings. "é" is either one code point or
   an "e" plus a combining accent, and which one you get depends on the
   keyboard, the operating system and where the text was pasted from — the two
   look identical on screen and hash differently. Normalising on both the
   setting side and the checking side is what stops a password that was typed
   correctly from being rejected. */
export function normalisePassword(password){
  if(typeof password !== "string") return null;
  return password.normalize("NFC");
}

/* Control characters cannot be typed into a browser password field, so a
   password holding one could never be entered again — it is a corrupted read
   from a terminal, not a password. Refusing it here is the backstop behind the
   escape-sequence handling in scripts/hidden-prompt.mjs. */
const CONTROL = /[\u0000-\u001f\u007f]/;

export function assertUsablePassword(password){
  const value = normalisePassword(password);
  if(value == null) throw new Error("password must be text");
  if(value.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
  if(value.length > MAX_PASSWORD) throw new Error(`password is too long (limit ${MAX_PASSWORD} characters)`);
  if(CONTROL.test(value))
    throw new Error("password contains a control character — retype it without arrow keys or pasted line breaks");
  return value;
}

export function hashPassword(password){
  const value = assertUsablePassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(value, salt, SCRYPT.keylen, { N:SCRYPT.N, r:SCRYPT.r, p:SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(hash)}`;
}

/* Returns false for a wrong password AND for a stored value we cannot read.
   A hash written by some future scheme must never be treated as a match. */
export function verifyPassword(password, stored){
  if(typeof password !== "string" || typeof stored !== "string") return false;
  if(password.length > MAX_PASSWORD) return false;      // never hash an unbounded input
  const value = normalisePassword(password);
  const parts = stored.split("$");
  if(parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  let expected, actual;
  try{
    expected = Buffer.from(hash, "base64url");
    actual = scryptSync(value, Buffer.from(salt, "base64url"), expected.length,
                        { N:Number(N), r:Number(r), p:Number(p) });
  }catch(_){ return false; }
  if(expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/* ---- sessions ---- */

export function authSecret(){
  const s = process.env.AUTH_SECRET;
  /* Fail closed. A short or missing secret means signatures can be forged, so
     the portal refuses to authenticate rather than appearing to be protected
     while accepting a cookie anybody could mint. */
  if(!s || s.length < 32)
    throw new Error("AUTH_SECRET is not set (needs at least 32 characters) — sign-in is disabled until it is");
  return s;
}

const sign = (data, secret) => createHmac("sha256", secret).update(data).digest();

/* token = base64url(payload JSON) . base64url(HMAC of that same string) */
export function signSession(user, { now = Date.now(), seconds = SESSION_SECONDS, secret = null } = {}){
  const key = secret || authSecret();
  const payload = { u: user.username, r: user.role || "admin",
                    n: user.display_name || user.username,
                    iat: Math.floor(now/1000), exp: Math.floor(now/1000) + seconds };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(sign(body, key))}`;
}

/* The verified session, or null. Never throws on a malformed cookie — a
   corrupt or tampered token is simply "not signed in". */
export function readSession(token, { now = Date.now(), secret = null } = {}){
  if(typeof token !== "string" || !token.includes(".")) return null;
  let key;
  try{ key = secret || authSecret(); }catch(_){ return null; }
  const [body, mac] = token.split(".");
  let given, expected;
  try{
    given = Buffer.from(mac || "", "base64url");
    expected = sign(body, key);
  }catch(_){ return null; }
  if(given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try{ payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch(_){ return null; }
  if(!payload || !payload.u || !payload.exp) return null;
  if(payload.exp * 1000 <= now) return null;                  // expired
  return { username: payload.u, role: payload.r || "admin", display_name: payload.n || payload.u,
           issued_at: payload.iat, expires_at: payload.exp };
}

/* ---- cookies ---- */

export function parseCookies(req){
  if(req && req.cookies && typeof req.cookies === "object") return req.cookies;  // Vercel parses these for us
  const raw = (req && req.headers && req.headers.cookie) || "";
  const out = {};
  for(const part of String(raw).split(";")){
    const i = part.indexOf("=");
    if(i < 0) continue;
    const k = part.slice(0, i).trim();
    if(!k) continue;
    try{ out[k] = decodeURIComponent(part.slice(i+1).trim()); }
    catch(_){ out[k] = part.slice(i+1).trim(); }
  }
  return out;
}

/* Secure is omitted on plain-HTTP localhost only; a browser silently drops a
   Secure cookie there, which reads as "login does nothing" during local dev. */
const isLocal = req => /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(String((req && req.headers && req.headers.host) || ""));

export function sessionCookie(token, req, seconds = SESSION_SECONDS){
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${seconds}`];
  if(!isLocal(req)) flags.push("Secure");
  return `${COOKIE}=${token}; ${flags.join("; ")}`;
}
export function clearedCookie(req){
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if(!isLocal(req)) flags.push("Secure");
  return `${COOKIE}=; ${flags.join("; ")}`;
}

/* The signed-in user on this request, or null. */
export function sessionOf(req){
  return readSession(parseCookies(req)[COOKIE]);
}
