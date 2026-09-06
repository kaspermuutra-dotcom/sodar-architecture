/* Sodar pitch deck — navigation, time-driven film, strategy canvas.
   The film is a pure function of time: renderAt(t) draws the exact frame for t, which is what
   live playback (rAF) and the MP4 export (export/render.mjs) both call. */
(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");
  const params = new URLSearchParams(location.search);
  const EXPORT = params.get("export") === "1";
  if (EXPORT) document.body.classList.add("export");
  if (params.get("motion") === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches) document.body.classList.add("noanim");
  let idx = 0;

  /* ---------- scale 1920×1080 stages to the viewport ---------- */
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    document.documentElement.style.setProperty("--scale", s);
    slides.forEach((el) => el.style.setProperty("--scale", s));
  }
  addEventListener("resize", fit);
  fit();

  /* ---------- navigation ---------- */
  function go(n, push = true) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === idx && slides[n].classList.contains("active")) return;
    const prev = slides[idx];
    idx = n;
    slides.forEach((el, i) => el.classList.toggle("active", i === n));
    counter.textContent = `${String(n + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    progress.style.width = `${((n + 1) / slides.length) * 100}%`;
    if (push) history.replaceState(null, "", `#${n + 1}`);
    slides.forEach((el, i) => el.querySelectorAll(":scope > video").forEach((v) => (i === n ? v.play().catch(() => {}) : v.pause())));
    if (prev && prev.id === "film") film.stop();
    if (slides[n].id === "film" && !EXPORT) film.start();
    if (slides[n].id === "film" && EXPORT) film.renderAt(0);
  }
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowRight" || k === " " || k === "PageDown" || k === "Enter") { e.preventDefault(); go(idx + 1); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); go(idx - 1); }
    else if (k === "Home") go(0);
    else if (k === "End") go(slides.length - 1);
    else if (k === "f" || k === "F") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    else if (k === "r" || k === "R") { if (slides[idx].id === "film") film.restart(); }
    else if (k === "p" || k === "P" || (k === "k" && slides[idx].id === "film")) { if (slides[idx].id === "film") film.toggle(); }
  });
  addEventListener("click", (e) => {
    if (slides[idx].id === "film") return;
    if (e.target.closest("a, button")) return;
    go(e.clientX / innerWidth < 0.2 ? idx - 1 : idx + 1);
  });

  /* ---------- easing helpers ---------- */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const ramp = (t, at, dur = 0.4) => clamp01((t - at) / dur); // 0 before at, 1 after at+dur
  const hold = (t, from, to, fade = 0.4) => Math.min(ramp(t, from, fade), 1 - ramp(t, to, fade)); // in then out

  /* ---------- film ---------- */
  const film = (() => {
    const root = document.getElementById("film");
    const scenes = [...root.querySelectorAll(".scene")].map((el) => ({ el, dur: parseFloat(el.dataset.dur), video: el.querySelector(":scope > video, :scope > .zoomer > video") }));
    let acc = 0;
    scenes.forEach((s) => { s.start = acc; acc += s.dur; s.end = acc; });
    const total = acc;
    const X = 0.7; // crossfade length at each cut
    const fill = document.getElementById("fill"), track = document.getElementById("track"), timeEl = document.getElementById("time"), nameEl = document.getElementById("sceneName"), pp = document.getElementById("pp");
    const names = ["Introduction", "Capture", "Capture", "AI assistant", "Room by room", "Stitch", "Preview", "Free preview", "Publish", "Back at the desk", "kv.ee", "Pay once", "Sodar for CRMs", "sodar.io"];
    const dots = scenes.map((s) => { const d = document.createElement("span"); d.className = "ch"; d.style.left = `${(s.start / total) * 100}%`; track.appendChild(d); return d; });
    track.addEventListener("click", (e) => { const r = track.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total); });
    pp.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    root.querySelector(".frame").addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const $ = (id) => document.getElementById(id);

    /* ---- element handles ---- */
    const E = {};
    ["hud1", "hud1b", "hud2", "assist", "hud4l", "hud4", "ret4", "stitch4", "cap4", "zoomer", "portalWrap", "pgResults", "pgListing", "pgEdit", "kvRowTitle", "kvEditBtn", "kvField", "typed", "caret", "kvVerify", "kvSave", "kvToast", "kbd", "cursor", "ring", "kvGallery", "kvVideo", "kvBadge", "kvHot", "kvCount", "kvAll", "kvAi", "tabPics", "tabTour", "kvStat", "kvOpens", "cap7", "wsNew", "wsOpens"].forEach((id) => (E[id] = $(id)));
    const chips = [...E.assist.querySelectorAll(".chip")];

    /* ---- on-screen keyboard ---- */
    const rows = ["1234567890-", "qwertyuiop", "asdfghjkl:", "zxcvbnm./"];
    const keyEls = {};
    rows.forEach((r) => { const row = document.createElement("div"); row.className = "row"; [...r].forEach((ch) => { const k = document.createElement("span"); k.className = "k"; k.textContent = ch; row.appendChild(k); keyEls[ch] = k; }); E.kbd.appendChild(row); });
    const last = document.createElement("div"); last.className = "row";
    const spk = document.createElement("span"); spk.className = "k sp"; spk.textContent = "space"; last.appendChild(spk); keyEls[" "] = spk;
    const ent = document.createElement("span"); ent.className = "k w"; ent.textContent = "return"; last.appendChild(ent); keyEls["\n"] = ent;
    E.kbd.appendChild(last);

    /* ---- kv.ee choreography (scene-local seconds) ---- */
    const TEXT = "https://sodar.io/w/kesklinn-84";
    const T_TYPE = 8.0;
    const delays = [...TEXT].map((ch, k) => (ch === "." || ch === "/" || ch === "-" || ch === ":" ? 0.3 : 0.11 + ((k * 7) % 5) * 0.03));
    const typeTimes = []; { let a = T_TYPE; delays.forEach((d) => { a += d; typeTimes.push(a); }); }
    const T_TYPED = typeTimes[typeTimes.length - 1];
    const K = { clickRow: 2.6, pgListing: 3.0, clickEdit: 5.4, pgEdit: 5.85, clickField: 7.4, clickSave: T_TYPED + 2.2, pgLive: T_TYPED + 2.75 };
    // cursor path: [t0, t1, target]; target = [elementId, dx, dy] (element centre + offset) or [x, y] in frame px
    const path = [
      [0, 0, [1500, 900]],
      [1.1, 2.3, ["kvRowTitle", 0, 0]],
      [3.8, 5.0, ["kvEditBtn", 0, 0]],
      [6.3, 7.2, ["kvField", -300, 2]],
      [T_TYPED + 0.9, T_TYPED + 2.0, ["kvSave", 0, 0]],
      [K.pgLive + 0.9, K.pgLive + 2.6, [760, 585]],
      [K.pgLive + 3.0, K.pgLive + 4.8, [930, 565]],
    ];
    const clicks = [K.clickRow, K.clickEdit, K.clickField, K.clickSave];
    const frameRect = () => root.querySelector(".frame").getBoundingClientRect();
    function resolve(target) {
      if (typeof target[0] === "number") return target;
      const [id, dx, dy] = target; const el = $(id); const r = el.getBoundingClientRect(); const f = frameRect(); const s = f.width / 1920;
      return [(r.left + r.width / 2 - f.left) / s + dx, (r.top + r.height / 2 - f.top) / s + dy];
    }
    function cursorAt(lt) {
      let pos = resolve(path[0][2]);
      for (const [t0, t1, target] of path) {
        if (lt < t0) break;
        const to = resolve(target);
        if (lt >= t1) { pos = to; continue; }
        const p = easeInOut((lt - t0) / (t1 - t0));
        pos = [pos[0] + (to[0] - pos[0]) * p, pos[1] + (to[1] - pos[1]) * p];
        break;
      }
      return pos;
    }

    /* ---- pure frame renderer ---- */
    let cur = -1;
    function sceneOpacity(k, t) {
      const s = scenes[k];
      if (t < s.start - X || t >= s.end) return 0;
      if (t < s.start) return easeInOut((t - (s.start - X)) / X);
      return 1;
    }
    function renderAt(t, exportSeek = false) {
      t = Math.max(0, Math.min(total, t));
      const seeks = [];
      let active = scenes.length - 1;
      for (let k = 0; k < scenes.length; k++) if (t < scenes[k].end) { active = k; break; }
      scenes.forEach((s, k) => {
        const o = sceneOpacity(k, t);
        s.el.style.opacity = o;
        s.el.style.visibility = o > 0 ? "visible" : "hidden";
        if (s.video && o > 0) {
          const want = t - s.start;
          if (exportSeek) seeks.push(seekVideo(s.video, want));
          else if (!s.video.loop && Math.abs(s.video.currentTime - want) > 0.3 && want >= 0 && want < (s.video.duration || 5)) { try { s.video.currentTime = Math.max(0, want); } catch (_) {} }
        }
      });
      if (exportSeek && sceneOpacity(10, t) > 0) seeks.push(seekVideo(E.kvVideo, t - scenes[10].start - K.pgLive));
      if (active !== cur) { cur = active; nameEl.textContent = `${String(active + 1).padStart(2, "0")} · ${names[active] || ""}`; dots.forEach((d, k) => d.classList.toggle("done", k <= active)); }
      scenes.forEach((s, k) => { if (sceneOpacity(k, t) > 0) sceneState(k, t - s.start); });
      fill.style.width = `${(t / total) * 100}%`;
      timeEl.textContent = `${fmt(t)} / ${fmt(total)}`;
      return exportSeek ? Promise.all(seeks) : null;
    }
    function seekVideo(v, want) {
      const d = v.duration || 5;
      let goal = Math.max(0, want);
      goal = v.loop ? goal % d : Math.min(goal, d - 0.04);
      if (Math.abs(v.currentTime - goal) < 0.005) return Promise.resolve();
      return new Promise((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); setTimeout(done, 800); v.currentTime = goal; });
    }
    const ST = (el, o) => { el.style.opacity = o; };
    function sceneState(k, lt) {
      switch (k) {
        case 2: { const f = Math.min(12, 1 + Math.floor(lt * 1.4)); E.hud1.textContent = `${f}/12`; E.hud1b.textContent = `${Math.min(98, 8 + Math.round(lt * 12))}%`; break; }
        case 3: { [0.4, 1.5, 2.6, 4.0].forEach((at, j) => { const o = ramp(lt, at, 0.4); chips[j].style.opacity = o; chips[j].style.transform = `translateY(${(1 - o) * -8}px)`; }); E.hud2.textContent = `${Math.min(12, 8 + Math.floor(lt))}/12`; break; }
        case 5: {
          const st = lt >= 3.2;
          E.hud4l.textContent = st ? "STITCH" : "CAPTURE"; E.hud4.textContent = st ? "equirectangular · 8192×4096" : `${Math.min(12, 3 + Math.floor(lt * 3))}/12`;
          ST(E.ret4, 0.8 * (1 - ramp(lt, 3.2, 0.4))); ST(E.stitch4, ramp(lt, 3.2, 0.3)); E.stitch4.firstElementChild.style.width = `${clamp01((lt - 3.2) / 1.8) * 100}%`;
          E.cap4.textContent = st ? "Stitched into a panorama." : "Twelve frames per room, straight from the browser."; break;
        }
        case 9: { const p = easeInOut(clamp01((lt - 2.0) / 1.2)); E.zoomer.style.transform = `scale(${1 + 0.35 * p})`; E.zoomer.style.filter = `blur(${10 * p}px)`; E.zoomer.style.opacity = 1 - clamp01((lt - 2.5) / 0.7); break; }
        case 10: kvState(lt); break;
        case 12: { const o = ramp(lt, 1.2, 0.5); E.wsNew.style.opacity = o; E.wsNew.style.transform = `translateY(${(1 - o) * 6}px)`; E.wsOpens.textContent = String(Math.min(128, 1 + Math.floor(Math.max(0, lt - 1.6) * 40))); break; }
      }
    }
    function kvState(lt) {
      const pin = easeOut(clamp01(lt / 1.2));
      E.portalWrap.style.opacity = pin; E.portalWrap.style.transform = `scale(${1.04 - 0.04 * pin})`;
      const pages = [[E.pgResults, 0, K.pgListing], [E.pgListing, K.pgListing, K.pgEdit], [E.pgEdit, K.pgEdit, K.pgLive], [E.pgListing, K.pgLive, 99]];
      let listingO = 0;
      pages.forEach(([el, a, b]) => { const o = hold(lt, a - 0.35, b, 0.35); if (el === E.pgListing) listingO = Math.max(listingO, o); else { ST(el, o); el.style.visibility = o > 0 ? "visible" : "hidden"; } });
      ST(E.pgListing, listingO); E.pgListing.style.visibility = listingO > 0 ? "visible" : "hidden";
      const live = ramp(lt, K.pgLive + 0.5, 1.2);
      ST(E.kvVideo, live); ST(E.kvBadge, live); ST(E.kvHot, live); ST(E.kvAi, live); ST(E.kvAll, 1 - live);
      E.kvCount.textContent = live > 0.5 ? "Virtuaaltuur · 3 tuba · lohista ringi vaatamiseks" : "1 / 24";
      E.tabTour.classList.toggle("cur", live > 0.5); E.tabPics.classList.toggle("cur", live <= 0.5);
      ST(E.kvStat, ramp(lt, K.pgLive + 1.0, 0.5)); E.kvOpens.textContent = String(Math.min(128, Math.floor(Math.max(0, lt - K.pgLive - 1.2) * 28)));
      if (lt >= K.pgLive + 0.5 && E.kvVideo.paused && !EXPORT && playing) E.kvVideo.play().catch(() => {});
      E.kvField.classList.toggle("focus", lt >= K.clickField);
      let n = 0; while (n < TEXT.length && lt >= typeTimes[n]) n++;
      E.typed.textContent = TEXT.slice(0, n);
      E.caret.style.opacity = lt >= K.clickField && lt < K.clickSave ? (Math.floor((lt - K.clickField) * 2) % 2 === 0 || (n > 0 && lt - typeTimes[n - 1] < 0.35) ? 1 : 0) : 0;
      Object.values(keyEls).forEach((k) => k.classList.remove("on"));
      if (n > 0 && lt - typeTimes[n - 1] < 0.14 && keyEls[TEXT[n - 1]]) keyEls[TEXT[n - 1]].classList.add("on");
      if (lt >= K.clickSave && lt < K.clickSave + 0.25) keyEls["\n"].classList.add("on");
      ST(E.kbd, hold(lt, K.clickField + 0.2, K.clickSave + 0.3, 0.4));
      const vo = ramp(lt, T_TYPED + 0.4, 0.4); ST(E.kvVerify, vo); E.kvVerify.style.transform = `translateY(${(1 - vo) * -4}px)`;
      E.kvSave.style.opacity = lt >= K.clickSave && lt < K.pgLive ? 0.8 : 1;
      E.kvEditBtn.style.opacity = lt >= K.clickEdit && lt < K.pgEdit ? 0.8 : 1;
      const to = hold(lt, K.pgLive + 0.2, K.pgLive + 3.6, 0.5); ST(E.kvToast, to); E.kvToast.style.transform = `translateY(${(1 - to) * -8}px)`;
      ST(E.cap7, ramp(lt, K.pgLive + 2.6, 0.8));
      const [cx, cy] = cursorAt(lt); E.cursor.style.left = `${cx}px`; E.cursor.style.top = `${cy}px`;
      let ringO = 0, ringS = 0.4;
      for (const tc of clicks) { const p = (lt - tc) / 0.5; if (p >= 0 && p < 1) { ringO = 0.9 * (1 - p); ringS = 0.4 + p; } }
      E.ring.style.opacity = ringO; E.ring.style.transform = `scale(${ringS})`;
    }

    /* ---- live playback ---- */
    let t = 0, playing = false, lastNow = 0, raf = 0, ticker = 0;
    function syncVideos() {
      scenes.forEach((s, k) => { if (!s.video) return; const o = sceneOpacity(k, t); if (o > 0 && playing) { if (s.video.paused) s.video.play().catch(() => {}); } else if (!s.video.paused) s.video.pause(); });
      if (!(sceneOpacity(10, t) > 0)) E.kvVideo.pause();
    }
    function frame(now) {
      if (!playing) return;
      const dt = Math.min(1, (now - lastNow) / 1000); lastNow = now; t += dt;
      if (t >= total) { t = total; playing = false; pp.textContent = "Replay"; clearInterval(ticker); renderAt(t); syncVideos(); return; }
      renderAt(t); syncVideos();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (t >= total) t = 0;
      playing = true; lastNow = performance.now(); pp.textContent = "Pause"; root.classList.remove("paused");
      renderAt(t); syncVideos();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
      clearInterval(ticker); ticker = setInterval(() => { if (playing) frame(performance.now()); }, 100);
    }
    function pause() { playing = false; pp.textContent = "Play"; root.classList.add("paused"); cancelAnimationFrame(raf); clearInterval(ticker); root.querySelectorAll("video").forEach((v) => v.pause()); }
    function toggle() { playing ? pause() : play(); }
    function seek(nt) { t = Math.max(0, Math.min(total - 0.01, nt)); scenes.forEach((s) => { if (s.video && !s.video.loop) { try { s.video.currentTime = Math.max(0, Math.min(t - s.start, (s.video.duration || 5) - 0.05)); } catch (_) {} } }); renderAt(t); if (!playing) play(); }
    function start() { t = 0; cur = -1; scenes.forEach((s) => { if (s.video) { try { s.video.currentTime = 0; } catch (_) {} } }); play(); }
    function stop() { pause(); }
    function restart() { start(); }
    async function prepareExport() {
      pause();
      const vids = [...root.querySelectorAll("video")];
      await Promise.all(vids.map((v) => (v.readyState >= 2 ? Promise.resolve() : new Promise((r) => { v.addEventListener("loadeddata", r, { once: true }); v.load(); }))));
      await document.fonts.ready;
      return total;
    }
    return { start, stop, restart, toggle, seek, pause, renderAt, prepareExport, total };
  })();

  /* ---------- strategy canvas (colour + direct labels + legend rows) ---------- */
  (function canvas() {
    const svg = document.getElementById("canvas");
    const factors = ["Camera", "Subscription", "Photographer", "Days to publish", "Phone only", "Inside the listing", "Pay once", "Opens counted"];
    const series = [
      { name: "Matterport", v: [4, 4, 3, 3, 1, 1, 0, 3], color: "#2F6FE0", w: 3, note: "$6,000 camera, monthly plan, hosting per tour" },
      { name: "Giraffe360", v: [3, 4, 2, 2, 0, 1, 0, 2], color: "#C97F0E", w: 3, note: "Own camera on a $360 / month subscription" },
      { name: "CubiCasa · iGUIDE", v: [2, 2, 1, 2, 3, 0, 2, 0], color: "#D23F86", w: 3, note: "Floor plans and LiDAR reports, not walkthroughs" },
      { name: "Sodar", v: [0, 0, 0, 0, 4, 4, 4, 4], color: "#F4F2EE", w: 5, note: "Any phone. One price per listing. Lives inside kv.ee." },
    ];
    const W = 1100, H = 520, L = 60, R = 40, T = 70, B = 110;
    const x = (i) => L + (i * (W - L - R)) / (factors.length - 1);
    const y = (v) => T + ((4 - v) * (H - T - B)) / 4;
    const mono = 'font-family="JetBrains Mono, monospace"';
    let s = "";
    const mid = (x(3) + x(4)) / 2;
    s += `<rect x="${L - 30}" y="${T - 30}" width="${mid - L + 30}" height="${H - T - B + 60}" fill="rgba(255,255,255,.025)" rx="10" />`;
    s += `<rect x="${mid}" y="${T - 30}" width="${W - R - mid + 30}" height="${H - T - B + 60}" fill="rgba(47,111,224,.08)" stroke="rgba(47,111,224,.35)" rx="10" />`;
    s += `<text x="${(L + mid) / 2}" y="${T - 44}" text-anchor="middle" fill="#8d8b87" ${mono} font-size="16" letter-spacing="2">WHAT THEY CHARGE FOR</text>`;
    s += `<text x="${(mid + W - R) / 2}" y="${T - 44}" text-anchor="middle" fill="#7fa6f0" ${mono} font-size="16" letter-spacing="2">BLUE WHALE · WHAT SODAR DOES</text>`;
    for (let v = 0; v <= 4; v++) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)" />`;
    s += `<text x="${L - 14}" y="${y(4) + 6}" text-anchor="end" fill="#55534f" ${mono} font-size="15">MORE</text>`;
    s += `<text x="${L - 14}" y="${y(0) + 6}" text-anchor="end" fill="#55534f" ${mono} font-size="15">NONE</text>`;
    factors.forEach((f, i) => {
      const words = f.split(" "), cut = Math.ceil(words.length / 2);
      const l1 = words.length > 1 ? words.slice(0, cut).join(" ") : f, l2 = words.length > 1 ? words.slice(cut).join(" ") : "";
      s += `<text x="${x(i)}" y="${H - B + 34}" text-anchor="middle" fill="#bdbab4" font-family="Inter, sans-serif" font-size="19"><tspan x="${x(i)}">${l1}</tspan><tspan x="${x(i)}" dy="22">${l2}</tspan></text>`;
    });
    series.forEach((se) => {
      const pts = se.v.map((v, i) => `${x(i)},${y(v)}`).join(" ");
      s += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="${se.w}" stroke-linejoin="round" stroke-linecap="round" opacity="${se.name === "Sodar" ? 1 : .9}" />`;
      se.v.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="${se.name === "Sodar" ? 8 : 6}" fill="${se.color}" stroke="#050505" stroke-width="2.5" />`; });
    });
    s += `<text x="${x(7)}" y="${y(4) - 18}" text-anchor="end" fill="#F4F2EE" ${mono} font-size="16" letter-spacing="1">SODAR</text>`;
    s += `<text x="${x(0) - 6}" y="${y(4) - 16}" fill="#2F6FE0" ${mono} font-size="15" letter-spacing="1">MATTERPORT</text>`;
    s += `<text x="${x(1) + 12}" y="${y(4) - 16}" fill="#C97F0E" ${mono} font-size="15" letter-spacing="1">GIRAFFE360</text>`;
    s += `<text x="${x(4) + 12}" y="${y(3) - 14}" fill="#D23F86" ${mono} font-size="15" letter-spacing="1">CUBICASA · IGUIDE</text>`;
    svg.innerHTML = s;
    document.getElementById("who").innerHTML = series.map((se) => `<div class="row${se.name === "Sodar" ? " us" : ""}"><i style="background:${se.color}"></i><div><b>${se.name}</b><span>${se.note}</span></div></div>`).join("");
  })();

  setTimeout(() => document.body.classList.add("quiet"), 8000);
  window.sodarDeck = { go, film };

  /* ---------- boot ---------- */
  const h = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(h) && h > 0 ? h - 1 : 0, false);
})();
