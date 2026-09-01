import { describe, expect, it, vi } from "vitest";
import { locale, messages, t } from "../src/i18n";

describe("desktop localization", () => {
  it("keeps English, Turkish, and Japanese catalogs in parity", () => {
    expect(Object.keys(messages.tr).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it.each([
    ["tr-TR", "tr", "Çalışma alanları"],
    ["ja-JP", "ja", "ワークスペース"],
    ["de-DE", "en", "Workspaces"],
  ])("selects the expected catalog for %s", (language, expectedLocale, expectedText) => {
    const languageSpy = vi.spyOn(navigator, "language", "get").mockReturnValue(language);
    expect(locale()).toBe(expectedLocale);
    expect(t("workspaces")).toBe(expectedText);
    languageSpy.mockRestore();
  });
});
