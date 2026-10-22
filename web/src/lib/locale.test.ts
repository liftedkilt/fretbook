import { describe, expect, it } from "vitest";

import { pickLocale, pluralCategory } from "./locale";

const available = ["en", "pt-BR"];

describe("pickLocale", () => {
  it("uses an exact tag, then the language, and ignores unknown languages", () => {
    expect(pickLocale("pt-BR", available)).toBe("pt-BR");
    expect(pickLocale("PT-br", available)).toBe("pt-BR");
    expect(pickLocale("pt_BR", available)).toBe("pt-BR");
    expect(pickLocale("pt-PT", available)).toBe("pt-BR");
    expect(pickLocale("pt", available)).toBe("pt-BR");
    expect(pickLocale("en-GB", available)).toBe("en");
    expect(pickLocale("en", available)).toBe("en");
    expect(pickLocale("fr-FR", available)).toBeNull();
    expect(pickLocale("  ", available)).toBeNull();
  });
});

describe("pluralCategory", () => {
  it("uses the plural for zero in Brazilian Portuguese", () => {
    expect(pluralCategory("pt-BR", 0)).toBe("other");
    expect(pluralCategory("pt-BR", 1)).toBe("one");
    expect(pluralCategory("pt-BR", 2)).toBe("other");
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 1)).toBe("one");
  });
});
