> Update: Copernicus wave, swell, tide-inclusive sea-level and current data are now connected. See [connection and datum details](copernicus-marine.md). The findings below document the earlier source search.

# Marine conditions for berthing — source review, 17 November 2026

## Connected

MET Norway weather remains the connected free source. The map shows compact icons and text for temperature, wind speed/direction, gusts when available, next-hour rain and pressure. Hover or focus each indicator for its meaning and forecast time. These are model estimates; they do not trigger automatic berth approval or change operational statuses.

## Tide data

Open Waters offers a free, no-key tide API, with station-specific licensing and datums. Station coverage and suitability must be verified for each configured port; no remote station is substituted automatically. Never substitute a distant station without a validated tidal relationship. For a future tide integration, display station name, distance, prediction time, height units and vertical datum. Chart datum, mean sea level and lowest astronomical tide are not interchangeable.

- API: https://openwaters.io/api/tides/
- License details: https://openwaters.io/license/
- Morocco's official hydrographic report describes its tide-gauge network and local chart datums: https://iho.int/uploads/user/Inter-Regional%20Coordination/RHC/MBSHC/MBSHC24/MBSHC24_2024_06.2.2o_EN_Presentation_Morocco_National%20Report.pdf

For operational use, obtain a verified Moroccan port tide/gauge source with the local datum, surveyed depths and updates. Tide height alone does not determine under-keel clearance: vessel draft, squat, wave response and the port's clearance policy also matter.

## Waves, swell and currents

| Source | Cost/access | Finding |
| --- | --- | --- |
| PacIOOS WW3 global | Free redistribution, no account | Significant wave height, peak period and peak direction at about 0.5° (~50 km). Useful as an offshore context candidate, not sheltered berth conditions. Direct live probes timed out; not connected. |
| Copernicus Marine | Free, including commercial use; registration required for supported authenticated access | Candidate for regional/global waves, swell, currents and sea level. Requires selecting and validating a product covering the Moroccan port approaches. No account has been configured. |
| Open-Meteo Marine | Free hosted API is non-commercial; commercial access requires a subscription | Provides waves, swell, currents and tide-inclusive sea level. Sea level is referenced to global mean sea level, not port chart datum. Not enabled for this commercial use. |
| MET Norway Oceanforecast | Free | Regional coverage is Nordic/Arctic, not Morocco. Not connected here. |
| Open Waters currents | Free, station-dependent | Station coverage must be checked at each Moroccan port; no validated local current source connected. |

Sources:
- https://pae-paha.pacioos.hawaii.edu/erddap/info/ww3_global/index.html
- https://help.marine.copernicus.eu/en/articles/4220332-how-to-register-for-copernicus-marine-service
- https://open-meteo.com/en/docs/marine-weather-api
- https://open-meteo.com/en/pricing
- https://api.met.no/doc/oceanforecast/datamodel
- https://openwaters.io/api/currents/

Other relevant inputs are visibility/fog, sustained wind and gust direction relative to the berth, swell period/direction, tidal current and slack-water windows, storm surge, harbor restrictions, surveyed channel/berth depth and local operating limits. No generic safe/unsafe thresholds are imposed: these must come from the port and vessel operating rules.
