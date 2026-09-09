import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/lib/seo";
import { getPortfolioProject, PORTFOLIO_WALKTHROUGHS } from "@/lib/portfolio";
import { PageShell } from "@/components/page-shell";
import { PropertyDemo } from "@/components/demo/property-demo";

type Params = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  return PORTFOLIO_WALKTHROUGHS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const project = getPortfolioProject(slug);
  if (!project) return {};
  const t = await getTranslations({ locale, namespace: "Portfolio" });
  const title = t(`items.${project.labelKey}.metaTitle`);
  const description = t(`items.${project.labelKey}.metaDesc`);
  const image = project.walkthrough.ogImage;
  return {
    title,
    description,
    alternates: localeAlternates(locale, `/portfolio/${project.slug}`),
    openGraph: { title, description, locale, type: "website", images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: project.walkthrough.indexable ? undefined : { index: false, follow: false },
  };
}

/** A portfolio project: the interactive walkthrough with the minimum of chrome around it. */
export default async function PortfolioProjectPage({ params }: Params) {
  const { locale, slug } = await params;
  const project = getPortfolioProject(slug);
  if (!project) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Portfolio");
  const tScene = await getTranslations("PropertyDemo"); // scene names live with the viewer strings
  const walk = project.walkthrough;

  return (
    <PageShell>
      <article className="mx-auto max-w-[1440px] px-5 pb-20 pt-8 sm:px-8 sm:pt-10 lg:px-12">
        <nav aria-label={t("breadcrumbLabel")} className="text-xs text-text-muted">
          <Link href="/portfolio" className="hover:text-text">
            ← {t("backToPortfolio")}
          </Link>
        </nav>
        <header className="mb-5 mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 sm:mb-6">
          <div>
            <p className="eyebrow">{t(`items.${project.labelKey}.eyebrow`)}</p>
            <h1 className="display mt-3 text-[clamp(2.2rem,4.6vw,4rem)]">{walk.title}</h1>
            <p className="mt-2 text-base text-text">{project.client}</p>
          </div>
          <p className="max-w-md text-sm text-text-muted">{t(`items.${project.labelKey}.lead`)}</p>
        </header>

        <PropertyDemo walk={walk} />

        <section className="mt-12 grid gap-8 border-t border-border pt-8 sm:grid-cols-3" aria-labelledby="project-facts">
          <h2 id="project-facts" className="sr-only">
            {t("factsLabel")}
          </h2>
          <div>
            <p className="section-kicker">{t("facts.type")}</p>
            <p className="mt-2 text-sm text-text">{t(`items.${project.labelKey}.type`)}</p>
          </div>
          <div>
            <p className="section-kicker">{t("facts.scope")}</p>
            <p className="mt-2 text-sm text-text">{t("facts.scopeValue", { count: walk.scenes.length })}</p>
          </div>
          <div>
            <p className="section-kicker">{t("facts.client")}</p>
            <p className="mt-2 text-sm text-text">{project.client}</p>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="project-gallery">
          <h2 id="project-gallery" className="section-kicker">
            {t("galleryTitle")}
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {walk.gallery.map((g) => (
              <li key={g.nodeId} className="tile aspect-[16/10]">
                <a href={`#${g.nodeId}`} aria-label={tScene(`scenes.${g.labelKey}`)} className="block h-full w-full">
                  <img src={g.still} alt={t("stillAlt", { label: tScene(`scenes.${g.labelKey}`) })} width={1280} height={800} loading="lazy" decoding="async" />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-sm">
          <Link href="/portfolio" className="button-secondary">
            {t("backToPortfolio")}
          </Link>
        </p>
      </article>
    </PageShell>
  );
}
