import React from "react";
import {render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";

const changePassword=vi.hoisted(()=>vi.fn());
vi.mock("../../src/lib/client.js",()=>({changePassword}));
import ChangePassword from "../../src/ChangePassword.jsx";

beforeEach(()=>{changePassword.mockReset();changePassword.mockResolvedValue({ok:true});});

it("lets a signed-in person replace the temporary password",async()=>{
  const user=userEvent.setup();render(<ChangePassword/>);
  await user.click(screen.getByRole("button",{name:"Change password"}));
  const dialog=screen.getByRole("dialog",{name:"Change password"});
  const fields=dialog.querySelectorAll('input[type="password"]');
  await user.type(fields[0],"temporary-2026");
  await user.type(fields[1],"only-mine-2026");
  await user.type(fields[2],"only-mine-2026");
  await user.click(within(dialog).getByRole("button",{name:"Change password"}));
  await waitFor(()=>expect(changePassword).toHaveBeenCalledWith("temporary-2026","only-mine-2026"));
  expect(screen.queryByRole("dialog",{name:"Change password"})).toBeNull();
  expect(screen.getByRole("button",{name:"Password changed"})).toBeInTheDocument();
});

it("does not submit when the confirmation is different",async()=>{
  const user=userEvent.setup();render(<ChangePassword/>);
  await user.click(screen.getByRole("button",{name:"Change password"}));
  const dialog=screen.getByRole("dialog");
  const fields=dialog.querySelectorAll('input[type="password"]');
  await user.type(fields[0],"temporary-2026");
  await user.type(fields[1],"only-mine-2026");
  await user.type(fields[2],"different-2026");
  await user.click(within(dialog).getByRole("button",{name:"Change password"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
  expect(changePassword).not.toHaveBeenCalled();
});
