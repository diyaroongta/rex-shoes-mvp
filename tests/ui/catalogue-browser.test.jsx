import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CatalogueBrowser from "../../src/CatalogueBrowser.jsx";

/* Names off the live article master: two Jacks in one colour, fastened two
   ways, plus a second colour that only comes in lace. */
const ARTICLES = {
  "JACK LACE BLACK-BLUE (BLUE SKINFIT)": { sole_type:"EVA", combos:{ "7X10S":{ rates:{ CUTTING:{ "M||MTR":1 } } } } },
  "JACK VELCRO BLACK-BLUE":              { sole_type:"EVA", combos:{ "7X10S":{ rates:{ CUTTING:{ "M||MTR":1 } } } } },
  "JACK LACE N.BLUE":                    { sole_type:"EVA", combos:{ "7X10S":{ rates:{ CUTTING:{ "M||MTR":1 } } } } },
  "REX GOLA (V)":                        { sole_type:"PVC", combos:{ "8X10":{ rates:{ CUTTING:{ "R||MTR":1 } } } } },
};

it("opens on shoes, not on every article", async () => {
  render(<CatalogueBrowser articles={ARTICLES} />);
  expect(screen.getByText("Jack")).toBeInTheDocument();
  expect(screen.getByText("Rex Gola")).toBeInTheDocument();
  /* Three Jacks are ONE card at this level — that is the whole point. */
  expect(screen.getByText("3 variants · 2 colours")).toBeInTheDocument();
  expect(screen.queryByText("JACK VELCRO BLACK-BLUE")).toBeNull();
});

it("groups a shoe by colour, with lace and velcro under the colour", async () => {
  const user = userEvent.setup();
  render(<CatalogueBrowser articles={ARTICLES} />);
  await user.click(screen.getByText("Jack"));
  expect(screen.getByText("Black / Blue")).toBeInTheDocument();
  expect(screen.getByText("N.blue")).toBeInTheDocument();
  expect(screen.getAllByText("Lace").length).toBe(2);
  expect(screen.getByText("Velcro")).toBeInTheDocument();
  /* The bracketed note is shown but did not split the colour. */
  expect(screen.getByText(/Skinfit/)).toBeInTheDocument();
});

it("searches across shoe, colour and closure at once", async () => {
  const user = userEvent.setup();
  render(<CatalogueBrowser articles={ARTICLES} />);
  await user.type(screen.getByLabelText("Search the catalogue"), "jack velcro");
  expect(screen.getByText("Jack")).toBeInTheDocument();
  expect(screen.queryByText("Rex Gola")).toBeNull();
  expect(screen.getByText("1 variant · 1 colour")).toBeInTheDocument();
});

it("filters by material without pretending it is the same thing as a section", async () => {
  const user = userEvent.setup();
  render(<CatalogueBrowser articles={ARTICLES} />);
  await user.click(screen.getByRole("button",{ name:"PVC" }));
  expect(screen.getByText("Rex Gola")).toBeInTheDocument();
  expect(screen.queryByText("Jack")).toBeNull();
  /* No article has a section yet, so the row says so instead of showing tabs
     that would filter everything away. */
  expect(screen.getByText(/No article has been put in a section yet/)).toBeInTheDocument();
});

it("sets a section on one variant, and never on the family by accident", async () => {
  const user = userEvent.setup();
  const onSetSection = vi.fn();
  render(<CatalogueBrowser articles={ARTICLES} canEdit onSetSection={onSetSection} />);
  await user.click(screen.getByText("Jack"));
  const pickers = screen.getAllByLabelText("Catalogue section");
  expect(pickers.length).toBe(3);
  await user.selectOptions(pickers[0], "Toddler");
  expect(onSetSection).toHaveBeenCalledTimes(1);
  expect(onSetSection.mock.calls[0][1]).toBe("Toddler");
});
