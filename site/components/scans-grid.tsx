import { useTranslations } from "next-intl";
import { LoopVideo } from "@/components/loop-video";

const STILLS = ["/media/scans-window.jpg", "/media/scans-orbit.jpg", "/media/scans-kitchen.jpg", "/media/scans-street.jpg"];
const CLIPS: Record<number, string> = { 0: "/media/scans-window.mp4", 1: "/media/scans-orbit.mp4" };

/** Four recent walkthroughs — one per listing type. */
export function ScansGrid() {
  const t = useTranslations("Scans");
  const items = t.raw("items") as { label: string; meta: string }[];
  return (
    <section className="section-shell border-t border-border">
      <p className="section-kicker">{t("kicker")}</p>
      <h2 className="section-title mt-6">{t("title")}</h2>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <div key={item.label}>
            <div className="tile aspect-[3/4] rounded-xl border border-border">
              {CLIPS[i] ? <LoopVideo src={CLIPS[i]} poster={STILLS[i]} /> : <img src={STILLS[i]} alt="" />}
            </div>
            <p className="mt-4 text-sm text-text">{item.label}</p>
            <p className="mt-1 text-xs text-text-muted">{item.meta}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
