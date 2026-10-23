import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import ApiTokens from "./ApiTokens.svelte";

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockRevoke = vi.fn();

vi.mock("../lib/api", () => ({
  listApiTokens: (...args: unknown[]) => mockList(...args),
  createApiToken: (...args: unknown[]) => mockCreate(...args),
  revokeApiToken: (...args: unknown[]) => mockRevoke(...args),
}));

const row = {
  id: "t1",
  name: "nightly",
  prefix: "fb_abcde",
  created_at: "2026-01-02T00:00:00+00:00",
  expires_at: null,
  last_used_at: null,
};

describe("ApiTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.me = { user_id: "local", authenticated: false, role: "user" } as Me;
    mockList.mockResolvedValue([row]);
  });

  it("stays out of the way until opened, then lists tokens without secrets", async () => {
    render(ApiTokens);
    expect(mockList).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId("tokens-toggle"));
    expect(await screen.findByText("nightly")).toBeInTheDocument();
    expect(screen.getByText("fb_abcde…")).toBeInTheDocument();
  });

  it("shows a new token once and refreshes the list", async () => {
    mockCreate.mockResolvedValueOnce({ ...row, id: "t2", name: "cron", token: "fb_secretvalue" });
    render(ApiTokens);
    await fireEvent.click(screen.getByTestId("tokens-toggle"));
    await screen.findByText("nightly");

    await fireEvent.input(screen.getByTestId("token-name"), { target: { value: " cron " } });
    await fireEvent.change(screen.getByTestId("token-expiry"), { target: { value: "30" } });
    await fireEvent.click(screen.getByTestId("token-create"));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("cron", 30));
    const field = (await screen.findByTestId("new-token")).querySelector("input");
    expect(field).toHaveValue("fb_secretvalue");
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("revokes after confirming", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true));
    mockRevoke.mockResolvedValue(undefined);
    render(ApiTokens);
    await fireEvent.click(screen.getByTestId("tokens-toggle"));
    const revoke = await screen.findByRole("button", { name: /revoke/i });

    await fireEvent.click(revoke);
    expect(mockRevoke).not.toHaveBeenCalled();
    await fireEvent.click(revoke);
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("nightly")).not.toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it("reports a server error", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"));
    render(ApiTokens);
    await fireEvent.click(screen.getByTestId("tokens-toggle"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
