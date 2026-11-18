> Historical documentation: these provider options have been removed. Current setup: [sole vessel API](ais-marinetraffic-client.md).

# Authorized JSON vessel tracking

Portside has an optional **Authorized JSON · continuous vessel positions** provider. It uses the existing Python AIS endpoint and Leaflet vessel map. One backend collector polls an authorized local JSON file or HTTPS JSON feed, shares observations across enabled ports, and filters positions against each port's configured tracking bounds. The browser automatically refreshes markers every ten seconds without recreating the map.

## Prototype model included

`backend/ais_json_model.py` adapts the `VesselPosition` data model inspected in `~/Downloads/api_client.py`. It supports all requested prototype fields and accepts both raw uppercase rows and the model's normalized lowercase fields. The Authorized JSON provider does not import or execute the original prototype. Its transport, tile calculations and request implementation are separate from JSON ingestion. A subsequent optional [supplied Python client provider](ais-marinetraffic-client.md) now integrates that transport independently.

| Input | Portside representation |
| --- | --- |
| SHIP_ID | `ship_id`, stable hashed map vessel ID; never an MMSI or operational call ID |
| SHIPNAME | `name` |
| LAT, LON | Validated WGS84 `position: [longitude, latitude]` |
| SPEED | `speed` in knots only with declared units; otherwise null with raw value retained |
| COURSE, HEADING | Separate nullable `course` and `heading`, 0 is valid; 360/511 are unknown |
| ELAPSED | `elapsed_seconds` only with a declared unit; position time requires a reference clock |
| DESTINATION, FLAG, SHIPTYPE | `destination`, `flag`, `ship_type` |
| LENGTH, WIDTH | `loa`, `beam` in metres with declared units |
| DWT | `dwt` in tonnes with declared units |
| MMSI, IMO, TIMESTAMP | Optional identifiers and absolute UTC position time for future documented feeds |

The prototype divided speed by ten and named elapsed time in seconds. Earlier saved evidence did not establish the speed scale and described elapsed values as minutes. This integration therefore requires the authorized producer to declare units. It does not adopt either assumption silently.

## Input contract

Acceptable row containers are a bare array, `{"rows": [...]}`, `{"data": [...]}`, `{"DATA": [...]}` or `{"data": {"rows": [...]}}`. Metadata belongs at the outermost level. The following is an archived test example, not a live position:

```json
{
  "historical_test": true,
  "observed_at": "2026-11-12T12:00:00Z",
  "units": {
    "speed": "tenths_knots",
    "elapsed": "minutes",
    "dimensions": "metres",
    "dwt": "tonnes"
  },
  "rows": [{
    "SHIP_ID": "100001", "SHIPNAME": "EXAMPLE VESSEL",
    "LAT": "51.95", "LON": "4.14",
    "SPEED": "86", "COURSE": "0", "HEADING": null, "ELAPSED": "2",
    "DESTINATION": "EXAMPLE HARBOR", "FLAG": "BS",
    "LENGTH": "200", "WIDTH": "32.2", "DWT": "76000", "SHIPTYPE": "Bulk Carrier"
  }]
}
```

Supported speed units are `knots`, `tenths_knots` or `unknown`. Elapsed units are `seconds`, `minutes` or `unknown`. Dimensions use `metres` or `unknown`; deadweight uses `tonnes` or `unknown`. Omitting a declaration preserves the raw value and leaves its normalized measurement unknown. Lowercase normalized model fields such as `speed_kn`, `elapsed_s`, `length_m` and `width_m` already declare their units through their names.

`observed_at` is the producer's UTC clock anchoring the reported ELAPSED, not the time Portside reads a file. A producer must preserve this clock if it republishes unchanged data. Alternatively, provide each row's timezone-aware ISO `TIMESTAMP` or `position_at`. Portside never uses HTTP retrieval time, file modification time or the current clock as a substitute for position time. Missing clocks remain unknown and cannot produce Live status. Future-dated positions are flagged and cannot produce Live status. Test or captured datasets must set `historical_test: true`, which prevents Live status and call matching regardless of their timestamps.

