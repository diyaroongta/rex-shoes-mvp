import { beforeEach, describe, expect, it, vi } from "vitest";

/* A twelve-hour session ends while a tab is open, and the next reference-data
   load is refused. What the user must then see is the login box — not the
   blocking "Factory OS could not start safely" screen, which reads as a broken
   deployment and sends them to the wrong person.
   hydrate() rewrites the errors it catches into a data-integrity message, so
   the one error that must NOT be rewritten needs holding down by a test. */
const mocks = vi.hoisted(()=>{
  class NotSignedIn extends Error {
    constructor(m){ super(m || "Sign in required"); this.name = "NotSignedIn"; }
  }
  return { NotSignedIn, getReference: vi.fn(), getCatalogue: vi.fn() };
});
vi.mock("../../src/lib/client.js", ()=>({
  NotSignedIn: mocks.NotSignedIn,
  getReference: mocks.getReference,
  getCatalogue: mocks.getCatalogue,
  onSignedOut: ()=>()=>{},
}));

import { hydrate } from "../../src/lib/refdata.js";

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.getCatalogue.mockResolvedValue({});
});

describe("startup when the session has ended", ()=>{
  it("passes a signed-out failure through untouched, so the app can show the login screen", async ()=>{
    mocks.getReference.mockRejectedValue(new mocks.NotSignedIn("Sign in required"));
    await expect(hydrate()).rejects.toMatchObject({ name:"NotSignedIn" });
  });

  it("still blocks startup on a genuine reference-data failure", async ()=>{
    mocks.getReference.mockRejectedValue(new Error("500 — Server error"));
    await expect(hydrate()).rejects.toThrow(/Could not load the live article master/);
  });
});
