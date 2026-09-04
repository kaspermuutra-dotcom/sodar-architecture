"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SodarMark } from "@/components/logo";

const NAV_ITEMS: [string, string][] = [
  ["product", "/product"],
  ["integrations", "/integrations"],
  ["partners", "/partners"],
  ["pricing", "/pricing"],
];

/** Sticky header: transparent over the hero, fades to near-black glass on scroll. */
export function SiteHeader() {
  const t = useTranslations("Nav");
  const headerRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useGSAP(
    () => {
      const el = headerRef.current!;
      gsap.set(el, { backgroundColor: "rgba(5,5,5,0)", backdropFilter: "blur(0px)", borderColor: "rgba(255,255,255,0)" });
      ScrollTrigger.create({
        start: 0,
        end: 160,
        scrub: true,
        onUpdate: (self) => {
          gsap.set(el, {
            backgroundColor: `rgba(5,5,5,${(self.progress * 0.82).toFixed(3)})`,
            backdropFilter: `blur(${self.progress * 18}px)`,
            borderColor: `rgba(255,255,255,${(self.progress * 0.1).toFixed(3)})`,
          });
        },
      });
    },
    { scope: headerRef },
  );

  return (
    <header ref={headerRef} className="sticky top-0 z-50 border-b" style={{ borderColor: "transparent" }}>
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="Sodar home" className="flex items-center gap-3">
          <SodarMark size={22} className="text-text" />
          <span className="sr-only">Sodar</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-9 text-sm text-text-muted md:flex">
          {NAV_ITEMS.map(([key, href]) => (
            <Link key={key} href={href} className="transition-colors hover:text-text">
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <LanguageSwitcher compact />
          <Link href="/terminal" className="text-sm text-text-muted transition-colors hover:text-text">
            {t("signIn")}
          </Link>
          <Link href="/product" className="button-mini">
            {t("getStarted")} <span aria-hidden>↗</span>
          </Link>
        </div>

        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full border border-border-strong md:hidden"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="relative block h-3 w-4">
            <span className={`absolute left-0 top-0 h-px w-4 bg-text transition-transform ${menuOpen ? "translate-y-[6px] rotate-45" : ""}`} />
            <span className={`absolute bottom-0 left-0 h-px w-4 bg-text transition-transform ${menuOpen ? "-translate-y-[6px] -rotate-45" : ""}`} />
          </span>
        </button>
      </div>

      {menuOpen ? (
        <div className="border-t border-border bg-bg px-5 py-6 md:hidden">
          <nav className="flex flex-col gap-4 text-base">
            {NAV_ITEMS.map(([key, href]) => (
              <Link key={key} href={href} onClick={() => setMenuOpen(false)} className="text-text-muted hover:text-text">
                {t(key)}
              </Link>
            ))}
            <Link href="/terminal" onClick={() => setMenuOpen(false)} className="text-text-muted hover:text-text">
              {t("signIn")}
            </Link>
          </nav>
          <Link href="/product" className="button-primary mt-6 w-full justify-center">
            {t("getStarted")} <span aria-hidden>↗</span>
          </Link>
          <div className="mt-6">
            <LanguageSwitcher />
          </div>
        </div>
      ) : null}
    </header>
  );
}
