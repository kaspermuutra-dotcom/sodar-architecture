"""AI fill provider — GPT Image 2 completes what the capture could not cover.

A single-ring phone capture leaves the zenith and nadir bands black and can
carry ghosting along seams. This provider hands the stitched panorama plus its
coverage mask to an image-edit model and asks for the missing sky/ceiling and
floor to be painted in *consistently with the room*, nothing else.

Backends (chosen by ``SODAR_AI_FILL_BACKEND``, default: first configured):
  * ``openai``     — OpenAI Images *edit* endpoint with an alpha mask;
                     needs ``OPENAI_API_KEY``; model ``SODAR_GPT_IMAGE_MODEL``
                     (default ``gpt-image-2``)
  * ``higgsfield`` — the ``higgsfield`` CLI (``generate create gpt_image_2``);
                     needs a logged-in CLI; prompt-driven, no mask
  * ``none``       — copies the input through untouched (offline runs)

Execution mode: ``network`` (or ``offline-deterministic`` for ``none``).
Input contract: ``input/panorama.jpg|png`` and optional ``input/panorama-mask.png``
(white = uncovered).
"""

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

from sodar.providers.base import (
    ArtifactRef,
    Provider,
    ProviderInput,
    ProviderResult,
    ValidationResult,
    artifact_ref,
    contained_path,
    write_json_deterministic,
    write_output_manifest,
)

OUTPUT_FILE = "panorama-filled.png"
METADATA_FILE = "ai_fill_metadata.json"
ADAPTER_VERSION = "0.1.0"
PROMPT = (
    "This is an equirectangular 360° panorama of a real room captured with a phone. "
    "Fill only the transparent/black regions (the ceiling band at the top and the floor band at the bottom, "
    "and any thin gaps) so the panorama becomes a complete, seamless 2:1 equirectangular sphere. "
    "Continue the existing ceiling, walls and floor exactly — same materials, lighting and perspective, "
    "correct equirectangular distortion near the poles. Do not add furniture, people, text or objects. "
    "Keep every existing pixel unchanged."
)


def _find_input(request: ProviderInput) -> tuple[str | None, str | None]:
    pano = next((p for p in request.declared_inputs if p.startswith("input/panorama") and not p.endswith("-mask.png")), None)
    mask = next((p for p in request.declared_inputs if p.endswith("-mask.png")), None)
    return pano, mask


def backend() -> str:
    forced = os.environ.get("SODAR_AI_FILL_BACKEND")
    if forced:
        return forced
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if shutil.which("higgsfield"):
        return "higgsfield"
    return "none"


