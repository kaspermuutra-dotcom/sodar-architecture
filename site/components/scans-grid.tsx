import { useTranslations } from "next-intl";
import { LoopVideo } from "@/components/loop-video";

const STILLS = ["/media/rooms/tile-02.jpg", "/media/rooms/tile-09.jpg", "/media/kitchen-gpt-image-2.jpg", "/media/rooms/tile-27.jpg"];
const TILE = (n: number) => `/media/rooms/tile-${String(n).padStart(2, "0")}.jpg`;
const CLIPS: Record<number, string> = { 0: "/media/scans-orbit.mp4", 1: "/media/scans-window.mp4" };

/** Four recent walkthroughs — one per listing type; the hover scan-line reveals colour. */
export function ScansGrid() {
  const t = useTranslations("Scans");
  const items = t.raw("items") as { label: string; meta: string }[];
  return (
    <section className="section-shell border-t border-border">
      <p className="section-kicker">{t("kicker")}</p>
      <h2 className="section-title mt-7">{t("title")}</h2>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <div key={item.label} className="group">
            <div className="tile card-scan aspect-[3/4] rounded-2xl border border-border">
              {CLIPS[i] ? <LoopVideo src={CLIPS[i]} poster={STILLS[i] ?? TILE(2)} /> : <img src={STILLS[i] ?? TILE(2)} alt="" />}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,.65))]" />
              <span className="absolute bottom-3 left-3 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-text backdrop-blur">360°</span>
            </div>
            <p className="mt-3 text-sm text-text">{item.label}</p>
            <p className="font-mono text-xs text-text-muted">{item.meta}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