The collector skips invalid rows while retaining valid neighbors; an entirely invalid payload is an error and preserves last-known observations. The body is limited to 4 MiB and 20,000 rows. Only allowlisted prototype raw fields are retained, with bounded text. Extra fields such as cookies or authorization data are discarded.

## Activate an authorized source

1. Arrange a source you are authorized to use. It must publish JSON using this contract, with original position timestamps or declared elapsed units and a trustworthy reference clock. The source is responsible for coverage and obtaining the data. A static archive cannot provide a live feed.
2. Set `AIS_JSON_SOURCE` in the backend environment or ignored local `.env` to an absolute JSON file path or an authorized HTTPS JSON URL. Optionally set `AIS_JSON_BEARER_TOKEN` for that URL. Restart the backend after changing its environment. For a file, have the producer write a temporary file and atomically rename it over the configured path.
3. Set `AIS_JSON_POLL_SECONDS`, default 10 and supported range 1–60 seconds, to respect source quotas. Failed reads use bounded retry backoff. HTTP is supported only for a loopback development source. Redirects, embedded URL credentials, MarineTraffic website hosts and non-HTTP protocols are rejected. The source address and bearer token are never accepted through the browser's port settings or returned in status messages.
4. In Configuration → External integrations, select **Authorized JSON · continuous vessel positions**, enable tracking and save. Existing providers and defaults are preserved. The provider is isolated from historical and working Excel workspaces.
5. Check saved connection and Port view. Connection/source availability is distinct from position freshness. Fresh observations can show Live, old/unknown/future observations show Stale, a valid empty area shows Awaiting AIS, failures without observations show Offline, and test datasets show Historical/test JSON AIS. No simulated vessels are substituted.

Docker Compose forwards these three environment variables. For a local source in Docker, mount your producer's directory read-only into the container and set `AIS_JSON_SOURCE` to the container path. Mount the directory rather than one file so atomic file replacement remains visible. No feed directory or source is provisioned automatically.

## Identity, outages and planning

SHIP_ID is the primary source identity. If it is absent, a valid MMSI or IMO can identify a row; display names never identify vessels. Map IDs are hashed so opaque provider IDs cannot become executable markup. Position-only updates retain known static particulars, but missing heading/course/speed do not borrow measurements from an older position. Older or unknown-time reports cannot overwrite a timestamped observation. Separate observations are not a historical track or movement prediction.

Matching uses valid MMSI/IMO and requires exactly one eligible call with no conflicting identifier. Completed/cancelled calls, ambiguous matches and historical/test observations stay unlinked. The provider never writes vessel calls, statuses, dimensions, schedules, readiness, approvals, arrival/departure events or berth assignments.

On source failure, previously received observations remain visible as stale. Cached observations expire after two hours without a received report, and memory is bounded. A valid empty snapshot clears cached observations. Source changes clear observations on the next collector poll. This phase supports repeated snapshots; cursor pagination and incremental/delta semantics require a separate source adapter.

## Future official API connection

`backend/ais_json_source.py` contains only file/authorized-HTTP access. `backend/ais_json_model.py` contains normalization, and `backend/ais_json.py` contains collection and map projection. A future licensed MarineTraffic adapter can implement a separate documented source reader and schema mapping while reusing the collector and existing endpoint. The current JSON reader deliberately rejects MarineTraffic hosts, so it cannot be repointed at the supplied website client. The existing licensed connector remains separate and unchanged.

To activate genuine live tracking, the remaining external input is an authorized source with confirmed units, fresh position clocks, regional coverage and any required credentials. The supplied prototype is now available through a separate optional provider; it is not used as the Authorized JSON source reader. No claim of full port coverage or verified live MarineTraffic connectivity is made by this integration.