def _openai_fill(pano: Path, mask: Path | None, out: Path, log: dict[str, Any]) -> None:
    from PIL import Image  # noqa: PLC0415

    model = os.environ.get("SODAR_GPT_IMAGE_MODEL", "gpt-image-2")
    im = Image.open(pano).convert("RGBA")
    # The edit endpoint wants a supported size; 1536×1024 holds a 1536×768 strip with padding bands
    # that we mark editable, which is exactly where the missing zenith/nadir belong.
    strip = im.resize((1536, 768), Image.LANCZOS)
    canvas = Image.new("RGBA", (1536, 1024), (0, 0, 0, 255))
    canvas.paste(strip, (0, 128))
    alpha = Image.new("L", (1536, 1024), 255)
    from PIL import ImageDraw  # noqa: PLC0415

    d = ImageDraw.Draw(alpha)
    d.rectangle([0, 0, 1536, 128], fill=0)
    d.rectangle([0, 896, 1536, 1024], fill=0)
    if mask is not None:
        m = Image.open(mask).convert("L").resize((1536, 768), Image.NEAREST)
        inv = m.point(lambda v: 0 if v > 127 else 255)
        alpha.paste(inv, (0, 128), inv.point(lambda v: 255 - v))
    mask_img = Image.new("RGBA", (1536, 1024), (0, 0, 0, 0))
    mask_img.putalpha(alpha)

    def png(imx: Image.Image) -> bytes:
        b = io.BytesIO()
        imx.save(b, "PNG")
        return b.getvalue()

    boundary = "----sodar" + os.urandom(8).hex()
    fields = {"model": model, "prompt": PROMPT, "size": "1536x1024", "quality": os.environ.get("SODAR_GPT_IMAGE_QUALITY", "medium")}
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for name, data in (("image", png(canvas)), ("mask", png(mask_img))):
        body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}.png\"\r\nContent-Type: image/png\r\n\r\n".encode())
        body.write(data)
        body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/edits",
        data=body.getvalue(),
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        payload = json.loads(resp.read())
    b64 = payload["data"][0]["b64_json"]
    result = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    log["model"] = model
    log["response_size"] = list(result.size)
    # Crop the strip back out but keep the painted bands: map 1536×1024 → full sphere by
    # treating the padded canvas as covering ±90°: the strip covered ±67.5°, bands the rest.
    result.resize((im.width, im.width // 2), Image.LANCZOS).save(out, "PNG")


def _higgsfield_fill(pano: Path, out: Path, log: dict[str, Any]) -> None:
    cmd = ["higgsfield", "generate", "create", "gpt_image_2", "--image", str(pano), "--prompt", PROMPT, "--aspect_ratio", "21:9", "--resolution", "2k", "--wait", "--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "higgsfield failed")
    data = json.loads(proc.stdout)
    text = json.dumps(data)
    import re  # noqa: PLC0415

    m = re.search(r"https?://[^\"\s]+\.(?:png|jpg|jpeg|webp)", text)
    if not m:
        raise RuntimeError("no result url in higgsfield output")
    with urllib.request.urlopen(m.group(0), timeout=120) as resp:
        out.write_bytes(resp.read())
    log["model"] = "gpt_image_2 (higgsfield)"
    log["result_url"] = m.group(0)


class AIFillProvider(Provider):
    id = "ai-fill"
    description = "GPT Image 2 fills the uncovered zenith/nadir bands and seams of a stitched panorama (OpenAI or Higgsfield backend)"

    def validate(self, request: ProviderInput) -> ValidationResult:
        pano, _ = _find_input(request)
        if pano is None:
            return ValidationResult.failed("fixture must declare input/panorama.jpg or .png")
        try:
            contained_path(request.fixture_root, pano)
        except Exception as exc:
            return ValidationResult.failed(str(exc))
        b = backend()
        if b == "openai" and not os.environ.get("OPENAI_API_KEY"):
            return ValidationResult.failed("OPENAI_API_KEY is not set")
        if b == "higgsfield" and not shutil.which("higgsfield"):
            return ValidationResult.failed("higgsfield CLI is not on PATH (or not logged in)")
        return ValidationResult.passed()

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        started = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)
        pano_rel, mask_rel = _find_input(request)
        pano = contained_path(request.fixture_root, pano_rel or "")
        mask = contained_path(request.fixture_root, mask_rel) if mask_rel else None
        out = output_dir / OUTPUT_FILE
        b = backend()
        log: dict[str, Any] = {"backend": b, "adapter_version": ADAPTER_VERSION}
        try:
            if b == "openai":
                _openai_fill(pano, mask, out, log)
            elif b == "higgsfield":
                _higgsfield_fill(pano, out, log)
            else:
                from PIL import Image  # noqa: PLC0415

                Image.open(pano).convert("RGB").save(out, "PNG")
                log["note"] = "no backend configured; panorama copied through unchanged"
        except Exception as exc:
            return ProviderResult(provider_id=self.id, success=False, errors=(f"ai fill failed ({b}): {exc}",), provider_metadata={"execution_mode": "network", **log})
        write_json_deterministic(output_dir / METADATA_FILE, log)
        artifacts = [artifact_ref(output_dir, OUTPUT_FILE), artifact_ref(output_dir, METADATA_FILE)]
        artifacts.append(write_output_manifest(output_dir, artifacts))
        return ProviderResult(
            provider_id=self.id,
            success=True,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=0.0 if b == "none" else 0.04,
            provider_metadata={"execution_mode": "offline-deterministic" if b == "none" else "network", "deterministic": b == "none", **log},
        )
