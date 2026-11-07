import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { ui } from "../../lib/ui.svelte";
import SideNav from "./SideNav.svelte";
import TabBar from "./TabBar.svelte";

function lessons(on: boolean) {
  ui.me = {
    user_id: "u",
    display_name: "U",
    email: "",
    authenticated: false,
    role: "user",
    settings: { default_instrument: "bass-4", lessons_enabled: on },
  } as typeof ui.me;
}

describe("app shell navigation", () => {
  it("hides Lessons by default, in the sidebar and the tab bar", () => {
    lessons(false);
    const side = render(SideNav);
    expect(screen.queryByTestId("nav-lessons")).not.toBeInTheDocument();
    side.unmount();
    render(TabBar);
    const order = Array.from(screen.getByRole("navigation", { name: "Main" }).children).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["tab-practice", "tab-library", "tab-add", "tab-setlists", "tab-tools"]);
  });

  it("lists the same destinations in the sidebar, in order, with one New button", () => {
    lessons(true);
    render(SideNav);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("data-testid"));
    expect(links).toEqual([
      "nav-practice",
      "nav-library",
      "nav-lessons",
      "nav-setlists",
      "nav-tools",
    ]);
    expect(screen.getAllByTestId("add-song")).toHaveLength(1);
    expect(screen.getByTestId("open-settings")).toBeInTheDocument();
    // The kind filters live in the library toolbar, not here.
    expect(screen.queryByText("Bass")).not.toBeInTheDocument();
  });

  it("gives the tab bar Practice, Library, +, Lessons, Tools", () => {
    lessons(true);
    render(TabBar);
    const bar = screen.getByRole("navigation", { name: "Main" });
    const order = Array.from(bar.children).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["tab-practice", "tab-library", "tab-add", "tab-lessons", "tab-tools"]);
  });
});
