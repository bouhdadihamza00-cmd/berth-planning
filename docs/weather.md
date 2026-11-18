# Port weather

The port map weather overlay loads `GET /api/ports/{port}/weather`, protected by the same port access rules as the dashboard. MET Norway Locationforecast provides worldwide weather, free for commercial use with no API key. Attribution links are displayed in the map overlay.

Conditions use the forecast timestep nearest the present time at the configured port center. Temperature (°C), wind and optional gusts (knots), wind origin (degrees), humidity (%), pressure (hPa), and expected rain for the next hour (mm) are displayed. Missing values remain unavailable. These are model estimates, not readings from port instruments. Weather is independent of vessel data and does not automatically change operational statuses or planning rules. Historical/demo workspaces still show present-day weather, explicitly dated.

The dashboard checks its weather endpoint with its normal 60-second refresh. The backend caches each rounded coordinate pair for at least ten minutes and honors longer provider Expires headers. Failed requests retry after two minutes. Recent retained data is marked stale; after six hours it is withheld. Endpoint failures do not block loading the operational dashboard.

Set `WEATHER_USER_AGENT` to an application name and production domain/contact when deploying. The default identifies this local development app. The backend makes requests; browsers never contact the upstream provider. No new dependency or account is needed.

Provider documentation: https://api.met.no/doc/FAQ and https://api.met.no/doc/TermsOfService. Data attribution: MET Norway, CC BY 4.0. The source supplies forecasts rather than guaranteed real-time instrument observations.

The map uses an icon-and-text strip with tooltips rather than a floating card. Tide and sea-state indicators show a dash until a verified local source is connected. See [marine source review](marine-data.md) for coverage, datums and free providers.
