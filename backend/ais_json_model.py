"""Transport-free adaptation of the Reverse API Engineer VesselPosition model.

Only the field model is reused. Units and time anchors must be declared by the
authorized producer; no assumptions from its website client are carried over.
"""
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

FIELDS = ('SHIP_ID', 'SHIPNAME', 'LAT', 'LON', 'SPEED', 'COURSE', 'HEADING',
          'ELAPSED', 'DESTINATION', 'FLAG', 'LENGTH', 'WIDTH', 'DWT', 'SHIPTYPE')
MAX_ROWS = 20000


def numeric(value, minimum=0, maximum=float('inf')):
    if value is None or isinstance(value, bool) or value == '':
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and minimum <= result <= maximum else None
    except (ValueError, TypeError, OverflowError):
        return None


def text(value):
    return str(value).strip()[:256] if isinstance(value, (str, int)) and not isinstance(value, bool) else None


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.astimezone(timezone.utc) if stamp.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


@dataclass(frozen=True)
class VesselPosition:
    ship_id: str
    name: str
    lat: float
    lon: float
    speed_kn: float | None
    course: float | None
    heading: float | None
    elapsed_s: float | None
    destination: str | None
    flag: str | None
    ship_type: str | None
    length_m: float | None
    width_m: float | None
    dwt: float | None
    is_satellite: bool = False
    raw: dict = field(default_factory=dict, repr=False)
    mmsi: str | None = None
    imo: str | None = None
    position_at: str | None = None
    historical_test: bool = False

    @property
    def is_moving(self):
        return self.speed_kn is not None and self.speed_kn > .5


def parse_row(row, units, observed_at, historical_test=False):
    if not isinstance(row, dict):
        return None
    def get(upper, lower):
        return row[upper] if upper in row else row.get(lower)
    supplied_id = get('SHIP_ID', 'ship_id')
    if isinstance(supplied_id, str) and len(supplied_id.strip()) > 256:
        return None
    ship_id = text(supplied_id)
    mmsi, imo = text(row.get('MMSI', row.get('mmsi'))), text(row.get('IMO', row.get('imo')))
    mmsi = mmsi if mmsi and len(mmsi) == 9 and mmsi.isascii() and mmsi.isdigit() else None
    imo = imo if imo and len(imo) == 7 and imo.isascii() and imo.isdigit() else None
    ship_id = ship_id or ('mmsi:' + mmsi if mmsi else 'imo:' + imo if imo else None)
    lat, lon = numeric(get('LAT', 'lat'), -90, 90), numeric(get('LON', 'lon'), -180, 180)
    if not ship_id or lat is None or lon is None:
        return None
    speed = numeric(row.get('speed_kn'), 0, 102.2) if 'SPEED' not in row else None
    raw_speed = numeric(row.get('SPEED'))
    if raw_speed is not None and units.get('speed') in ('knots', 'tenths_knots'):
        speed = numeric(raw_speed / (10 if units['speed'] == 'tenths_knots' else 1), 0, 102.2)
    elapsed = numeric(row.get('elapsed_s'), 0, 3155760000) if 'ELAPSED' not in row else None
    raw_elapsed = numeric(row.get('ELAPSED'))
    if raw_elapsed is not None and units.get('elapsed') in ('seconds', 'minutes'):
        elapsed = numeric(raw_elapsed * (60 if units['elapsed'] == 'minutes' else 1), 0, 3155760000)
    stamp = instant(row.get('TIMESTAMP', row.get('position_at')))
    if stamp is None and elapsed is not None and observed_at is not None:
        try:
            stamp = observed_at - timedelta(seconds=elapsed)
        except OverflowError:
            pass
    def dimension(upper, lower, maximum):
        value = get(upper, lower)
        return numeric(value, 0, maximum) if upper not in row or units.get('dimensions') == 'metres' else None
    def angle(value):
        number = numeric(value, 0, 360)
        return number if number is not None and number < 360 else None
    raw = {key: row[key][:512] if isinstance(row[key], str) else row[key] for key in FIELDS if key in row and isinstance(row[key], (str, int, float, bool, type(None)))
           and (not isinstance(row[key], float) or math.isfinite(row[key]))}
    return VesselPosition(
        ship_id=ship_id, name=text(get('SHIPNAME', 'name')) or 'AIS vessel ' + ship_id,
        lat=lat, lon=lon, speed_kn=speed, course=angle(get('COURSE', 'course')),
        heading=angle(get('HEADING', 'heading')), elapsed_s=elapsed,
        destination=text(get('DESTINATION', 'destination')), flag=text(get('FLAG', 'flag')),
        ship_type=text(get('SHIPTYPE', 'ship_type')) or text(row.get('TYPE_NAME')),
        length_m=dimension('LENGTH', 'length_m', 1000), width_m=dimension('WIDTH', 'width_m', 200),
        dwt=numeric(row.get('dwt')) if 'DWT' not in row else numeric(row['DWT']) if units.get('dwt') == 'tonnes' else None,
        is_satellite=row.get('SHIPNAME') == '[SAT-AIS]', raw=raw, mmsi=mmsi, imo=imo,
        position_at=stamp.isoformat() if stamp else None, historical_test=historical_test)


def decode(payload):
    """Accept raw rows or the prototype's JSON row envelopes, never capture metadata."""
    meta = payload if isinstance(payload, dict) else {}
    units = meta.get('units', {})
    allowed = {'speed': ('unknown', 'knots', 'tenths_knots'), 'elapsed': ('unknown', 'seconds', 'minutes'),
               'dimensions': ('unknown', 'metres'), 'dwt': ('unknown', 'tonnes')}
    if not isinstance(units, dict) or any(k not in allowed or v not in allowed[k] for k, v in units.items()):
        raise ValueError('Invalid JSON AIS units')
    observed = instant(meta.get('observed_at'))
    if meta.get('observed_at') is not None and observed is None:
        raise ValueError('Invalid JSON AIS observation clock')
    historical = meta.get('historical_test', False)
    if not isinstance(historical, bool):
        raise ValueError('Invalid JSON AIS provenance')
    rows = payload
    if isinstance(rows, dict):
        rows = rows.get('rows', rows.get('DATA', rows.get('data')))
        if isinstance(rows, dict):
            rows = rows.get('rows')
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise ValueError('Invalid JSON AIS rows')
    reports = [parse_row(row, units, observed, historical) for row in rows]
    accepted = [row for row in reports if row is not None]
    if rows and not accepted:
        raise ValueError('No valid JSON AIS observations')
    return accepted, len(rows) - len(accepted)
