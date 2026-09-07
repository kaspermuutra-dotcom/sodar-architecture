# Sodar site — media plan (Higgsfield)

**Status 2026-09-07:** every loop on the site is now grounded in Põhja-Tallinn. Seven
stills were generated with Higgsfield `soul_location` (Noblessner harbour, Kalaranna
port cranes, a Kalamaja street, and three apartment interiors whose windows look onto
the Port of Tallinn under overcast Baltic light), and one Kling 3.0 image-to-video dolly
was generated from the loft still. ffmpeg then produced (all silent H.264, faststart):

| Asset | Source | Motion |
|---|---|---|
| `hero-scan-loop.mp4` (960×540, 10 s) | Kling dolly | palindromic loop |
| `scans-window.mp4` (720×960) | Kling dolly, window crop | palindromic loop |
| `scans-orbit.mp4` (720×960) | Kalamaja bedroom still | slow push-in and back (zoompan) |
| `pipeline-capture.mp4` (540×960) | wide loft still | lateral pan there-and-back, like a panorama sweep |
| `intro.mp4` (1280×720, 44 s) | deck film | `node deck/export/render.mjs --file` |

Posters sit next to each clip with the same basename (`.jpg`); `scans-kitchen.jpg`,
`scans-street.jpg`, `loft-wide.jpg`, `kitchen-harbour.jpg`, `tallinn-harbour.jpg` and
`tallinn-street.jpg` are the remaining stills. The deck film's establishing shot is
`deck/media/tallinn-harbour.jpg`; its viewer scenes play `deck/media/walkthrough-loft.mp4`.

Prompt anchor used for every still (keep it for future shots):

> Documentary / listing photograph, Põhja-Tallinn (Noblessner · Kalaranna · Kalamaja),
> overcast Baltic light, Port of Tallinn cranes, ferry and container ship in view,
> muted grey-blue and rust palette, 24–35 mm, no people, no text, realistic and
> unretouched.


## Photographs (Unsplash, September 2026)

Every still on the site that is not one of the Tallinn shots above is a licensed
photograph from Unsplash (Unsplash License: free for commercial use, no attribution
required; credits kept here anyway). Selected for Northern-European apartments and
houses — Copenhagen, Stockholm, Helsinki, Oslo and comparable — and for looking like
real listing photography rather than renders. `public/media/rooms/tile-01…32.jpg` are the
hero wall; `rooms/{living,kitchen,bedroom,bathroom,study,balcony,publish,crm-1..3}.jpg`
are the demo stills; `blog-1..4.jpg` the field-notes covers. `scans-villa.jpg` is the one
remaining Higgsfield still (a Pirita villa exterior).

