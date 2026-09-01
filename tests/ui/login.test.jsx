import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(()=>({ signIn: vi.fn() }));
vi.mock("../../src/lib/client.js", ()=>({ signIn: mocks.signIn }));

import Login from "../../src/Login.jsx";

beforeEach(()=>vi.clearAllMocks());

describe("the sign-in screen", ()=>{
  it("signs in and hands the user back to the app", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockResolvedValue({ authenticated:true, user:{ username:"abhay", role:"admin" } });
    const onSignedIn = vi.fn();
    render(<Login onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "factory-floor-2026");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    await waitFor(()=>expect(onSignedIn).toHaveBeenCalledWith({ username:"abhay", role:"admin" }));
    expect(mocks.signIn).toHaveBeenCalledWith("abhay", "factory-floor-2026");
  });

  it("shows the server's reason for a refusal, and clears the password", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("Incorrect username or password"));
    const onSignedIn = vi.fn();
    render(<Login onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password");
    expect(onSignedIn).not.toHaveBeenCalled();
    // A failed attempt must not leave the password sitting in the field.
    expect(screen.getByLabelText("Password")).toHaveValue("");
    // The username stays, so a typo in the password is one field to retype.
    expect(screen.getByLabelText("Username")).toHaveValue("abhay");
  });

  /* A lockout and an unconfigured deployment are the two refusals a user can
     do something about, so their messages have to survive to the screen. */
  it("passes through a lockout message and strips the status-code prefix", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("429 — Too many failed attempts. Try again in 14 minutes."));
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "whatever-here");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many failed attempts. Try again in 14 minutes.");
    expect(alert.textContent).not.toMatch(/^429/);
  });

  /* A setup fault must not read as a wrong password. Someone told "incorrect
     password" will retype it, then reset the account — neither of which can
     fix an unset environment variable or an empty users table. */
  it("marks an unconfigured deployment as a setup problem, not a bad password", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("503 — AUTH_SECRET is not set (needs at least 32 characters). Set it in Vercel → Settings → Environment Variables and redeploy."));
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "factory-floor");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This portal is not set up yet");
    expect(alert).toHaveTextContent("AUTH_SECRET");
    expect(alert).toHaveTextContent(/not a problem with your password/);
  });

  it("says so when no accounts have been created yet", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("No accounts exist yet. Create the first one with: npm run user:create -- <username>"));
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "factory-floor");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This portal is not set up yet");
    expect(alert).toHaveTextContent("user:create");
  });

  it("does NOT dress up an ordinary wrong password as a setup problem", async ()=>{
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("Incorrect username or password"));
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("Username"), "abhay");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name:"Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("This portal is not set up yet");
  });

  it("cannot be submitted empty", async ()=>{
    render(<Login onSignedIn={vi.fn()} />);
    expect(screen.getByRole("button", { name:"Sign in" })).toBeDisabled();
  });

  it("uses password-manager field names, and never a visible password", ()=>{
    render(<Login onSignedIn={vi.fn()} />);
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
  });
});
