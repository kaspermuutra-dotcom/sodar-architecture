"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { WALK_FLOORS, type WalkFloor } from "@/lib/demo/walkthrough";

export type RailItem = { id: string; nodeId: string; label: string; floor: WalkFloor; thumb: string };

type Props = {
  items: RailItem[];
  activeNodeId: string | null;
  onSelect: (nodeId: string) => void;
};

/**
 * Curated checkpoint shortcuts, grouped by floor. Beside the viewer on wide
 * screens (list with real stills); below it on narrower ones as a native
 * <select>, which stays compact and keyboard-friendly without covering the
 * panorama. Sweep-to-sweep hotspots remain the primary navigation.
 */
export function CheckpointRail({ items, activeNodeId, onSelect }: Props) {
  const t = useTranslations("PropertyDemo");
  const selectId = useId();
  const groups = WALK_FLOORS.map((floor) => ({ floor, items: items.filter((i) => i.floor === floor) })).filter((g) => g.items.length);
  const activeItem = items.find((i) => i.nodeId === activeNodeId);

  return (
    <nav aria-label={t("checkpointsHeading")} className="demo-rail">
      <div className="lg:hidden">
        <label htmlFor={selectId} className="field">
          {t("checkpointsHeading")}
          <select
            id={selectId}
            className="field-input"
            value={activeItem?.id ?? ""}
            onChange={(e) => {
              const item = items.find((i) => i.id === e.target.value);
              if (item) onSelect(item.nodeId);
            }}
          >
            <option value="" disabled>
              {t("choose")}
            </option>
            {groups.map((g) => (
              <optgroup key={g.floor} label={t(`zone.${g.floor}`)}>
                {g.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <div className="hidden lg:block">
        {groups.map((g) => (
          <section key={g.floor} className="mb-5 last:mb-0">
            <h3 className="section-kicker mb-2 flex items-center gap-2">
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${g.floor === "exterior" ? "bg-text" : "border border-text"}`} />
              {t(`zone.${g.floor}`)}
            </h3>
            <ul className="space-y-1">
              {g.items.map((item) => {
                const active = item.nodeId === activeNodeId;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelect(item.nodeId)} aria-current={active ? "true" : undefined} data-node={item.nodeId} className={`demo-rail-item ${active ? "is-active" : ""}`}>
                      <img src={item.thumb} alt="" width={64} height={32} loading="lazy" decoding="async" className="h-8 w-16 flex-none rounded-md object-cover" />
                      <span className="truncate text-sm">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
