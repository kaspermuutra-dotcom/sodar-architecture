import { defineRouting } from "next-intl/routing";

// Every locale here has a complete messages/<locale>.json (ja/ko pending). `en` is the default
// and is served without a prefix; all others live under /<locale>/…
export const routing = defineRouting({
  locales: ["en", "et", "de", "fr", "es", "it", "pt", "nl", "sv", "fi", "lv", "lt", "pl", "tr", "ar", "zh"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

export const RTL_LOCALES: readonly string[] = ["ar"];

export function isSupportedLocale(value: string | undefined): value is Locale {
  return value != null && (routing.locales as readonly string[]).includes(value);
}
