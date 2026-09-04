import { defineRouting } from "next-intl/routing";

// TODO(phase-2): add locales as markets are confirmed. `en` is the
// default/fallback per the build brief.
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

export function isSupportedLocale(value: string | undefined): value is Locale {
  return value != null && (routing.locales as readonly string[]).includes(value);
}