| # | Photographer | Source |
|---|---|---|
| 9 | Med Badr  Chemmaoui | https://unsplash.com/photos/xtDpXi_a-YQ |
| 22 | Yevhenii Deshko | https://unsplash.com/photos/fobX0HI9vVo |
| 30 | Yevhenii Deshko | https://unsplash.com/photos/shT_LaGUmYI |
| 45 | Yevhenii Deshko | https://unsplash.com/photos/1M9iX5E97rw |
| 53 | Caroline Badran | https://unsplash.com/photos/8FIqK2J7jSc |
| 60 | Stephan Louis | https://unsplash.com/photos/H7TiI5zmkrk |
| 61 | Hans | https://unsplash.com/photos/i6DvrmPmvnM |
| 64 | amira aldia amal | https://unsplash.com/photos/pyo3gzTa-qM |
| 66 | Clay Banks | https://unsplash.com/photos/1C0P1XmRUXE |
| 74 | Antoine Gravier | https://unsplash.com/photos/ndzN00BH9mg |
| 77 | Yevhenii Deshko | https://unsplash.com/photos/CRfiYSv-CBw |
| 78 | Alex Tyson | https://unsplash.com/photos/c3PWqKnl59U |
| 79 | Yevhenii Deshko | https://unsplash.com/photos/3dofskLW-Yc |
| 81 | Alex Tyson | https://unsplash.com/photos/1L2J8TnVod8 |
| 88 | Roberta Sant'Anna | https://unsplash.com/photos/9u5vBs24WLs |
| 94 | Yevhenii Deshko | https://unsplash.com/photos/0F2iyKjY244 |
| 101 | Danilo Rios | https://unsplash.com/photos/AgK_XAqSbfk |
| 117 | Yevhenii Deshko | https://unsplash.com/photos/wYbFqn7kUao |
| 121 | Yevhenii Deshko | https://unsplash.com/photos/Hf2OZrNNS08 |
| 139 | Natalia Blauth | https://unsplash.com/photos/Ms3HdpgkY8I |
| 140 | Lisa Anna | https://unsplash.com/photos/FY-ZmRHPeLw |
| 142 | Alex Tyson | https://unsplash.com/photos/ZcGjMfYOprY |
| 154 | Clay Banks | https://unsplash.com/photos/2ed7zL_CMbU |
| 162 | Alex Tyson | https://unsplash.com/photos/l_gGfgH0B0U |
| 173 | Lisa Anna | https://unsplash.com/photos/mk3AYC_hleo |
| 174 | Alex Tyson | https://unsplash.com/photos/z1orsBp9yfY |
| 176 | Lisa Anna | https://unsplash.com/photos/jw95UZrsFGw |
| 180 | Lisa Anna | https://unsplash.com/photos/guAhg5NB3RA |
| 185 | Alex Tyson | https://unsplash.com/photos/1JSXt9ERqWA |
| 186 | Clay Banks | https://unsplash.com/photos/b6Bs19onFtY |
| 187 | Jack Prew | https://unsplash.com/photos/wqTCg8wn04w |
| 194 | Alex Tyson | https://unsplash.com/photos/iWqzvb6_Ca8 |
| 199 | Alex Tyson | https://unsplash.com/photos/jGUi9z-V3d0 |
| 203 | Alex Tyson | https://unsplash.com/photos/AeO1mcqcslY |
| 206 | Ariel Domenden | https://unsplash.com/photos/IoBfcJdijgM |
| 207 | Ruben Hanssen | https://unsplash.com/photos/8zA5MGxbMFQ |
| 212 | Alex Tyson | https://unsplash.com/photos/QA99uavaINE |
| 218 | Alex Tyson | https://unsplash.com/photos/w111mMO_IjU |

**Status 2026-09-06:** `intro.mp4` (72 s, 1280×720) is now rendered from the pitch-deck
film with `deck/export/render.mjs`; re-run it after any change to the deck's film.

**Status 2026-09-05:** Higgsfield is now connected as an MCP connector (no CLI
login needed). Generated so far, all from `public/sodar-apartment-hero.png` as
the start frame with Kling 3.0 (5 s, std), then made palindromic 10 s loops at
960 px with ffmpeg: `hero-scan-loop.mp4` (dolly), `pipeline-capture.mp4`
(panorama pan), `scans-orbit.mp4`, `scans-window.mp4`. One GPT Image 2 still:
`kitchen-gpt-image-2.jpg`. `components/loop-video.tsx` plays each clip over its
poster still. Remaining slots below are still open.

Every generated asset has a fixed path under `public/media/`. Components already
point at these paths, so dropping a file in is the whole swap. Until then the
site uses PIL crops of `public/sodar-apartment-hero.png` as stand-ins for the
room tiles, and CSS/GSAP mocks for the video slots.

## One-time setup

```bash
higgsfield auth login                # interactive, opens the browser
higgsfield workspace list            # then:
higgsfield workspace set <workspace_id>
higgsfield account status            # must print your account, not an error
```

The CLI is installed at `~/.local/bin/higgsfield` (v1.1.24).

## Style lock (paste into every prompt)

> Photoreal interior photography, Scandinavian-modern apartment, warm natural
> daylight through large windows, neutral oak / off-white / charcoal palette,
> 24mm lens, eye level, no people, no text, no watermark, muted but not
> grayscale, editorial real-estate listing quality.

