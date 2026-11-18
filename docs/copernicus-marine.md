# Connected Copernicus Marine data

Portside uses the official `copernicusmarine==2.5.1` Python client. A user-authorized MyOcean/CDSE offline session is stored with permissions 0600 in ignored `data/copernicus-session.json`. No account password is copied into the app. `COPERNICUS_SESSION_FILE` can select another private server-side path; Docker expects the file in its persistent data volume. Never expose the session in frontend assets, logs or API responses. The official client supports the offline token through `COPERNICUSMARINE_MYOCEAN_AUTH`. If the user revokes the session, authentication must be re-established.

The existing MET Norway weather connection stays independent. `GET /api/ports/{port}/marine` requires dashboard access to that port. Opening the dashboard queues a small forecast subset around the port center; the background worker refreshes each requested area every 30 minutes. The map reads the local cached result on its normal dashboard refresh, without waiting for a remote download. Authentication failures retry after two minutes. Valid retained results are visibly stale after errors or one hour without retrieval and withheld after six hours. Failed groups do not overwrite previously successful downloads.

## Data and interpretation

- `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`: significant wave height `VHM0`, peak period `VTPK`, direction from `VMDR`, primary swell height `VHM0_SW1` and mean primary swell period `VTM01_SW1`. Global wave model, roughly 8 km cells and 3-hour forecast timesteps.
- `cmems_mod_ibi_phy_anfc_0.027deg-2D_PT15M-i`: tide-inclusive sea level `zos`, eastward current `uo` and northward current `vo`. Regional IBI model, roughly 3 km cells and 15-minute timesteps. Current magnitude is converted from m/s to knots; bearing describes motion TO a direction.

Each group uses the nearest model cell with finite values for all requested fields, within 25 km of the port center. Cell coordinates, distance, source dataset and valid time are returned and available in map tooltips. Missing or land-masked cells remain unavailable. These are offshore/regional model values, not measurements inside a sheltered berth.

Sea level is explicitly **above geoid**, following the source's `sea_surface_height_above_geoid` metadata. It includes tides and other sea-level effects and is not a pure astronomical tide height. It is not relative to local chart datum. Portside does not use it to calculate under-keel clearance or automatically approve berth movements. That requires a verified local datum transformation, surveyed depths and port operating policy.

The map displays compact wave, swell, level and current icons/text with E.U. Copernicus Marine Service attribution. No account token or raw authentication response is included.

## Verification


Sources:
- https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/services
- https://data.marine.copernicus.eu/product/IBI_ANALYSISFORECAST_PHY_005_001/services
- https://toolbox-docs.marine.copernicus.eu/en/stable/python-interface.html
