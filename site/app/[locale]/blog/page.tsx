import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { ScanReveal } from "@/components/scan-reveal";
import { FlatListingPhoto, SodarWalkthroughFrame } from "@/components/scan-placeholders";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "BlogPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/blog") };
}

export default async function BlogPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("BlogPage");
  const posts = t.raw("posts") as { title: string; tag: string; read: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <section className="section-shell border-t border-border pt-0">
        <div className="grid gap-8 sm:grid-cols-2">
          {posts.map((post, i) => (
            <article key={post.title} className="group">
              <ScanReveal
                trigger="hover"
                durationMs={900}
                frameClassName="aspect-[16/10]"
                flat={<FlatListingPhoto />}
                revealed={<SodarWalkthroughFrame />}
                direction={i % 2 === 0 ? "down" : "right"}
              />
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[.16em] text-text-muted">{post.tag}</p>
              <h2 className="display mt-2 text-2xl text-text">{post.title}</h2>
              <p className="mt-2 text-sm text-text-muted">{post.read}</p>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
