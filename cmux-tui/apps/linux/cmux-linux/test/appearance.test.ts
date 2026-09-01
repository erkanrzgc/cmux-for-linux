import { describe, expect, it } from "vitest";
import { defaultAppearance, loadAppearance, saveAppearance } from "../src/appearance";

describe("Limux appearance preferences", () => {
  it("uses safe defaults for missing or invalid persisted values", () => {
    expect(loadAppearance({ getItem: () => null })).toEqual(defaultAppearance);
    expect(loadAppearance({ getItem: () => "not-json" })).toEqual(defaultAppearance);
  });

  it("round-trips supported terminal and glass preferences", () => {
    let stored = "";
    const preferences = {
      terminalFontFamily: "system" as const,
      terminalFontWeight: 600 as const,
      glassChrome: false,
      animatedWaves: false,
    };
    saveAppearance(preferences, { setItem: (_key, value) => { stored = value; } });

    expect(loadAppearance({ getItem: () => stored })).toEqual(preferences);
  });
});
