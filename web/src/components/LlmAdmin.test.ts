import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LlmAdmin from "./LlmAdmin.svelte";

const api = {
  getLlmSettings: vi.fn(),
  saveLlmSettings: vi.fn(),
  listLlmUsers: vi.fn(),
  saveLlmUser: vi.fn(),
  listLlmUsage: vi.fn(),
  listLlmNotices: vi.fn(),
  clearLlmNotices: vi.fn(),
};

vi.mock("../lib/api", () => ({
  getLlmSettings: (...a: unknown[]) => api.getLlmSettings(...a),
  saveLlmSettings: (...a: unknown[]) => api.saveLlmSettings(...a),
  listLlmUsers: (...a: unknown[]) => api.listLlmUsers(...a),
  saveLlmUser: (...a: unknown[]) => api.saveLlmUser(...a),
  listLlmUsage: (...a: unknown[]) => api.listLlmUsage(...a),
  listLlmNotices: (...a: unknown[]) => api.listLlmNotices(...a),
  clearLlmNotices: (...a: unknown[]) => api.clearLlmNotices(...a),
}));

const settings = {
  provider: "anthropic",
  base_url: "",
  model: "claude-sonnet-5-5",
  instance_monthly_cap_usd: null,
  rate_limit_per_minute: 5,
  has_admin_key: true,
  admin_spend_month_usd: 1.5,
  admin_generations_month: 4,
};
const user = {
  user_id: "u1",
  display_name: "Alice",
  email: "a@example.test",
  mode: "own_key",
  has_own_key: false,
  daily_limit: 20,
  monthly_limit: 200,
  monthly_spend_cap_usd: null,
  generations_today: 1,
  generations_month: 2,
  cost_month_usd: 0.02,
  input_tokens: 1,
  output_tokens: 1,
  cost_total_usd: 0.02,
};

describe("LlmAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLlmSettings.mockResolvedValue(settings);
    api.listLlmUsers.mockResolvedValue([user]);
    api.listLlmUsage.mockResolvedValue([]);
    api.listLlmNotices.mockResolvedValue([]);
  });

  async function open() {
    render(LlmAdmin);
    await fireEvent.click(screen.getByTestId("llm-admin-toggle"));
    await screen.findByTestId("llm-provider");
  }

  it("never shows the saved key and only sends a new one when typed", async () => {
    api.saveLlmSettings.mockResolvedValue(settings);
    await open();
    expect(screen.getByTestId("llm-admin-key")).toHaveValue("");
    await fireEvent.click(screen.getByTestId("llm-save"));
    await waitFor(() => expect(api.saveLlmSettings).toHaveBeenCalled());
    expect(api.saveLlmSettings.mock.calls[0][0]).toMatchObject({
      provider: "anthropic",
      admin_key: null,
      clear_admin_key: false,
    });

    await fireEvent.input(screen.getByTestId("llm-admin-key"), {
      target: { value: " sk-new-key " },
    });
    await fireEvent.input(screen.getByTestId("llm-cap"), { target: { value: "25" } });
    await fireEvent.click(screen.getByTestId("llm-save"));
    await waitFor(() => expect(api.saveLlmSettings).toHaveBeenCalledTimes(2));
    expect(api.saveLlmSettings.mock.calls[1][0]).toMatchObject({
      admin_key: "sk-new-key",
      instance_monthly_cap_usd: 25,
    });
  });

  it("saves a user's mode and limits, with blank meaning no limit", async () => {
    api.saveLlmUser.mockResolvedValue({ ...user, mode: "shared", daily_limit: null });
    await open();
    await fireEvent.change(screen.getByTestId("llm-user-mode"), { target: { value: "shared" } });
    await fireEvent.input(screen.getByTestId("llm-user-daily"), { target: { value: "" } });
    await fireEvent.click(screen.getByTestId("llm-user-save"));
    await waitFor(() =>
      expect(api.saveLlmUser).toHaveBeenCalledWith("u1", {
        mode: "shared",
        daily_limit: null,
        monthly_limit: 200,
        monthly_spend_cap_usd: null,
      }),
    );
  });

  it("lists 80% notices and clears them", async () => {
    api.listLlmNotices.mockResolvedValue([
      {
        user_id: "u1",
        user_name: "Alice",
        limit_kind: "daily",
        period: "2026-10-24",
        created_at: "x",
      },
    ]);
    api.clearLlmNotices.mockResolvedValue(undefined);
    await open();
    expect(screen.getByTestId("llm-notices")).toHaveTextContent("Alice");
    await fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByTestId("llm-notices")).toBeNull());
  });

  it("hides the key and user sections when the provider is off", async () => {
    await open();
    await fireEvent.change(screen.getByTestId("llm-provider"), { target: { value: "none" } });
    expect(screen.queryByTestId("llm-admin-key")).toBeNull();
    expect(screen.queryByTestId("llm-users")).toBeNull();
  });
});
