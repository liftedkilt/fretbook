import { afterEach, describe, expect, it, vi } from "vitest";

import { currentLocale, setLocale, t } from "./i18n.svelte";

describe("setLocale", () => {
  const store = new Map<string, string>();
  const root = { lang: "" };

  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("stores the choice and translates, including Brazilian Portuguese plurals", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    vi.stubGlobal("document", { documentElement: root, title: "" });

    setLocale("pt-BR");
    expect(currentLocale()).toBe("pt-BR");
    expect(store.get("fretbook.locale")).toBe("pt-BR");
    expect(root.lang).toBe("pt-BR");
    expect(document.title).toBe("Fretbook");
    expect(t("app.back")).toBe("Biblioteca");
    expect(t("library.measures", { count: 0 })).toBe("0 compassos");
    expect(t("library.measures", { count: 1 })).toBe("1 compasso");
    expect(t("library.measures", { count: 2 })).toBe("2 compassos");
    expect(t("instrument.bass")).toBe("Baixo");
    expect(t("instrument.electric")).toBe("Guitarra elétrica");
    expect(t("instrument.acoustic")).toBe("Violão");

    setLocale("pt");
    expect(currentLocale()).toBe("pt-BR");
    setLocale("fr");
    expect(currentLocale()).toBe("pt-BR");

    setLocale("en");
    expect(currentLocale()).toBe("en");
    expect(root.lang).toBe("en");
    expect(t("app.back")).toBe("Library");
    expect(t("library.measures", { count: 1 })).toBe("1 bar");
    expect(t("library.measures", { count: 0 })).toBe("0 bars");
  });
});
