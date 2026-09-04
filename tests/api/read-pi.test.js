/* Reading an existing PI.
 *
 * The factory's own PI export is a page of text weighed down by megabytes of
 * letterhead artwork — 3.7 MB for one page — which is past what Vercel will
 * accept as a request body. The browser re-renders such a file to one JPEG per
 * page, so this endpoint has to take a PAGE ARRAY as readily as a single file.
 *
 * The property worth a test is that NOTHING IS DROPPED: a PI whose second page
 * went missing would come back looking complete and be short whole lines.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({ callModel: vi.fn() }));
vi.mock("../../api/_lib/ai.js", () => ({ callModel: aiMocks.callModel }));
vi.mock("../../api/_lib/db.js", () => ({ q: vi.fn(async () => ({ rows: [] })), db: () => ({}) }));

import readPi from "../../api/read-pi.js";
import { COOKIE, signSession } from "../../api/_lib/auth.js";

process.env.AUTH_SECRET = "test-only-secret-of-at-least-32-characters";
/* Reading a PI is CRM/Sales work on the factory's access list — the Production
   Planner schedules what already exists and raises no paperwork. */
const AUTH = { cookie: `${COOKIE}=${signSession({ username: "tester", role: "sales" })}` };

const response = () => ({
  statusCode: 200, body: null,
  status(c){ this.statusCode = c; return this; },
  json(b){ this.body = b; return this; },
});
const req = body => ({ method: "POST", url: "/api/read-pi", headers: AUTH, body });
const page = n => "P".repeat(n);

beforeEach(() => {
  vi.resetAllMocks();
  aiMocks.callModel.mockResolvedValue('{"items":[]}');
});

const blocksSent = () => aiMocks.callModel.mock.calls[0][0].messages[0].content;

describe("api/read-pi", () => {
  it("sends a single PDF as one document block", async () => {
    const res = response();
    await readPi(req({ file_base64: page(500), media_type: "application/pdf" }), res);
    expect(res.statusCode).toBe(200);
    const blocks = blocksSent();
    expect(blocks.filter(b => b.type === "document")).toHaveLength(1);
    expect(blocks.at(-1).type).toBe("text");
  });

  it("sends EVERY rendered page, one image block each", async () => {
    const res = response();
    await readPi(req({ file_base64: [page(500), page(500), page(500)], media_type: "image/jpeg" }), res);
    expect(res.statusCode).toBe(200);
    const images = blocksSent().filter(b => b.type === "image");
    expect(images).toHaveLength(3);   // not just the first
    expect(images.every(b => b.source.media_type === "image/jpeg")).toBe(true);
  });

  it("counts the whole page array against the body limit, not each page", async () => {
    const res = response();
    // Three pages, each under the cap alone, over it together.
    await readPi(req({ file_base64: [page(2_000_000), page(2_000_000), page(1_000_000)],
                       media_type: "image/jpeg" }), res);
    expect(res.statusCode).toBe(413);
    expect(aiMocks.callModel).not.toHaveBeenCalled();
  });

  it("refuses a page array that is not all readable files", async () => {
    const res = response();
    await readPi(req({ file_base64: [page(500), ""], media_type: "image/jpeg" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("refuses several PDFs, which cannot be read as one document", async () => {
    const res = response();
    await readPi(req({ file_base64: [page(500), page(500)], media_type: "application/pdf" }), res);
    expect(res.statusCode).toBe(400);
  });
});
