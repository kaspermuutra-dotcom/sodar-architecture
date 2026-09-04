import { Link } from "@/i18n/navigation";

export function CtaBanner({ eyebrow, title, subtitle, ctaLabel, ctaHref }: { eyebrow: string; title: string; subtitle: string; ctaLabel: string; ctaHref: string }) {
  return (
    <section className="px-5 pb-20 sm:px-8 lg:px-12">
      <div className="on-ink relative mx-auto max-w-[1440px] overflow-hidden rounded-[2rem] border border-border-strong bg-bg-raised px-7 py-16 text-center sm:px-12 sm:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(244,242,238,.08),transparent_70%)]" />
        <p className="eyebrow justify-center">
          <span /> {eyebrow}
        </p>
        <h2 className="display mx-auto mt-7 max-w-4xl text-[clamp(2.4rem,6vw,5.8rem)] text-text">{title}</h2>
        <p className="mx-auto mt-7 max-w-lg text-lg text-text-muted">{subtitle}</p>
        <Link href={ctaHref} className="button-primary mt-8">
          {ctaLabel} <span aria-hidden>↗</span>
        </Link>
      </div>
    </section>
  );
}
