"""Schema-less protobuf wire reader that never guesses: bytes stay bytes until the caller descends.

The Capture export mixes real sub-messages with raw float/uint16 blobs, so a parser that speculatively descends
into every length-delimited field mis-reads 36-byte point records as messages. Every decoder in this package
names the fields it descends into.
"""
from __future__ import annotations

import struct
from typing import Iterator

Field = tuple[int, str, object]  # (number, wire kind 'v'|'d'|'f'|'b', value)


def varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        if i >= len(b) or s > 63:
            raise ValueError("bad varint")
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if not c & 0x80:
            return r, i


def wire(b: bytes) -> list[Field]:
    i, out = 0, []
    while i < len(b):
        key, i = varint(b, i)
        f, wt = key >> 3, key & 7
        if wt == 0:
            v, i = varint(b, i)
            out.append((f, "v", v))
        elif wt == 1:
            out.append((f, "d", struct.unpack("<d", b[i : i + 8])[0]))
            i += 8
        elif wt == 5:
            out.append((f, "f", struct.unpack("<f", b[i : i + 4])[0]))
            i += 4
        elif wt == 2:
            n, i = varint(b, i)
            if i + n > len(b):
                raise ValueError("truncated length-delimited field")
            out.append((f, "b", b[i : i + n]))
            i += n
        else:
            raise ValueError(f"unsupported wire type {wt} at {i}")
    return out


def get(msg: list[Field], f: int) -> list:
    return [v for ff, _, v in msg if ff == f]


def first(msg: list[Field], f: int, default=None):
    for ff, _, v in msg:
        if ff == f:
            return v
    return default


def floats(msg: list[Field]) -> list[float]:
    return [v for _, t, v in msg if t in ("f", "d")]


def sub(b: bytes) -> list[Field]:
    return wire(b)


def iter_msgs(msg: list[Field], f: int) -> Iterator[list[Field]]:
    for ff, t, v in msg:
        if ff == f and t == "b":
            yield wire(v)
