"""2D geometry on the floor plane (x, z) in meters. Pure functions, no I/O."""
import math
from typing import Iterable, List, Optional, Sequence, Tuple

Vec2 = Tuple[float, float]

FT_TO_M = 0.3048
DEFAULT_NORMALIZED_SIZE_M = 10.0


def plan_scale(plan: dict) -> float:
    """Plan-unit → meter factor k (same rule as web/src/lib/units.ts planScale)."""
    units = plan.get("units") or "ft"
    if units == "m":
        return 1.0
    if units == "ft":
        return FT_TO_M
    longer = max(float(plan.get("width") or 1.0), float(plan.get("height") or 1.0))
    return DEFAULT_NORMALIZED_SIZE_M / longer


def polygon_area(points: Sequence[Vec2]) -> float:
    if len(points) < 3:
        return 0.0
    s = 0.0
    for i, (x1, z1) in enumerate(points):
        x2, z2 = points[(i + 1) % len(points)]
        s += x1 * z2 - x2 * z1
    return abs(s) / 2.0


def polygon_centroid(points: Sequence[Vec2]) -> Vec2:
    if not points:
        return (0.0, 0.0)
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def point_in_polygon(pt: Vec2, points: Sequence[Vec2]) -> bool:
    x, z = pt
    inside = False
    n = len(points)
    for i in range(n):
        x1, z1 = points[i]
        x2, z2 = points[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xi = x1 + (z - z1) * (x2 - x1) / ((z2 - z1) or 1e-12)
            if x < xi:
                inside = not inside
    return inside


def closest_point_on_segment(p: Vec2, a: Vec2, b: Vec2) -> Tuple[Vec2, float]:
    """Closest point on segment ab to p and its parameter t in [0, 1]."""
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    if l2 == 0:
        return a, 0.0
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2))
    return (ax + t * dx, az + t * dz), t


def distance_to_segment(p: Vec2, a: Vec2, b: Vec2) -> float:
    c, _ = closest_point_on_segment(p, a, b)
    return math.hypot(p[0] - c[0], p[1] - c[1])


def nearest_wall_direction(p: Vec2, walls: Iterable[Tuple[Vec2, Vec2]]) -> Optional[Tuple[Vec2, float]]:
    """Unit vector from p toward the nearest wall segment, and the distance; None without walls."""
    best: Optional[Tuple[Vec2, float]] = None
    for a, b in walls:
        c, _ = closest_point_on_segment(p, a, b)
        d = math.hypot(c[0] - p[0], c[1] - p[1])
        if best is None or d < best[1]:
            if d < 1e-9:
                continue
            best = (((c[0] - p[0]) / d, (c[1] - p[1]) / d), d)
    return best


def ray_segment_distance(origin: Vec2, direction: Vec2, a: Vec2, b: Vec2) -> Optional[float]:
    """Distance along the unit ray origin + t·direction (t ≥ 0) to segment ab; None when it misses."""
    ex, ez = b[0] - a[0], b[1] - a[1]
    denom = direction[0] * ez - direction[1] * ex
    if abs(denom) < 1e-12:
        return None  # parallel
    ox, oz = a[0] - origin[0], a[1] - origin[1]
    t = (ox * ez - oz * ex) / denom
    u = (ox * direction[1] - oz * direction[0]) / denom
    if t < 0 or u < -1e-9 or u > 1 + 1e-9:
        return None
    return t


def front_vector(rotation_y: float) -> Vec2:
    """Scene direction (x, z) of a model's local +Z after a yaw of rotation_y (three.js convention)."""
    return (math.sin(rotation_y), math.cos(rotation_y))


def obb_corners(center: Vec2, w: float, d: float, rotation_y: float) -> List[Vec2]:
    """Footprint corners of a box of size w (local x) by d (local z) rotated by rotation_y about Y."""
    c, s = math.cos(rotation_y), math.sin(rotation_y)
    out = []
    for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        # three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos
        out.append((center[0] + lx * c + lz * s, center[1] - lx * s + lz * c))
    return out


def _project(corners: Sequence[Vec2], axis: Vec2) -> Tuple[float, float]:
    vals = [x * axis[0] + z * axis[1] for x, z in corners]
    return min(vals), max(vals)


def obb_overlap(a: Sequence[Vec2], b: Sequence[Vec2], tolerance: float = 0.02) -> bool:
    """Separating-axis test for two convex quads; touching within `tolerance` meters is not an overlap."""
    for poly in (a, b):
        for i in range(len(poly)):
            x1, z1 = poly[i]
            x2, z2 = poly[(i + 1) % len(poly)]
            ex, ez = x2 - x1, z2 - z1
            length = math.hypot(ex, ez) or 1.0
            axis = (-ez / length, ex / length)
            amin, amax = _project(a, axis)
            bmin, bmax = _project(b, axis)
            if amax - tolerance <= bmin or bmax - tolerance <= amin:
                return False
    return True


def normalize_angle(a: float) -> float:
    """Wrap to (-pi, pi]."""
    a = math.fmod(a, 2 * math.pi)
    if a <= -math.pi:
        a += 2 * math.pi
    elif a > math.pi:
        a -= 2 * math.pi
    return a
