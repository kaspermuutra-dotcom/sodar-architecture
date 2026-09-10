import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPortfolioProject } from "@/lib/portfolio";
import { PageShell } from "@/components/page-shell";
import { ReviewGrid } from "@/components/demo/review-grid";
import review from "@/lib/demo/kaldapealse-tanav-2.review.json";

type Params = { params: Promise<{ locale: string; slug: string }> };

/** Unlisted, noindex human-review page: every checkpoint's clean reference preview against the current master. */
export const metadata: Metadata = { title: "Reconstruction review — Kaldapealse tänav 2", robots: { index: false, follow: false, nocache: true } };

export default async function ReviewPage({ params }: Params) {
  const { locale, slug } = await params;
  if (slug !== "kaldapealse-tanav-2") notFound();
  const project = getPortfolioProject(slug);
  if (!project) notFound();
  setRequestLocale(locale);
  return (
    <PageShell>
      <article className="mx-auto max-w-[1600px] px-5 pb-20 pt-8 sm:px-8">
        <p className="eyebrow">Internal review · not linked · noindex</p>
        <h1 className="display mt-3 text-[clamp(1.8rem,3.5vw,3rem)]">Reconstruction review — {project.walkthrough.title}</h1>
        <p className="mt-3 max-w-3xl text-sm text-text-muted">
          Left: Matterport&apos;s own 512 px preview cubemap (the geometric reference). Right: the current high-resolution master
          rendered at exactly the same yaw, pitch and field of view. Statuses are set by hand after visual inspection; a scene
          passes only when walls, corners, door frames, stairs and floors are continuous and no doubled edge, mask or colour
          patch remains.
        </p>
        <ReviewGrid scenes={project.walkthrough.scenes} review={review} base={`/media/review/${slug}`} />
      </article>
    </PageShell>
  );
}
