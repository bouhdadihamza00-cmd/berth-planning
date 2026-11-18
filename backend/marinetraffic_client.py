"""MarineTraffic public map client. Default execution requests ONE Gibraltar tile."""
from __future__ import annotations
import argparse
import json
import math
import time
from typing import Any, Iterator

BASE = "https://www.marinetraffic.com"
CAPTURED_COOKIES = ""  # Loaded from a private server-side file by the adapter.
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36", "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", "Referer": BASE + "/en/ais/home/centerx:-5.350/centery:36.100/zoom:12"}

class MarineTrafficError(RuntimeError):
    """HTTP, protection, or unexpected response error."""

class MarineTrafficClient:
    """Public map access, with persistent cookies and bounded area queries."""
    def __init__(self, transport: str = "httpcloak", interval: float = 0.5, cookies=None):
        self.transport = transport
        self.interval = interval
        self._last = 0.0
        self.last_response_time = None
        if transport == "httpcloak":
            import httpcloak
            self.session = httpcloak.Session(preset="chrome-latest", timeout=30)
        elif transport == "requests":
            import requests
            self.session = requests.Session()
        else:
            raise ValueError("transport must be httpcloak or requests")
        for name, value in (cookies or {}).items():
            if transport == "requests":
                self.session.cookies.set(name, value, domain="www.marinetraffic.com", path="/")
            else:
                self.session.set_cookie(name, value, domain="www.marinetraffic.com", path="/")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self) -> None:
        self.session.close()

    def _get(self, path: str) -> Any:
        time.sleep(max(0, self.interval - (time.monotonic() - self._last)))
        self._last = time.monotonic()
        response = self.session.get(BASE + path, headers=HEADERS, timeout=30)
        if response.status_code in (401, 403):
            # No login/refresh flow was present. Attempt normal cookie renewal once.
            self.session.get(HEADERS["Referer"], headers=HEADERS, timeout=30)
            response = self.session.get(BASE + path, headers=HEADERS, timeout=30)
        if response.status_code != 200:
            raise MarineTrafficError(f"HTTP {response.status_code} for {path}; access may require renewed browser clearance. No data returned.")
        from email.utils import parsedate_to_datetime
        try:
            response_date = response.headers.get('Date') or response.headers.get('date')
            if isinstance(response_date, list):
                response_date = response_date[0]
            self.last_response_time = parsedate_to_datetime(response_date)
        except (TypeError, ValueError, IndexError):
            self.last_response_time = None
        try:
            return response.json()
        except (ValueError, TypeError) as exc:
            raise MarineTrafficError(f"Expected JSON for {path}; received a challenge or changed response") from exc

    def total_ships(self) -> int:
        """Site-wide map counter, not a vessel export."""
        return int(self._get("/getData/get_total_ships"))

    def vessel_tile(self, x: int, y: int, zoom: int = 12) -> dict[str, Any]:
        """Fetch one 512-pixel map data tile; preserve original field values."""
        if not 2 <= zoom <= 18:
            raise ValueError("zoom must be between 2 and 18; only zoom 12 was verified")
        n = 2 ** (zoom - 1)
        if not (0 <= x < n and 0 <= y < n):
            raise ValueError("tile coordinates out of range")
        data = self._get(f"/getData/get_data_json_4/z:{zoom}/X:{x}/Y:{y}/station:0")
        if not isinstance(data, dict) or not isinstance(data.get("data"), dict) or not isinstance(data["data"].get("rows"), list):
            raise MarineTrafficError("Unexpected tile schema")
        if data.get("type") != 1:
            raise MarineTrafficError("Tile is aggregated, not individual vessel data; use zoom 12")
        return data

    @staticmethod
    def tiles(west: float, south: float, east: float, north: float, zoom: int = 12) -> Iterator[tuple[int, int]]:
        """Enumerate tiles covering a box. west > east means crossing the dateline."""
        if not all(math.isfinite(v) for v in (west, south, east, north)):
            raise ValueError("coordinates must be finite")
        if not (-180 <= west <= 180 and -180 <= east <= 180 and -85.05112878 <= south <= north <= 85.05112878):
            raise ValueError("invalid Web Mercator bounds")
        if not 2 <= zoom <= 18:
            raise ValueError("invalid zoom")
        n = 2 ** (zoom - 1)
        def tx(lon):
            return min(n - 1, max(0, math.floor((lon + 180) / 360 * n)))
        def ty(lat):
            return min(n - 1, max(0, math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)))
        segments = [(west, east)] if west <= east else [(west, 180), (-180, east)]
        for left, right in segments:
            for x in range(tx(left), tx(right) + 1):
                for y in range(ty(north), ty(south) + 1):
                    yield x, y

    def vessels_in_bbox(self, west: float, south: float, east: float, north: float,
                        zoom: int = 12, max_tiles: int = 64) -> list[dict[str, Any]]:
        """Filter actual positions to bounds and deduplicate by SHIP_ID.

        The entire request budget is checked before making any HTTP call.
        """
        count = sum(1 for _ in self.tiles(west, south, east, north, zoom))
        if count > max_tiles:
            raise ValueError(f"Area needs {count} tiles; max_tiles={max_tiles}. Split the area or explicitly increase the budget.")
        ships = {}
        for x, y in self.tiles(west, south, east, north, zoom):
            payload = self.vessel_tile(x, y, zoom)
            if payload.get("type") != 1:
                raise MarineTrafficError("Tile is aggregated, not individual vessel data; use zoom 12")
            for row in payload["data"]["rows"]:
                try:
                    lat, lon = float(row["LAT"]), float(row["LON"])
                except (KeyError, ValueError, TypeError):
                    continue
                inside_lon = west <= lon <= east if west <= east else lon >= west or lon <= east
                if south <= lat <= north and inside_lon:
                    key = row.get("SHIP_ID") or (lat, lon, row.get("SHIPNAME"))
                    ships[key] = row
        return list(ships.values())

    @staticmethod
    def geojson(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "id": row.get("SHIP_ID"),
             "geometry": {"type": "Point", "coordinates": [float(row["LON"]), float(row["LAT"])]},
             "properties": row} for row in rows]}

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--max-tiles", type=int, default=64)
    parser.add_argument("--transport", choices=["httpcloak", "requests"], default="httpcloak")
    parser.add_argument("--geojson", action="store_true")
    args = parser.parse_args()
    client = MarineTrafficClient(args.transport)
    try:
        if args.bbox:
            rows = client.vessels_in_bbox(*args.bbox, max_tiles=args.max_tiles)
        else:
            payload = client.vessel_tile(993, 803, 12)
            if payload.get("type") != 1:
                raise MarineTrafficError("Expected individual vessel data")
            rows = payload["data"]["rows"]
        print(json.dumps(client.geojson(rows) if args.geojson else {"count": len(rows), "vessels": rows}, ensure_ascii=False))
    finally:
        client.close()

if __name__ == "__main__":
    main()
