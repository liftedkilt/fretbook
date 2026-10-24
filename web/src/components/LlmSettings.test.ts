import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LlmSettings from "./LlmSettings.svelte";

const mockStatus = vi.fn();
const mockSave = vi.fn();
const mockRemove = vi.fn();

vi.mock("../lib/api", () => ({
  getLlmStatus: (...args: unknown[]) => mockStatus(...args),
  saveOwnLlmKey: (...args: unknown[]) => mockSave(...args),
  removeOwnLlmKey: (...args: unknown[]) => mockRemove(...args),
}));

const base = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  needs_key: true,
  mode: "own_key",
  has_own_key: false,
  available: false,
  source: null,
  unavailable_reason: "llm.keyRequired",
  daily_limit: 20,
  monthly_limit: 200,
  monthly_spend_cap_usd: null,
  generations_today: 0,
  generations_month: 0,
  cost_month_usd: 0,
};

describe("LlmSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue(base);
  });

  it("asks for a key and saves it without ever showing it back", async () => {
    mockSave.mockResolvedValue({ ...base, has_own_key: true, available: true, source: "own" });
    render(LlmSettings);
    const field = await screen.findByTestId("llm-key");
    expect(screen.getByTestId("llm-key-save")).toBeDisabled();
    await fireEvent.input(field, { target: { value: "sk-secret-value" } });
    await fireEvent.click(screen.getByTestId("llm-key-save"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith("sk-secret-value"));
    await waitFor(() => expect(screen.getByTestId("llm-key")).toHaveValue(""));
    expect(screen.getByTestId("llm-key-remove")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-secret-value");
  });

  it("removes a saved key after confirming", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    mockStatus.mockResolvedValue({ ...base, has_own_key: true, available: true, source: "own" });
    mockRemove.mockResolvedValue(base);
    render(LlmSettings);
    await fireEvent.click(await screen.findByTestId("llm-key-remove"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("llm-key-remove")).toBeNull());
  });

  it("shows quota use for the shared key and hides the key form when disabled", async () => {
    mockStatus.mockResolvedValue({
      ...base,
      mode: "shared",
      available: true,
      source: "shared",
      generations_today: 3,
    });
    render(LlmSettings);
    expect(await screen.findByTestId("llm-usage")).toHaveTextContent("3 / 20");
  });

  it("explains when the feature is off or disabled for the user", async () => {
    mockStatus.mockResolvedValueOnce({ ...base, provider: "none" });
    const { unmount } = render(LlmSettings);
    expect(await screen.findByTestId("llm-state")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-key")).toBeNull();
    unmount();
    mockStatus.mockResolvedValueOnce({ ...base, mode: "disabled" });
    render(LlmSettings);
    await screen.findByTestId("llm-state");
    expect(screen.queryByTestId("llm-key")).toBeNull();
  });
});
