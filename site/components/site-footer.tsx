import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SodarMark } from "@/components/logo";
import { LINKEDIN_URL, PHONE, TEAM_EMAIL } from "@/lib/company";

/** Six-column footer: Product, Integrations, Partners, Company, Legal, Language. */
export function SiteFooter() {
  const t = useTranslations("Footer");
  const columns = ["product", "integrations", "partners", "company", "legal"] as const;

  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_repeat(5,1fr)] lg:gap-8">
          <div>
            <Link href="/" className="flex items-center gap-3">
              <SodarMark size={22} className="text-text" />
              <span className="wordmark">Sodar</span>
            </Link>
            <p className="mt-5 max-w-[26ch] text-sm text-text-muted">{t("tagline")}</p>
            <ul className="mt-6 space-y-2 text-sm" dir="ltr">
              <li>
                <a href={`mailto:${TEAM_EMAIL}`} className="text-text-muted hover:text-text">{TEAM_EMAIL}</a>
              </li>
              <li>
                <a href={`tel:${PHONE.replace(/\s/g, "")}`} className="text-text-muted hover:text-text">{PHONE}</a>
              </li>
              <li>
                <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-text">
                  LinkedIn
                </a>
              </li>
            </ul>
          </div>

          {columns.map((col) => {
            const column = t.raw(`columns.${col}`) as { title: string; items: [string, string][] };
            return (
              <div key={col}>
                <p className="mono-label">{column.title}</p>
                <ul className="mt-4 space-y-3 text-sm">
                  {column.items.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-text-muted hover:text-text">
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
          <span>{t("location")}</span>
        </div>
      </div>
    </footer>
  );
}
