"""Best-effort bounding box of a GLB (binary glTF 2.0) from accessor min/max and node transforms."""
import json
import math
import struct
from typing import Dict, List, Optional

Matrix = List[float]  # column-major 4x4

IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def _mul(a: Matrix, b: Matrix) -> Matrix:
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def _trs(node: dict) -> Matrix:
    if "matrix" in node:
        return [float(v) for v in node["matrix"]]
    tx, ty, tz = node.get("translation", [0, 0, 0])
    qx, qy, qz, qw = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    r = [
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
        2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
        2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
        0, 0, 0, 1,
    ]
    s = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]
    t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
    return _mul(t, _mul(r, s))


def _apply(m: Matrix, p: List[float]) -> List[float]:
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


def glb_dims(data: bytes) -> Optional[Dict[str, float]]:
    """{w, d, h} of the scene bbox (x, z, y), or None when it cannot be determined."""
    try:
        magic, _version, _length = struct.unpack_from("<4sII", data, 0)
        if magic != b"glTF":
            return None
        chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
        if chunk_type != 0x4E4F534A:  # JSON
            return None
        gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    except Exception:
        return None

    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])
    lo = [math.inf] * 3
    hi = [-math.inf] * 3

    def visit(idx: int, parent: Matrix, depth: int = 0) -> None:
        if depth > 64 or idx >= len(nodes):
            return
        node = nodes[idx]
        world = _mul(parent, _trs(node))
        if "mesh" in node and node["mesh"] < len(meshes):
            for prim in meshes[node["mesh"]].get("primitives", []):
                acc_idx = prim.get("attributes", {}).get("POSITION")
                if acc_idx is None or acc_idx >= len(accessors):
                    continue
                acc = accessors[acc_idx]
                mn, mx = acc.get("min"), acc.get("max")
                if not mn or not mx:
                    continue
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]):
                            p = _apply(world, [cx, cy, cz])
                            for i in range(3):
                                lo[i] = min(lo[i], p[i])
                                hi[i] = max(hi[i], p[i])
        for child in node.get("children", []):
            visit(child, world, depth + 1)

    scenes = gltf.get("scenes") or [{"nodes": list(range(len(nodes)))}]
    scene = scenes[gltf.get("scene", 0)] if gltf.get("scene", 0) < len(scenes) else scenes[0]
    for root in scene.get("nodes", []):
        visit(root, IDENTITY)
    if not all(math.isfinite(v) for v in lo + hi):
        return None
    w, h, d = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
    if min(w, h, d) <= 0:
        return None
    return {"w": round(w, 3), "d": round(d, 3), "h": round(h, 3)}
