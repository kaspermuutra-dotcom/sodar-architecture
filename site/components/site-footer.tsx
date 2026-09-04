import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SodarMark } from "@/components/logo";

const SOCIALS = [
  ["LinkedIn", "https://linkedin.com"],
  ["X", "https://x.com"],
  ["Instagram", "https://instagram.com"],
];

/** Six-column footer: Product, Integrations, Partners, Company, Legal, Language. */
export function SiteFooter() {
  const t = useTranslations("Footer");
  const columns = ["product", "integrations", "partners", "company", "legal"] as const;

  return (
    <footer className="relative border-t border-border bg-bg">
      <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_repeat(5,1fr)] lg:gap-8">
          <div>
            <Link href="/" className="flex items-center gap-3">
              <SodarMark size={22} className="text-text" />
              <span className="wordmark">Sodar</span>
            </Link>
            <p className="mt-5 max-w-[26ch] text-sm text-text-muted">{t("tagline")}</p>
            <div className="mt-6 flex gap-4 text-xs text-text-muted">
              {SOCIALS.map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="hover:text-text">
                  {label}
                </a>
              ))}
            </div>
          </div>

          {columns.map((col) => {
            const column = t.raw(`columns.${col}`) as { title: string; items: [string, string][] };
            return (
              <div key={col}>
                <p className="mono-label">{column.title}</p>
                <ul className="mt-4 space-y-3 text-sm">
                  {column.items.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-text-muted transition-colors hover:text-text">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div>
            <p className="mono-label">{t("language")}</p>
            <div className="mt-4">
              <LanguageSwitcher compact />
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {t("copyright")}</span>
          <span className="font-mono">Tallinn, Estonia · sodar.io</span>
        </div>
      </div>

      <div className="pointer-events-none select-none overflow-hidden px-5 sm:px-8 lg:px-12" aria-hidden>
        <p className="display mx-auto max-w-[1440px] translate-y-[28%] text-[clamp(6rem,22vw,22rem)] leading-none text-text-faint/25">Sodar</p>
      </div>
    </footer>
  );
}
