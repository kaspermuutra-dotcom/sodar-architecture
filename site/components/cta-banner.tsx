import { Link } from "@/i18n/navigation";

export function CtaBanner({ eyebrow, title, subtitle, ctaLabel, ctaHref }: { eyebrow: string; title: string; subtitle: string; ctaLabel: string; ctaHref: string }) {
  return (
    <section className="px-5 pb-24 sm:px-8 lg:px-12">
      <div className="on-ink mx-auto max-w-[1440px] rounded-2xl border border-border bg-bg-raised px-7 py-16 text-center sm:px-12 sm:py-24">
        <p className="eyebrow justify-center">{eyebrow}</p>
        <h2 className="display mx-auto mt-6 max-w-3xl text-[clamp(2.2rem,4.8vw,4.4rem)] text-text">{title}</h2>
        <p className="mx-auto mt-6 max-w-lg text-lg text-text-muted">{subtitle}</p>
        <Link href={ctaHref} className="button-primary mt-9">
          {ctaLabel}
        </Link>
      </div>
    </section>
  );
}
