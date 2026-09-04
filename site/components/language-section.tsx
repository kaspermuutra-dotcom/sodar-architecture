import { LanguageSwitcher } from "@/components/language-switcher";

/** The language switcher as its own beat, not a footer afterthought. */
export function LanguageSection() {
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
        <div>
          <p className="section-kicker">Wherever your buyers search</p>
          <h2 className="section-title mt-7">
            One walkthrough.
            <br />
            Every language a buyer reads.
          </h2>
          <p className="mt-7 max-w-lg text-lg text-text-muted">
            Publish once — the viewer&apos;s room labels and controls follow the language the buyer set. English ships
            complete today; the rest are queued.
          </p>
        </div>
        <LanguageSwitcher />
      </div>
    </section>
  );
}
