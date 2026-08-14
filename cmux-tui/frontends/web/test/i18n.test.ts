import { describe, expect, it, vi } from "vitest";
import { messages, t } from "../src/i18n";
import { SUPPORTED_PROTOCOL } from "../src/lib/protocol";

describe("web localization catalogs", () => {
  it("keeps every message catalog in parity", () => {
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.keys(messages.tr).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it.each([
    ["en-US", "Protocol 12 is required; the server reported protocol 7."],
    ["ja-JP", "プロトコル12が必要ですが、サーバーはプロトコル7を返しました。"],
    ["tr-TR", "12 protokolü gerekli; sunucu 7 bildirdi."],
  ])("renders the required protocol in %s mismatch errors", (language, expected) => {
    const languageSpy = vi.spyOn(navigator, "language", "get").mockReturnValue(language);
    expect(t("wrongProtocol", { required: SUPPORTED_PROTOCOL, protocol: 7 })).toBe(expected);
    languageSpy.mockRestore();
  });
});
