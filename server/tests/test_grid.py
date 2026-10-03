import math
from pathlib import Path

from munch.ingest.grid import (
    MAX_SPLIT,
    BBox,
    Cell,
    cell_radius_m,
    cell_size_m,
    inside_disk,
    split_cell,
    split_dims,
    tile_bbox,
)
from munch.ingest.state import load_pending, save_pending

BOX = BBox(49.20, -123.20, 49.30, -123.00)


def test_tile_covers_bbox_exactly() -> None:
    cells = tile_bbox(BOX, 1500)
    assert min(c.min_lat for c in cells) == BOX.min_lat
    assert max(c.max_lat for c in cells) == BOX.max_lat
    assert min(c.min_lng for c in cells) == BOX.min_lng
    assert max(c.max_lng for c in cells) == BOX.max_lng
    # ~11.1 km tall, ~14.5 km wide -> 8 rows x 10 cols with clipped edges
    assert len(cells) == 8 * 10


def test_split_into_quadrants() -> None:
    cell = Cell(49.0, -123.0, 49.02, -122.98)
    kids = split_cell(cell)
    assert len(kids) == 4
    assert all(k.depth == 1 for k in kids)
    corners = {(round(k.min_lat, 6), round(k.min_lng, 6)) for k in kids}
    assert corners == {(49.0, -123.0), (49.0, -122.99), (49.01, -123.0), (49.01, -122.99)}
    assert max(k.max_lat for k in kids) == cell.max_lat
    assert max(k.max_lng for k in kids) == cell.max_lng


def test_split_grid_tiles_parent() -> None:
    cell = Cell(49.0, -123.0, 49.03, -122.97)
    kids = split_cell(cell, 3, 5)
    assert len(kids) == 15
    area = sum((k.max_lat - k.min_lat) * (k.max_lng - k.min_lng) for k in kids)
    assert math.isclose(area, 0.03 * 0.03)


def test_radius_covers_square_and_halves_on_split() -> None:
    cell = tile_bbox(BOX, 1000)[0]
    r = cell_radius_m(cell)
    assert math.isclose(r, 1000 * math.sqrt(2) / 2, rel_tol=0.01)
    assert math.isclose(cell_radius_m(split_cell(cell)[0]), r / 2, rel_tol=0.01)


def test_split_dims_scales_with_density() -> None:
    cell = tile_bbox(BOX, 1500)[0]
    # 20 places within 900 m: barely saturated, a coarse split is enough
    sparse = split_dims(cell, 900, 20, 75)
    # 20 places within 150 m (downtown): jump straight to a fine grid
    dense = split_dims(cell, 150, 20, 75)
    assert sparse is not None and dense is not None
    assert sparse[0] * sparse[1] <= 4
    assert dense == (MAX_SPLIT, MAX_SPLIT)


def test_split_dims_respects_min_radius() -> None:
    tiny = tile_bbox(BOX, 150)[0]
    assert split_dims(tiny, 10, 20, 75) is None
    dims = split_dims(tile_bbox(BOX, 600)[0], 1, 20, 75)
    assert dims is not None
    kid = split_cell(tile_bbox(BOX, 600)[0], *dims)[0]
    h, w = cell_size_m(kid)
    assert min(h, w) >= 75 * math.sqrt(2) - 0.01


def test_inside_disk() -> None:
    cell = Cell(49.0, -123.0, 49.001, -122.999)  # ~111 x 73 m
    assert inside_disk(cell, cell.center, 100)
    assert not inside_disk(cell, cell.center, 30)


def test_state_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    cells = [Cell(49.0, -123.0, 49.1, -122.9, 2)]
    save_pending(path, "city", cells)
    assert load_pending(path, "city") == cells
    assert load_pending(path, "metro") is None
