"""Pure cell geometry for the adaptive grid crawl (DESIGN.md §7.2)."""

import math
from dataclasses import dataclass

M_PER_DEG_LAT = 111_200.0
TARGET_PER_CELL = 12  # aim children well under the 20 cap so most finish in one call
# Max rows/cols per split. Density isn't uniform (Metrotown is a dense blob in a residential
# area), so a big jump wastes calls on empty edges; 8 turned one cell into 56 mostly-empty ones.
MAX_SPLIT = 3


@dataclass(frozen=True)
class BBox:
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float


# (south-west corner, north-east corner)
BBOXES = {
    "test": BBox(49.222, -123.012, 49.232, -122.992),  # ~1.1 x 1.5 km around Metrotown
    "city": BBox(49.198, -123.225, 49.317, -123.023),  # City of Vancouver
    "vanburnaby": BBox(49.180, -123.225, 49.317, -122.890),  # Vancouver + Burnaby
    "metro": BBox(49.100, -123.270, 49.380, -122.850),  # + Richmond, North Van
}


@dataclass(frozen=True)
class Cell:
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float
    depth: int = 0

    @property
    def center(self) -> tuple[float, float]:
        return ((self.min_lat + self.max_lat) / 2, (self.min_lng + self.max_lng) / 2)

    @property
    def corners(self) -> list[tuple[float, float]]:
        return [
            (self.min_lat, self.min_lng),
            (self.min_lat, self.max_lng),
            (self.max_lat, self.min_lng),
            (self.max_lat, self.max_lng),
        ]


def m_per_deg_lng(lat: float) -> float:
    return M_PER_DEG_LAT * math.cos(math.radians(lat))


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Equirectangular distance; accurate to well under 1% at city scale."""
    dy = (b[0] - a[0]) * M_PER_DEG_LAT
    dx = (b[1] - a[1]) * m_per_deg_lng((a[0] + b[0]) / 2)
    return math.hypot(dx, dy)


def cell_size_m(cell: Cell) -> tuple[float, float]:
    """(height, width) in metres."""
    lat, _ = cell.center
    return (
        (cell.max_lat - cell.min_lat) * M_PER_DEG_LAT,
        (cell.max_lng - cell.min_lng) * m_per_deg_lng(lat),
    )


def cell_radius_m(cell: Cell) -> float:
    """Half the cell's diagonal, so the search circle covers the whole square."""
    h, w = cell_size_m(cell)
    return math.hypot(h, w) / 2


def tile_bbox(bbox: BBox, cell_m: float) -> list[Cell]:
    """Cover bbox with ~cell_m squares; the last row/column is clipped to the bbox edge."""
    dlat = cell_m / M_PER_DEG_LAT
    dlng = cell_m / m_per_deg_lng((bbox.min_lat + bbox.max_lat) / 2)
    cells: list[Cell] = []
    lat = bbox.min_lat
    while lat < bbox.max_lat:
        top = min(lat + dlat, bbox.max_lat)
        lng = bbox.min_lng
        while lng < bbox.max_lng:
            right = min(lng + dlng, bbox.max_lng)
            cells.append(Cell(lat, lng, top, right))
            lng = right
        lat = top
    return cells


def split_dims(
    cell: Cell, covered_m: float, found: int, min_radius_m: float
) -> tuple[int, int] | None:
    """Rows/cols to split a saturated cell into, or None if it can't go smaller.

    Results are nearest-first, so `found` places within `covered_m` gives a density of
    found / (pi * covered_m^2). A square child of side s is searched with a circle of area
    pi * s^2 / 2, so expecting TARGET_PER_CELL per child means s = covered_m * sqrt(2T / found).
    Jumping straight to that size skips the intermediate levels a fixed 2x2 split would pay for.
    """
    h, w = cell_size_m(cell)
    min_side = min_radius_m * math.sqrt(2)
    if max(h, w) / 2 < min_side:
        return None
    side = max(covered_m * math.sqrt(2 * TARGET_PER_CELL / found), min_side)
    # ceil for the target size, but never so many that a child drops below min_side
    rows = min(MAX_SPLIT, max(1, math.floor(h / min_side)), max(1, math.ceil(h / side)))
    cols = min(MAX_SPLIT, max(1, math.floor(w / min_side)), max(1, math.ceil(w / side)))
    if rows * cols == 1:
        rows, cols = (2, 1) if h >= w else (1, 2)
    return rows, cols


def split_cell(cell: Cell, rows: int = 2, cols: int = 2) -> list[Cell]:
    """rows x cols equal children, one level deeper."""
    dlat = (cell.max_lat - cell.min_lat) / rows
    dlng = (cell.max_lng - cell.min_lng) / cols
    d = cell.depth + 1
    return [
        Cell(
            cell.min_lat + r * dlat,
            cell.min_lng + c * dlng,
            cell.max_lat if r == rows - 1 else cell.min_lat + (r + 1) * dlat,
            cell.max_lng if c == cols - 1 else cell.min_lng + (c + 1) * dlng,
            d,
        )
        for r in range(rows)
        for c in range(cols)
    ]


def inside_disk(cell: Cell, center: tuple[float, float], radius_m: float) -> bool:
    """True if the whole cell lies within radius_m of center."""
    return all(distance_m(center, corner) <= radius_m for corner in cell.corners)
