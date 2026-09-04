// Display names and availability for the language switcher. Every enabled
// locale also exists in `i18n/routing.ts` and has a complete messages file.
export type LocaleOption = {
  code: string;
  englishName: string;
  nativeName: string;
  enabled: boolean;
};

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: "en", englishName: "English", nativeName: "English", enabled: true },
  { code: "et", englishName: "Estonian", nativeName: "Eesti", enabled: true },
  { code: "de", englishName: "German", nativeName: "Deutsch", enabled: true },
  { code: "fr", englishName: "French", nativeName: "Français", enabled: true },
  { code: "es", englishName: "Spanish", nativeName: "Español", enabled: true },
  { code: "it", englishName: "Italian", nativeName: "Italiano", enabled: true },
  { code: "pt", englishName: "Portuguese", nativeName: "Português", enabled: true },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands", enabled: true },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska", enabled: true },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi", enabled: true },
  { code: "lv", englishName: "Latvian", nativeName: "Latviešu", enabled: true },
  { code: "lt", englishName: "Lithuanian", nativeName: "Lietuvių", enabled: true },
  { code: "pl", englishName: "Polish", nativeName: "Polski", enabled: true },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe", enabled: true },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", enabled: true },
  { code: "zh", englishName: "Chinese", nativeName: "中文", enabled: true },
];
