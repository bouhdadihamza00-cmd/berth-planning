# Global vessel data

The only vessel data API is adapted from the supplied Desktop `global marine traffic api.py`. Other live providers, JSON feeds, offline replay and simulated fallback have been removed. Existing port selections migrate at startup; disabled tracking stays disabled. Enable vessel tracking in Configuration → External integrations.

The adapter shares zoom-12 map tiles across enabled ports and normalizes observations for the existing vessel map. It accepts a tracking radius from 1 to 5,000 km and queries each port's configured center, radius and boundary, rather than exporting every vessel worldwide. Aggregated tiles are rejected. Failed requests keep retained observations visibly stale; partial scans report coverage. Historical and Excel workspaces remain isolated, and AIS does not change operational statuses.

Captured cookies are stored in ignored `data/marinetraffic-client-cookies.json` with mode 0600. Set `MARINETRAFFIC_CLIENT_COOKIES_FILE` for a private deployment path. Cookies never go to the browser or source control. The source script is unchanged. The supplied client uses `httpcloak` and renews the same session once after HTTP 401/403. Requests remain spaced by at least half a second. A normal collection is followed by a 60-second pause; failures retry after 120 seconds.

`MARINETRAFFIC_CLIENT_ZOOM` defaults to 12, the supplied script's verified tile level. Speed defaults to tenths of knots, elapsed age to minutes; these interpretations remain configurable through `MARINETRAFFIC_CLIENT_SPEED_UNIT` and `MARINETRAFFIC_CLIENT_ELAPSED_UNIT`. Observation time uses the HTTP response clock where available. Website access and cookies can expire or be blocked.
