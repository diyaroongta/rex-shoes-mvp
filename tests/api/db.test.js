import { afterEach, expect, it, vi } from "vitest";

/* A Neon idle timeout arrives as an 'error' on the POOL. With no listener
   Node kills the process — the local server died after 99 minutes idle with
   `read ETIMEDOUT`. The pool must survive it. Building a Pool does not
   connect, so this needs no database. */
afterEach(()=>{ vi.resetModules(); delete process.env.DATABASE_URL; });

it("keeps running when an idle Postgres client is dropped", async () => {
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/none";
  const { db } = await vi.importActual("../../api/_lib/db.js");
  const pool = db();
  expect(pool.listenerCount("error")).toBeGreaterThan(0);
  const quiet = vi.spyOn(console, "error").mockImplementation(()=>{});
  expect(() => pool.emit("error", Object.assign(new Error("read ETIMEDOUT"), { code:"ETIMEDOUT" }))).not.toThrow();
  expect(quiet).toHaveBeenCalled();
  quiet.mockRestore();
  await pool.end();
});
