import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PiDocument, { DEFAULT_PI_CONFIG } from "../../src/PiDocument.jsx";

/* A minimal order: the letterhead is part of the FORM, so it prints whatever
   the lines say. */
const order = {
  order_no:"JO9001", party:"Bansal Banmala", article_code:"SPIKE",
  order_date:"2026-09-17", lines:[], sole_colour:"", upper_colour:"",
};

describe("the PI carries the factory's letterhead", () => {
  /* IT PRINTS WITHOUT BEING CONFIGURED. The invoice used to start straight at
     the PROFORMA INVOICE bar: `company_name` was declared in the config and
     rendered nowhere, so the artwork the factory uploaded had no place on the
     document to land and every PI went out on blank paper. */
  it("prints the REX mark with no configuration at all", () => {
    render(<PiDocument order={order} article={{}} mrp={{}} piNo="PI/590" />);
    const mark = screen.getByAltText("REX");
    expect(mark).toBeInTheDocument();
    expect(mark.getAttribute("src")).toBe("/brand/rex-pi-letterhead.jpg");
    /* NOT hidden from the printer. The app header hides its own mark because a
       document carries its letterhead; this is that letterhead. */
    expect(mark.closest("[data-noprint]")).toBeNull();
  });

  /* The artwork is replaceable without a code change — the same contract the
     packing list already offers. */
  it("uses a letterhead supplied through settings instead", () => {
    render(<PiDocument order={order} article={{}} mrp={{}} piNo="PI/590"
      config={{ letterhead:"data:image/png;base64,AAA", company_name:"REX" }} />);
    expect(screen.getByAltText("REX").getAttribute("src")).toBe("data:image/png;base64,AAA");
  });

  /* Cleared deliberately, the wordmark still identifies the document rather
     than leaving the top of an invoice blank. */
  it("falls back to the wordmark when there is no artwork", () => {
    render(<PiDocument order={order} article={{}} mrp={{}} piNo="PI/590"
      config={{ letterhead:null }} />);
    expect(screen.queryByAltText("REX")).toBeNull();
    expect(screen.getByText("REX")).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_PI_CONFIG.tagline)).toBeInTheDocument();
  });
});
