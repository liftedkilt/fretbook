import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Recommendations from "./Recommendations.svelte";

const mockGet = vi.fn();

vi.mock("../lib/api", () => ({
  getRecommendations: (...args: unknown[]) => mockGet(...args),
}));

const song = (id: string, title: string, difficulty: number | null = 5) => ({
  song_id: id,
  title,
  artist: "Artist",
  content_kind: "tab" as const,
  difficulty,
});

describe("Recommendations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists songs to stretch to, loops to revisit and songs due for review", async () => {
    mockGet.mockResolvedValue({
      level: 4.4,
      level_basis: "scored",
      stretch: [song("a", "Step Up", 5.6)],
      revisit: [
        {
          ...song("b", "Weak Spot"),
          loop_name: "",
          loop_start: 2,
          loop_end: 5,
          score: 54.4,
          last_day: "2020-01-01",
          attempts: 2,
        },
      ],
      review: [{ ...song("c", "Old Friend"), last_day: "2020-01-01", interval_days: 4 }],
    });
    render(Recommendations);
    expect(await screen.findByTestId("recs-stretch")).toHaveTextContent("Step Up");
    expect(screen.getByTestId("recs-stretch")).toHaveTextContent("Level 6");
    expect(screen.getByTestId("recs-level")).toHaveTextContent("level 4 songs well");
    expect(screen.getByTestId("recs-revisit")).toHaveTextContent("Weak Spot");
    expect(screen.getByTestId("recs-revisit")).toHaveTextContent("bars 3–6");
    expect(screen.getByTestId("recs-revisit")).toHaveTextContent("54%");
    expect(screen.getByTestId("recs-review")).toHaveTextContent("Old Friend");
    expect(mockGet).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("names a loop by its name and skips empty lists", async () => {
    mockGet.mockResolvedValue({
      level: null,
      level_basis: "none",
      stretch: [],
      revisit: [
        {
          ...song("b", "Weak Spot"),
          loop_name: "Solo",
          loop_start: 0,
          loop_end: 1,
          score: 10,
          last_day: "2020-01-01",
          attempts: 1,
        },
      ],
      review: [],
    });
    render(Recommendations);
    expect(await screen.findByTestId("recs-revisit")).toHaveTextContent("Solo");
    expect(screen.queryByTestId("recs-stretch")).toBeNull();
    expect(screen.queryByTestId("recs-review")).toBeNull();
    expect(screen.queryByTestId("recs-level")).toBeNull();
  });

  it("shows nothing when there is nothing to suggest or the request fails", async () => {
    mockGet.mockResolvedValueOnce({
      level: null,
      level_basis: "none",
      stretch: [],
      revisit: [],
      review: [],
    });
    const first = render(Recommendations);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId("practice-recommendations")).toBeNull();
    first.unmount();

    mockGet.mockRejectedValueOnce(new Error("down"));
    render(Recommendations);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("practice-recommendations")).toBeNull();
  });
});
