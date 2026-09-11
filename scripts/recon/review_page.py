"""Private three-scene review page: identical views from every source with click-to-flicker comparison.

For each scene and each view (yaw, pitch, hfov) a JPEG is rendered from every available source (preview cube,
rejected t3 master, candidates A/B/C). The page is self-contained (data URIs) so it can be published privately as
an artifact, and it keeps a total size budget by using 720 px views and 100 % crops of 560 px.

Usage: python scripts/recon/review_page.py <export> --render <dir> --out <dir> --scenes id8:Label,...
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import CaptureExport  # noqa: E402
from recon.compare import render_faces, t3_faces, view  # noqa: E402

VIEWS = [(0, -5, 60), (60, -5, 60), (120, -5, 60), (180, -5, 60), (240, -5, 60), (300, -5, 60), (0, -50, 70), (180, -50, 70), (0, 40, 70)]
CROPS = {  # 100 % crops: (yaw, pitch, hfov 24 → ≈34 px/° at 800 px, i.e. native 3072-face resolution)
    "6075ef93": [(300, -5, 24), (20, 0, 24), (80, -10, 24), (150, -12, 24), (200, -35, 24), (330, -30, 24)],
    "f4e36aa6": [(0, -5, 24), (60, 0, 24), (120, 0, 24), (180, 0, 24), (240, -5, 24), (300, -25, 24)],
    "453f34b1": [(0, -5, 24), (60, -20, 24), (120, -10, 24), (180, -5, 24), (240, -25, 24), (300, -30, 24)],
    "f4c34f0d": [(0, -5, 24), (60, -10, 24), (120, -5, 24), (180, -5, 24), (240, -25, 24), (300, -5, 24)],
}


def jpeg_uri(im: Image.Image, q: int = 78) -> str:
    b = io.BytesIO()
    im.save(b, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scenes", required=True)
    ap.add_argument("--view-w", type=int, default=720)
    ap.add_argument("--crop-w", type=int, default=560)
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    scenes = [s.split(":") for s in a.scenes.split(",")]
    page = []
    total = 0
    for id8, label in scenes:
        sw = ex.by_id8(id8)
        sources = {"Matterport preview (512 px)": {n: sw.preview_face(n).astype(np.float32) for n in range(6)}, "Rejected live master (t3)": t3_faces(id8)}
        for c, name in (("A", "Candidate A — preview upscaled"), ("B", "Candidate B — flow-warped to preview"), ("C", "Candidate C — multi-view depth render")):
            sources[name] = render_faces(Path(a.render), id8, c)
        sources = {k: v for k, v in sources.items() if v is not None}
        names = list(sources)
        blocks = []
        for kind, views, w in (("view", VIEWS, a.view_w), ("100 % crop", CROPS.get(id8, VIEWS[:6]), a.crop_w)):
            for yaw, pitch, hfov in views:
                h = int(w * 2 / 3)
                uris = []
                for name in names:
                    im = view(sources[name], yaw, pitch, hfov, w, h)
                    u = jpeg_uri(im)
                    total += len(u)
                    uris.append(u)
                blocks.append({"kind": kind, "yaw": yaw, "pitch": pitch, "hfov": hfov, "w": w, "h": h, "uris": uris})
        page.append({"id": id8, "label": label, "names": names, "blocks": blocks})
        print(id8, label, len(names), "sources,", len(blocks), "blocks, running size", round(total / 1e6, 1), "MB", flush=True)
    data = json.dumps(page)
    html = f"""<title>Kaldapealse reconstruction review</title>
<meta name="robots" content="noindex,nofollow">
<style>
:root{{--bg:#111;--fg:#eee;--mut:#999;--acc:#6cf}}
body{{background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,system-ui,sans-serif;margin:0;padding:16px 20px}}
h1{{font-size:18px;margin:0 0 4px}} h2{{font-size:16px;margin:24px 0 8px;color:var(--acc)}}
.bar{{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px}} .bar button{{background:#222;color:var(--fg);border:1px solid #444;padding:6px 10px;border-radius:4px;cursor:pointer}}
.bar button.on{{background:#356;border-color:var(--acc)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px}}
.cell{{background:#181818;border:1px solid #2a2a2a;border-radius:6px;padding:6px}}
.cell img{{width:100%;display:block;cursor:pointer;image-rendering:auto}} .cap{{color:var(--mut);font-size:12px;margin-top:4px}}
.tag{{display:inline-block;background:#234;color:#9cf;padding:1px 6px;border-radius:3px;margin-right:6px}}
p.note{{color:var(--mut);max-width:900px}}
</style>
<h1>Kaldapealse tänav 2 — three-scene reconstruction review (r1, private)</h1>
<p class="note">Same yaw, pitch and field of view for every source. Use the buttons to switch the source for a whole scene, or click an image to flicker it against the previous source (click again to go back). "100 % crop" panels are at the native 3072-px cube resolution; the preview and Candidate A cannot resolve more than the 512-px cube they come from.</p>
<div id="root"></div>
<script>
const DATA={data};
const root=document.getElementById('root');
DATA.forEach((sc,si)=>{{
  const h=document.createElement('h2');h.textContent=sc.label+' ('+sc.id+')';root.appendChild(h);
  const bar=document.createElement('div');bar.className='bar';
  sc.names.forEach((n,ni)=>{{const b=document.createElement('button');b.textContent=n;b.dataset.s=si;b.dataset.n=ni;if(ni===sc.names.length-1)b.classList.add('on');b.onclick=()=>setSource(si,ni);bar.appendChild(b);}});
  root.appendChild(bar);
  const grid=document.createElement('div');grid.className='grid';grid.id='g'+si;
  sc.blocks.forEach((bl,bi)=>{{const c=document.createElement('div');c.className='cell';
    const img=document.createElement('img');img.id='i'+si+'_'+bi;img.dataset.cur=sc.names.length-1;img.dataset.prev=sc.names.length-2;img.src=bl.uris[sc.names.length-1];
    img.onclick=()=>{{const cur=+img.dataset.cur,prev=+img.dataset.prev;img.src=bl.uris[prev];img.dataset.cur=prev;img.dataset.prev=cur;cap.innerHTML=capText(sc,bl,prev);}};
    const cap=document.createElement('div');cap.className='cap';cap.innerHTML=capText(sc,bl,sc.names.length-1);
    c.appendChild(img);c.appendChild(cap);grid.appendChild(c);}});
  root.appendChild(grid);
}});
function capText(sc,bl,ni){{return '<span class="tag">'+bl.kind+'</span>yaw '+bl.yaw+'° pitch '+bl.pitch+'° hfov '+bl.hfov+'° — <b>'+sc.names[ni]+'</b>';}}
function setSource(si,ni){{const sc=DATA[si];document.querySelectorAll('#root .bar button[data-s="'+si+'"]').forEach(b=>b.classList.toggle('on',+b.dataset.n===ni));
  sc.blocks.forEach((bl,bi)=>{{const img=document.getElementById('i'+si+'_'+bi);img.dataset.prev=img.dataset.cur;img.dataset.cur=ni;img.src=bl.uris[ni];img.nextSibling.innerHTML=capText(sc,bl,ni);}});}}
</script>
"""
    (out / "review.html").write_text(html)
    print("wrote", out / "review.html", round(len(html) / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
