export type TerminalFontFamily = "jetbrains" | "system";
export type TerminalFontWeight = 400 | 500 | 600;

export interface AppearancePreferences {
  readonly terminalFontFamily: TerminalFontFamily;
  readonly terminalFontWeight: TerminalFontWeight;
  readonly glassChrome: boolean;
  readonly animatedWaves: boolean;
}

export const defaultAppearance: AppearancePreferences = {
  terminalFontFamily: "jetbrains",
  terminalFontWeight: 500,
  glassChrome: true,
  animatedWaves: true,
};

const storageKey = "limux.appearance.v1";

function isFontFamily(value: unknown): value is TerminalFontFamily {
  return value === "jetbrains" || value === "system";
}

function isFontWeight(value: unknown): value is TerminalFontWeight {
  return value === 400 || value === 500 || value === 600;
}

export function loadAppearance(storage: Pick<Storage, "getItem"> = window.localStorage): AppearancePreferences {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "null") as Partial<AppearancePreferences> | null;
    if (!parsed) return defaultAppearance;
    return {
      terminalFontFamily: isFontFamily(parsed.terminalFontFamily)
        ? parsed.terminalFontFamily
        : defaultAppearance.terminalFontFamily,
      terminalFontWeight: isFontWeight(parsed.terminalFontWeight)
        ? parsed.terminalFontWeight
        : defaultAppearance.terminalFontWeight,
      glassChrome: typeof parsed.glassChrome === "boolean" ? parsed.glassChrome : defaultAppearance.glassChrome,
      animatedWaves: typeof parsed.animatedWaves === "boolean" ? parsed.animatedWaves : defaultAppearance.animatedWaves,
    };
  } catch {
    return defaultAppearance;
  }
}

export function saveAppearance(
  preferences: AppearancePreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(storageKey, JSON.stringify(preferences));
}
