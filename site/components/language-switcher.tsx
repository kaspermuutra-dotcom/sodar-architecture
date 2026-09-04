"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LOCALE_OPTIONS } from "@/lib/locales";

/**
 * Real, searchable language switcher (§4/§5.13 — not a footer <select>).
 * `compact` renders as a nav trigger + popover; the non-compact form is the
 * standalone "language moment" section on the homepage.
 *
 * Only `en` is wired into `i18n/routing.ts`, so it's the only option that
 * actually navigates — every other locale is real UI (searchable, focusable,
 * shows its native name) that reports itself as not-yet-translated instead of
 * routing into a 404. TODO(phase-2): as each locale ships messages, move it
 * from a disabled row here into `routing.ts`.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const activeLocale = useLocale();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LOCALE_OPTIONS;
    return LOCALE_OPTIONS.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [query]);

  const list = (
    <div className="max-h-72 overflow-y-auto">
      {results.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">No matching language.</p>
      ) : (
        <ul role="listbox" aria-label="Choose a language" className="py-2">
          {results.map((l) => {
            const isActive = l.code === activeLocale;
            const row = (
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>
                  <span className="text-text">{l.nativeName}</span>
                  {l.nativeName !== l.englishName ? (
                    <span className="ml-2 text-text-muted">{l.englishName}</span>
                  ) : null}
                </span>
                {isActive ? (
                  <span className="font-mono text-[10px] uppercase tracking-[.14em] text-accent">Active</span>
                ) : l.enabled ? (
                  <span className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{l.code}</span>
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted/70">Coming soon</span>
                )}
              </span>
            );
            if (l.enabled) {
              return (
                <li key={l.code} role="option" aria-selected={isActive}>
                  <Link
                    href={pathname}
                    locale={l.code}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[.06] ${isActive ? "bg-white/[.04]" : ""}`}
                  >
                    {row}
                  </Link>
                </li>
              );
            }
            return (
              <li key={l.code} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => setPendingCode(l.code)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-text-muted transition-colors hover:bg-white/[.06]"
                >
                  {row}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pendingCode ? (
        <p className="border-t border-border px-4 py-3 font-mono text-[11px] text-text-muted">
          {LOCALE_OPTIONS.find((l) => l.code === pendingCode)?.englishName} isn&apos;t translated yet — listings will keep
          rendering in English until it ships.
        </p>
      ) : null}
    </div>
  );

  const searchField = (
    <div className="border-b border-border px-3 py-2.5">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="text"
        placeholder="Search languages…"
        aria-label="Search languages"
        className="w-full bg-transparent font-mono text-sm text-text placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="button-mini"
        >
          <span aria-hidden>◎</span>
          <span>{activeLocale.toUpperCase()}</span>
        </button>
        {open ? (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-[calc(100%+.6rem)] z-50 w-72 overflow-hidden rounded-2xl border border-border bg-bg-raised shadow-2xl shadow-black/50">
              {searchField}
              {list}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-bg-raised">
      {searchField}
      {list}
    </div>
  );
}
