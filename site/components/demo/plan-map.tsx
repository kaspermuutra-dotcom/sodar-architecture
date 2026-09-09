"use client";

import { useTranslations } from "next-intl";
import { WALK_FLOORS, type WalkFloor, type WalkScene, type WalkthroughPlan } from "@/lib/demo/walkthrough";

/** The plan never grows taller than this; wide plans shrink to fit, narrow ones are centred. */
const PLAN_MAX_HEIGHT_PX = 560;

type Props = {
  plan: WalkthroughPlan;
  scenes: WalkScene[];
  currentId: string | null;
  /** Current view direction, world yaw in degrees (clockwise from model +x). */
  yaw: number | null;
  floor: WalkFloor;
  label: (scene: WalkScene) => string;
  onFloor: (floor: WalkFloor) => void;
  onScene: (id: string) => void;
};

/**
 * Matterport-style plan view under the viewer: a top-down render of the
 * scan's own depth data per level (ceiling cut away for the interior
 * levels) with every viewpoint as a dot, the current one highlighted with
 * a view cone that follows the panorama. Dots are buttons; tapping one
 * moves there.
 */
export function PlanMap({ plan, scenes, currentId, yaw, floor, label, onFloor, onScene }: Props) {
  const t = useTranslations("PropertyDemo");
  const level = plan.levels[floor];
  const { originX, originY, width, height } = level;
  const { metresPerPixel } = plan;
  const toPx = (s: WalkScene) => [(s.position[0] - originX) / metresPerPixel, (originY - s.position[1]) / metresPerPixel] as const;
  const onFloorScenes = scenes.filter((s) => s.floor === floor);
  const current = scenes.find((s) => s.id === currentId) ?? null;
  const showCone = current && current.floor === floor && yaw !== null;
  // world yaw ψ is clockwise from +x; image x = east, image y = south → angle in image space = ψ (clockwise from +x)
  const coneAngle = yaw ?? 0;
  const dotR = Math.max(7, width / 90); // scales with the level's zoom so dots stay the same size on screen

  return (
    <section className="demo-plan" aria-label={t("planLabel")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("floorLabel")} className="flex rounded-full border border-border p-1 font-mono text-[10px] uppercase tracking-[.14em]">
          {WALK_FLOORS.map((f) => (
            <button key={f} type="button" onClick={() => onFloor(f)} aria-pressed={f === floor} className={`rounded-full px-3 py-1.5 transition-colors ${f === floor ? "bg-text text-bg" : "text-text-muted hover:text-text"}`}>
              {t(`zone.${f}`)}
            </button>
          ))}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">{t("planNote")}</p>
      </div>
      <div className="demo-plan-canvas mt-3" style={{ aspectRatio: `${width} / ${height}`, maxWidth: `${Math.round((PLAN_MAX_HEIGHT_PX * width) / height)}px` }}>
        <img key={floor} src={level.image} alt="" width={width} height={height} decoding="async" className="absolute inset-0 h-full w-full object-contain" />
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" role="list" aria-label={t("mapLabel")}>
          {showCone && current ? (
            <g transform={`translate(${toPx(current)[0]} ${toPx(current)[1]}) rotate(${coneAngle})`} aria-hidden>
              <path d={`M0 0 L${dotR * 9} ${-dotR * 4.2} A${dotR * 9.9} ${dotR * 9.9} 0 0 1 ${dotR * 9} ${dotR * 4.2} Z`} className="demo-plan-cone" />
            </g>
          ) : null}
          {onFloorScenes.map((s) => {
            const [x, y] = toPx(s);
            const active = s.id === currentId;
            return (
              <g key={s.id} role="listitem" transform={`translate(${x} ${y})`}>
                <circle r={active ? dotR * 1.25 : dotR} className={active ? "demo-plan-dot is-active" : "demo-plan-dot"} />
                <circle r={dotR * 2.2} fill="transparent" className="cursor-pointer outline-none" tabIndex={0} role="button" aria-label={label(s)} aria-current={active ? "true" : undefined} onClick={() => onScene(s.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onScene(s.id)) : undefined)}>
                  <title>{label(s)}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
