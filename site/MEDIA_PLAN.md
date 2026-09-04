# Sodar site — media plan (Higgsfield)

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