## Shot list

| # | Asset | Path | Model | Command |
|---|---|---|---|---|
| 1 | Mosaic room tiles ×45 (square) | `public/media/rooms/tile-01…45.jpg` | `gpt_image_2` | see loop below |
| 2 | Hero loop, 8 s, scan-reveal of a living room | `public/media/hero-scan-loop.mp4` | `seedance_2_0` | `higgsfield generate create seedance_2_0 --prompt "slow dolly forward through a sunlit living room into the kitchen, a thin white horizontal scan line sweeps top to bottom leaving the space fully rendered behind it, <style lock>" --start-image public/sodar-apartment-hero.png --duration 8 --resolution 1080p --aspect_ratio 16:9 --wait` |
| 3 | Pipeline B-roll — capture (phone POV, hand turning) | `public/media/pipeline-capture.mp4` | `seedance_2_0` | `--prompt "first-person phone camera slowly panning 360 degrees around a bright bedroom, subtle handheld motion, thin white reticle overlay in centre, <style lock>" --duration 6 --aspect_ratio 9:16` |
| 4 | Pipeline B-roll — preview reveal | `public/media/pipeline-preview.mp4` | `seedance_2_0` | `--prompt "two rooms of an apartment resolve from a dark grey wireframe into full photoreal render, left to right wipe, <style lock>" --duration 6` |
| 5 | Category loops ×4 (apartment, new construction, villa, rental) | `public/media/scans-{apartment,newbuild,villa,rental}.mp4` | `seedance_2_0` | `--prompt "slow orbit inside a <category> <room>, <style lock>" --duration 5 --aspect_ratio 3:4` |
| 6 | CRM embed still (listing page with a 360 viewer card) | `public/media/crm-embed.png` | `gpt_image_2` | `--prompt "clean dark-mode CRM listing page UI, three property cards, the first card shows an embedded 360 walkthrough viewer with a small circular navigation hotspot, monochrome UI, no logos" --aspect_ratio 16:9 --resolution 2k` |
| 7 | OG / social card | `public/og.png` | `gpt_image_2` | `--prompt "black background, large off-white serif headline 'AI walkthroughs that close more deals.', small letter-spaced SODAR wordmark, right side a 9 by 5 grid of small interior photographs, minimal" --aspect_ratio 16:9 --resolution 2k` |

### Tile loop (asset 1)

```bash
cd site
ROOMS=("living room" "kitchen" "primary bedroom" "bathroom" "hallway" "dining room" "study" "balcony" "guest room")
i=0
for n in $(seq 1 45); do
  room=${ROOMS[$((n % 9))]}
  higgsfield generate create gpt_image_2 \
    --prompt "$room, photoreal interior photography, Scandinavian-modern apartment, warm natural daylight, neutral oak / off-white / charcoal palette, 24mm lens, eye level, no people, no text" \
    --aspect_ratio 1:1 --resolution 1k --wait --json \
  | python3 -c "import json,sys,urllib.request; j=json.load(sys.stdin); u=(j[0] if isinstance(j,list) else j); url=(u.get('result') or u.get('results') or [u])[0] if isinstance(u.get('results'),list) else u; import re; m=re.search(r'https?://\S+\.(?:jpg|jpeg|png|webp)', json.dumps(j)); urllib.request.urlretrieve(m.group(0), 'public/media/rooms/tile-%02d.jpg' % $n)"
done
```

If the JSON shape differs, run one job with `--wait --json`, look at the
output once, and adjust the URL pick — the point is only to land the file at
`tile-NN.jpg`. Re-encode to ≤ 60 KB each afterwards
(`python3 -c "from PIL import Image; ..."` or `sips -Z 360`).

## Swapping a video slot in

`components/media-slot.tsx` renders the placeholder. Replace its body with

```tsx
<video src={src} autoPlay muted loop playsInline className="h-full w-full object-cover" />
```

and keep the `src` prop — every slot already passes its final path.
