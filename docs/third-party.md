# Third-party components

| Component | Version | License / terms | Use |
| --- | --- | --- | --- |
| Leaflet | 1.9.4 | BSD-2-Clause; bundled notice in licenses/ | Map rendering |
| Leaflet.draw | 1.0.4 | MIT; declared in installed package metadata and [upstream notice](https://github.com/Leaflet/Leaflet.draw/blob/master/MIT-LICENSE.md) | Geographic editor |
| Lucide | 1.72.0 | ISC, with MIT notices for Feather-derived icons; bundled notice in licenses/ | UI icons |
| FastAPI | See requirements-lock.txt | MIT | REST API |
| Uvicorn | See requirements-lock.txt | BSD-3-Clause | HTTP server |
| OR-Tools | See requirements-lock.txt | Apache-2.0 | Scenario scheduling |
| openpyxl | See requirements-lock.txt | MIT | XLSX exports |
| ReportLab | See requirements-lock.txt | BSD | PDF exports |
| Esri World Imagery | External tile service | Provider use/attribution terms apply independently | Satellite basemap |
| OpenStreetMap standard tiles | External tile service | OSM attribution and tile service policy apply | Alternate basemap |
| DM Sans / Manrope | Google Fonts | Font distribution terms apply; loaded by stylesheet | Typography |

Dependencies with a frontend runtime role are vendored in frontend/vendor with their original script headers. Map attribution is retained on both maps. There is no proprietary Gantt dependency. Provider licensing, commercial map entitlements and MarineTraffic subscription validation remain deployment responsibilities; an open-source component license does not confer a data-service entitlement.
