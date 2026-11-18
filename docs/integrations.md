# External integrations

Vessel positions use the [supplied MarineTraffic client](ais-marinetraffic-client.md). No alternative vessel provider is selected automatically. Configure your own authorized backend access before enabling tracking for a port. Credentials belong in ignored server-side files or environment variables, never frontend code or committed settings.

Tracking is disabled for new ports. No captured vessel feed, replay or customer workspace is bundled. Operational vessel status comes from the port records; observed AIS positions do not approve or publish planning changes.

## Maps

The two map views use Esri World Imagery and Esri World Street Map through Leaflet, with attribution. They require internet access. Empty, unconfigured ports start at world scale. Configure a port location and geometry before using its local map view. Background imagery can be unavailable at some locations or zoom levels; switch to Map when necessary. Provider errors fall back to the other background and leave operational overlays intact.

## Other data

See [weather](weather.md), [marine data](marine-data.md), [Copernicus](copernicus-marine.md) and [AI setup](ai-assistant.md). Connectors require deployment-specific configuration; the repository includes no customer credentials or observations.
