import { Link } from "@/i18n/navigation";
import { TerminalMock } from "@/components/terminal-mock";

/** Cropped workspace preview + CTA to the public /terminal preview page. */
export function TerminalPreviewSection() {
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-24">
        <p className="section-kicker">Back at the desk</p>
        <p className="max-w-xl self-end text-lg leading-relaxed text-text-muted">
          Every property you scan, its processing and publication status, and how many visitors opened the viewer —
          in one workspace per broker.
        </p>
      </div>
      <h2 className="section-title mt-7">Your properties, always in view.</h2>

      <div className="relative mt-14 max-h-[440px] overflow-hidden rounded-[1.75rem]">
        <TerminalMock />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
      </div>
      <div className="mt-8 flex justify-center">
        <Link href="/terminal" className="button-secondary">
          See the broker workspace <span aria-hidden>↗</span>
        </Link>
      </div>
    </section>
  );
}
