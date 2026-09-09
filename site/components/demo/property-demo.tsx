"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckpointRail } from "@/components/demo/checkpoint-rail";
import { PlanMap } from "@/components/demo/plan-map";
import { SodarBadge } from "@/components/demo/sodar-badge";
import { VirtualTour, type VirtualTourHandle } from "@/components/demo/virtual-tour";
import type { WalkFloor, WalkScene, Walkthrough } from "@/lib/demo/walkthrough";

type Props = { walk: Walkthrough };

/**
 * Orchestrates the demo: a lightweight poster with one "Start walkthrough"
 * action → the linked 360° tour opening in the front garden, facing the
 * entrance, with floor rings leading to the door and inside. Checkpoints, floor
 * selector and the sweep map are shortcuts; hotspots stay the primary
 * navigation. The current scene is mirrored into the URL hash
 * (replaceState, so Back leaves the page instead of replaying every step)
 * and a hash on load opens the tour at that scene.
 */
export function PropertyDemo({ walk }: Props) {
  const t = useTranslations("PropertyDemo");
  const tour = useRef<VirtualTourHandle>(null);
  const [started, setStarted] = useState(false);
  const [currentId, setCurrentId] = useState<string>(walk.startNodeId);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [startId, setStartId] = useState(walk.startNodeId);
  const [yaw, setYaw] = useState<number | null>(null);

  const scene = walk.scenes.find((s) => s.id === currentId) ?? walk.scenes[0];
  const label = useCallback((s: WalkScene) => (s.variant ? `${t(`scenes.${s.labelKey}`)} ${s.variant}` : t(`scenes.${s.labelKey}`)), [t]);

  // Deep link: /portfolio/<slug>#<scene> opens the tour directly at that scene.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id && walk.scenes.some((s) => s.id === id)) {
      setStartId(id);
      setCurrentId(id);
      setStarted(true);
    }
  }, [walk.scenes]);

  const onSceneChange = useCallback((id: string) => {
    setCurrentId((prev) => {
      if (prev !== id) setHistory((h) => [...h.slice(-30), prev]);
      return id;
    });
    setErrorId(null);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* ignore */
    }
  }, []);

  const goTo = useCallback((id: string) => {
    if (!started) {
      setStartId(id);
      setCurrentId(id);
      setStarted(true);
      return;
    }
    void tour.current?.goTo(id);
  }, [started]);

  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    void tour.current?.goTo(prev).then(() => setHistory((h) => h.filter((_, i) => i !== h.length))); // node-changed re-adds the current scene; trim it
  };
  const restart = () => {
    setStarted(false);
    setHistory([]);
    setCurrentId(walk.startNodeId);
    setStartId(walk.startNodeId);
    setErrorId(null);
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
  };
  const onFloor = (floor: WalkFloor) => {
    if (scene.floor === floor) return;
    goTo(walk.floorEntry[floor]);
  };

  const neighbours = scene.links.map((l) => walk.scenes.find((s) => s.id === l.to)!).filter(Boolean);
  const railItems = walk.checkpoints.map((c) => ({ id: c.id, nodeId: c.nodeId, label: t(`checkpoints.${c.labelKey}`), floor: c.floor, thumb: walk.scenes.find((s) => s.id === c.nodeId)!.thumbnail }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-8">
      <div>
        <div className="demo-stage" data-scene={started ? "tour" : "intro"} data-loading={loading || undefined}>
          {started ? (
            <>
              <VirtualTour ref={tour} scenes={walk.scenes} startId={startId} label={label} loadingText={t("loading")} onSceneChange={onSceneChange} onYawChange={setYaw} onLoadingChange={setLoading} onError={setErrorId} />
              <SodarBadge />
              <p className="demo-chip pointer-events-none absolute rounded-full bg-black/55 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-[#f4f2ee] backdrop-blur" aria-live="polite">
                {t(`zone.${scene.floor}`)} · {label(scene)}
              </p>
              {errorId ? (
                <div role="alert" className="absolute inset-x-4 bottom-4 z-10 rounded-xl border border-border bg-bg/90 p-4 text-sm backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[24rem] sm:-translate-x-1/2">
                  <p className="text-text">{t("errorTitle")}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="button-mini" onClick={() => void tour.current?.goTo(errorId, { instant: true })}>
                      {t("retry")}
                    </button>
                    {history.length ? (
                      <button type="button" className="button-mini" onClick={goBack}>
                        {t("back")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0">
              <img src={walk.poster} alt="" width={1280} height={800} className="absolute inset-0 h-full w-full object-cover" decoding="async" fetchPriority="high" />
              <div className="absolute inset-0 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-6 text-center sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f4f2ee]/75">{t("introLabel")}</p>
                <button type="button" onClick={() => setStarted(true)} className="button-primary bg-[#f4f2ee] text-black hover:bg-white">
                  {t("start")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-text-muted">
          <p>{t("hint")}</p>
          {started ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="button-mini" onClick={goBack} disabled={!history.length} aria-disabled={!history.length}>
                {t("back")}
              </button>
              <button type="button" className="button-mini" onClick={restart}>
                {t("restart")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <PlanMap plan={walk.plan} scenes={walk.scenes} currentId={started ? scene.id : null} yaw={started ? yaw : null} floor={scene.floor} label={label} onFloor={onFloor} onScene={goTo} />
        </div>

        {started ? (
          <nav aria-label={t("fromHere")} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="section-kicker">{t("fromHere")}</span>
            {neighbours.map((n) => (
              <button key={n.id} type="button" onClick={() => goTo(n.id)} className="button-mini">
                {label(n)}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      <aside className="lg:pt-1">
        <CheckpointRail items={railItems} activeNodeId={started ? scene.id : null} onSelect={goTo} />
      </aside>
    </div>
  );
}
