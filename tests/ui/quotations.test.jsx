import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({ listQuotations:vi.fn(), createQuotation:vi.fn(), setQuotationStatus:vi.fn() }));
vi.mock("../../src/lib/client.js",()=>mocks);
import QuotationsTab from "../../src/QuotationsTab.jsx";

beforeEach(()=>{ vi.clearAllMocks(); mocks.listQuotations.mockResolvedValue([]); });

/* A quotation must say, in as many words, that it has released nothing —
   otherwise a sales clerk has no way to tell it from raising a PI. */
it("saves a quotation and says nothing was released into production",async()=>{
  mocks.createQuotation.mockImplementation(async body=>({
    quote_no:"QT/1", quote_date:body.quote_date, party:body.party, city:body.city,
    status:"draft", pairs:120, total:75173, snapshot:body }));

  const user=userEvent.setup();
  render(<QuotationsTab />);

  await user.type(await screen.findByLabelText("Customer"), "K.P. Burgav");
  await user.click(screen.getByRole("button",{name:/Add an article/i}));
  /* An article the seed actually prices — an unpriced one is correctly refused,
     because it would be QUOTED at zero. */
  await user.selectOptions(await screen.findByLabelText("Article 1"), "REX GOLA PLUS");
  const boxes=await screen.findAllByRole("spinbutton");
  await user.type(boxes[boxes.length-1], "30");

  await user.click(await screen.findByRole("button",{name:/Save quotation/i}));
  await screen.findByText(/QT\/1 saved/i);
  expect(screen.getByText(/Nothing has been released into production/i)).toBeInTheDocument();
});

it("shows a quotation past its validity, and only the moves its status allows",async()=>{
  mocks.listQuotations.mockResolvedValue([
    { quote_no:"QT/7", quote_date:"2026-01-01", party:"Beta", status:"sent", valid_days:15,
      pairs:100, total:50000, snapshot:{items:[]} },
    { quote_no:"QT/8", quote_date:"2026-01-01", party:"Gamma", status:"converted",
      converted_pi_no:"PI-2026-000004", pairs:50, total:20000, snapshot:{items:[]} },
  ]);
  render(<QuotationsTab />);

  expect(await screen.findByText("QT/7")).toBeInTheDocument();
  /* "Past validity" is also a heading on the summary band, so the check is
     scoped to the quotation's own row. */
  const row=screen.getByText("QT/7").closest("tr");
  expect(within(row).getByText(/past validity/i)).toBeInTheDocument();
  /* A sent quotation can be accepted or lost — never sent twice. */
  expect(screen.getByRole("button",{name:"Accepted"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Sent to customer"})).toBeNull();
  /* A converted one is finished, and names the invoice it became. */
  expect(screen.getByText(/PI-2026-000004/)).toBeInTheDocument();
  expect(screen.getAllByRole("button",{name:"Not taken"}).length).toBe(1);
});
