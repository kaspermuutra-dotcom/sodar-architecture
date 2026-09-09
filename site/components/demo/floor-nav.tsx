"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { WALK_FLOORS, type WalkFloor, type WalkScene } from "@/lib/demo/walkthrough";

type Props = {
  scenes: WalkScene[];
  currentId: string | null;
  currentFloor: WalkFloor;
  label: (scene: WalkScene) => string;
  onFloor: (floor: WalkFloor) => void;
  onScene: (id: string) => void;
};

/**
 * Compact floor selector plus a sweep-position map. The map is drawn from
 * the scan's own sweep coordinates (top-down, metres), not from a rendered
 * floor plan, and says so; each dot is a real panorama the visitor can jump
 * to. The active dot follows the current scene.
 */
export function FloorNav({ scenes, currentId, currentFloor, label, onFloor, onScene }: Props) {
  const t = useTranslations("PropertyDemo");
  const floorScenes = scenes.filter((s) => s.floor === currentFloor);
  const box = useMemo(() => {
    const xs = scenes.map((s) => s.position[0]);
    const ys = scenes.map((s) => s.position[1]);
    return { minX: Math.min(...xs) - 1, maxX: Math.max(...xs) + 1, minY: Math.min(...ys) - 1, maxY: Math.max(...ys) + 1 };
  }, [scenes]);
  const W = 200;
  const H = Math.round((W * (box.maxY - box.minY)) / (box.maxX - box.minX));
  const px = (s: WalkScene) => [((s.position[0] - box.minX) / (box.maxX - box.minX)) * W, ((box.maxY - s.position[1]) / (box.maxY - box.minY)) * H] as const;

  return (
    <div className="demo-floornav">
      <div role="group" aria-label={t("floorLabel")} className="flex rounded-full border border-border p-1 font-mono text-[10px] uppercase tracking-[.14em]">
        {WALK_FLOORS.map((floor) => (
          <button key={floor} type="button" onClick={() => onFloor(floor)} aria-pressed={floor === currentFloor} className={`flex-1 rounded-full px-2 py-1.5 transition-colors ${floor === currentFloor ? "bg-text text-bg" : "text-text-muted hover:text-text"}`}>
            {t(`zone.${floor}`)}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("mapLabel")} className="mt-3 w-full rounded-xl border border-border bg-bg-raised">
        {scenes.filter((s) => s.floor !== currentFloor).map((s) => {
          const [x, y] = px(s);
          return <circle key={s.id} cx={x} cy={y} r={1.6} className="fill-text-faint/40" />;
        })}
        {floorScenes.map((s) => {
          const [x, y] = px(s);
          const active = s.id === currentId;
          return (
            <g key={s.id} role="button" tabIndex={0} aria-label={label(s)} aria-current={active ? "true" : undefined} className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-text" onClick={() => onScene(s.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), onScene(s.id)) : undefined)}>
              <circle cx={x} cy={y} r={active ? 5 : 3.2} strokeWidth={active ? 1.5 : 1} className={active ? "fill-text stroke-bg" : "fill-bg stroke-text-muted hover:stroke-text"} />
              <title>{label(s)}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">{t("mapNote")}</p>
    </div>
  );
}
