"""The provider registry.

An explicit dict of instances. No dynamic discovery, no entry points — adding a
provider is one import and one list entry here.

Every provider module imported here must be import-safe with no optional
third-party dependency present. `opencv_stitch` imports ``cv2`` lazily, so
importing this registry (for `provider list`, or to run `dummy`) never imports
OpenCV. `psv_viewer` has no third-party Python dependency at all; its optional
asset (the vendored browser bundle) is only touched inside `validate()`/
`execute()`.
"""

from __future__ import annotations

from sodar.providers.base import Provider
from sodar.providers.dummy import DummyProvider
from sodar.providers.opencv_stitch import OpenCVStitchProvider
from sodar.providers.psv_viewer import PhotoSphereViewerProvider
from sodar.providers.posed_stitch import PosedStitchProvider
from sodar.providers.ai_fill import AIFillProvider

_REGISTERED: tuple[Provider, ...] = (
    DummyProvider(),
    OpenCVStitchProvider(),
    PhotoSphereViewerProvider(),
    PosedStitchProvider(),
    AIFillProvider(),
)

_BY_ID: dict[str, Provider] = {p.id: p for p in _REGISTERED}


def list_providers() -> list[Provider]:
    return sorted(_BY_ID.values(), key=lambda p: p.id)


def get_provider(provider_id: str) -> Provider | None:
    return _BY_ID.get(provider_id)
