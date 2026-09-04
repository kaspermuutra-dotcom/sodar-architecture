// Display list for the language switcher UI (§4/§5.13 of the build brief).
// This is deliberately separate from `i18n/routing.ts`'s `locales` array:
// the switcher shows the full target-market list now so the UI/interaction
// is real, while `routing.ts` only enables locales that have translated
// `messages/<locale>.json`. Selecting a `enabled: false` locale below stays
// on the page and marks itself "coming soon" instead of 404ing.
// TODO(phase-2): flip `enabled: true` as each locale's messages file ships,
// and add it to `routing.ts` at the same time.
export type LocaleOption = {
  code: string;
  englishName: string;
  nativeName: string;
  enabled: boolean;
};

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: "en", englishName: "English", nativeName: "English", enabled: true },
  { code: "et", englishName: "Estonian", nativeName: "Eesti", enabled: false },
  { code: "de", englishName: "German", nativeName: "Deutsch", enabled: false },
  { code: "fr", englishName: "French", nativeName: "Français", enabled: false },
  { code: "es", englishName: "Spanish", nativeName: "Español", enabled: false },
  { code: "it", englishName: "Italian", nativeName: "Italiano", enabled: false },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", enabled: false },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands", enabled: false },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska", enabled: false },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi", enabled: false },
  { code: "lv", englishName: "Latvian", nativeName: "Latviešu", enabled: false },
  { code: "lt", englishName: "Lithuanian", nativeName: "Lietuvių", enabled: false },
  { code: "pl", englishName: "Polish", nativeName: "Polski", enabled: false },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe", enabled: false },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", enabled: false },
  { code: "zh", englishName: "Chinese", nativeName: "中文", enabled: false },
  { code: "ja", englishName: "Japanese", nativeName: "日本語", enabled: false },
  { code: "ko", englishName: "Korean", nativeName: "한국어", enabled: false },
];
