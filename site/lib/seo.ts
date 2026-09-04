import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

const BASE = "https://sodar.io";

/** Path for a locale under the `as-needed` prefix rule (default locale has no prefix). */
export function localizedPath(locale: string, path: string): string {
  const clean = path === "/" ? "" : path;
  return locale === routing.defaultLocale ? clean || "/" : `/${locale}${clean}`;
}

/** Canonical + hreflang alternates for one route, for every enabled locale. */
export function localeAlternates(locale: string, path: string): NonNullable<Metadata["alternates"]> {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = `${BASE}${localizedPath(l, path)}`;
  languages["x-default"] = `${BASE}${localizedPath(routing.defaultLocale, path)}`;
  return { canonical: `${BASE}${localizedPath(locale, path)}`, languages };
}
