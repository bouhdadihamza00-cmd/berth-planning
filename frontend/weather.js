import { getLocale } from "./preferences.js?v=8";
function compactReading(glyph, label, value, detail = "") {
  const {esc, icon} = window.P;
  return `<div title="${esc([label, detail].filter(Boolean).join(" · "))}"><dt><span class="weather-reading-label">${esc(label)}</span><span aria-hidden="true">${icon(glyph)}</span></dt><dd>${esc(value)}</dd></div>`;
}
export function weatherClockMarkup() {
  const {icon} = window.P;
  return `<div class="weather-widget-clock" data-weather-clock role="group" aria-label="Port clock" aria-live="off"><span class="weather-clock-icon" aria-hidden="true">${icon("clock-3")}</span><time></time><span class="weather-clock-date"></span><span class="weather-clock-zone"></span></div>`;
}
export async function mountWeather() {
  const { S, api, path, esc, icon } = window.P;
  const container = document.querySelector('#port-weather');
  const widget = document.querySelector('[data-weather-widget]');
  if (!container) return;
  const port = S.portId;
  try {
    const weather = await api(path('/weather'));
    if (!container.isConnected || S.portId !== port) return;
    const number = (value, unit) => value == null ? 'Not available' : `${Number(value).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} ${unit}`;
    const date = value => esc(new Date(value).toLocaleString(getLocale(), { timeZone: S.data.port.timezone }));
    const fields = [
      ['thermometer', 'Temperature', number(weather.temperature_c, '°C')],
      ['wind', 'Wind', number(weather.wind_knots, 'kn') + (weather.wind_from_degrees == null ? '' : ` · ${weather.wind_from_degrees}°`)],
      ['wind', 'Gusts', number(weather.gust_knots, 'kn')],
      ['cloud-rain', 'Rain next hour', number(weather.precipitation_next_hour_mm, 'mm')],
      ['gauge', 'Pressure', number(weather.pressure_hpa, 'hPa')],
    ];
    const state = weather.status === 'current' ? 'Forecast estimate' : weather.status === 'stale' ? 'Stale forecast' : 'Weather unavailable';
    container.innerHTML = fields.map(([symbol, label, value]) => `<span class="map-environment-item" tabindex="0" title="${esc(label)} · ${esc(state)}${weather.valid_at ? ' · Valid ' + date(weather.valid_at) : ''}" aria-label="${esc(label + ': ' + value + '. ' + state)}">${icon(symbol)}<span>${esc(value)}</span></span>`).join('') + `<a class="map-environment-source" href="https://www.met.no/en" target="_blank" rel="noopener noreferrer" aria-label="Weather data: MET Norway, CC BY 4.0" title="MET Norway · CC BY 4.0 · ${esc(state)} · ${esc(weather.message)}">${icon('info')}</a>`;
    if (widget) {
      const code = weather.condition || "";
      const conditions = [
        [/thunder/, "cloud-lightning", "Thunderstorms"],
        [/sleet/, "cloud-snow", "Sleet"], [/snow/, "snowflake", "Snow"],
        [/rain/, "cloud-rain", "Rain"], [/fog/, "cloud-fog", "Fog"],
        [/partlycloudy|fair/, "cloud-sun", "Partly cloudy"],
        [/cloudy/, "cloud", "Cloudy"], [/clearsky/, "sun", "Clear skies"],
      ];
      const [, symbol, condition] = conditions.find(([pattern]) => pattern.test(code)) || [null, "cloud", state];
      const degrees = weather.wind_from_degrees == null ? null : Number(weather.wind_from_degrees);
      const bearing = Number.isFinite(degrees) ? (degrees % 360 + 360) % 360 : null;
      const direction = bearing === null ? "" : ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(bearing / 22.5) % 16];
      const readings = [
        fields[2], fields[3], ['droplets', 'Humidity', number(weather.humidity_percent, '%')], fields[4],
      ];
      widget.innerHTML = `<div class="weather-widget-hero"><div class="weather-widget-current"><span class="weather-widget-condition-icon" aria-hidden="true">${icon(symbol)}</span><span><strong>${weather.temperature_c == null ? "—" : `${esc(number(weather.temperature_c, "°C"))}`}</strong><span>${esc(condition)}</span></span></div><div class="weather-widget-wind"><div class="weather-compass" aria-hidden="true"><span>N</span><span>E</span><span>S</span><span>W</span><i style="--wind-angle:${bearing ?? 0}deg">${icon(bearing === null ? "wind" : "arrow-up")}</i></div><div><strong>${esc(number(weather.wind_knots, "kn"))}</strong><span>${bearing === null ? "Wind direction unavailable" : `From ${direction} · ${Math.round(bearing)}°`}</span></div></div>${weatherClockMarkup()}</div><dl class="weather-widget-readings">${readings.map(([glyph, label, value]) => `<div><dt>${icon(glyph)} ${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><dl class="weather-widget-compact" aria-label="Weather and marine readings">${[fields[1], ...readings].map(([glyph, label, value]) => compactReading(glyph, label, value, state)).join("")}</dl><p class="weather-widget-source">${esc(state)}${weather.valid_at ? " · " + date(weather.valid_at) : ""} · <a href="https://www.met.no/en" target="_blank" rel="noopener noreferrer">MET Norway</a></p>`;
    }
    window.P.icons();
  } catch {
    if (container.isConnected && S.portId === port) {
      container.textContent = 'Weather unavailable. Retrying on the next dashboard refresh.';
      if (widget) widget.innerHTML = '<p class="weather-widget-source">Weather unavailable.</p>' + weatherClockMarkup();
    }
  } finally {
    if (container.isConnected && S.portId === port) mountMarine(container, port, widget);
  }
}

async function mountMarine(container, port, widget) {
  const { S, api, path, esc, icon } = window.P;
  try {
    const marine = await api(path('/marine'));
    if (!container.isConnected || S.portId !== port) return;
    const waves = marine.groups?.waves;
    const physics = marine.groups?.physics;
    const value = (v, unit) => v == null ? '—' : Number(v).toLocaleString(getLocale(), { maximumFractionDigits: 2 }) + unit;
    const detail = group => group ? `E.U. Copernicus Marine Service · ${group.status === 'current' ? 'Forecast' : 'STALE forecast'} · ${new Date(group.valid_at).toLocaleString(getLocale(), {timeZone:S.data.port.timezone})} · Model cell ${group.distance_km} km from port` : 'No forecast retrieved';
    const fields = [
      ['waves', "Waves", `${value(waves?.VHM0, 'm')} · ${value(waves?.VTPK, 's')}`, `Significant offshore wave height / peak period. ${detail(waves)}`],
      ['waves', "Swell", `${value(waves?.VHM0_SW1, 'm')}`, `Primary swell height. ${detail(waves)}`],
      ['arrow-up-down', "Level", `${value(physics?.zos, 'm')} (geoid)`, `Tide-inclusive model sea level ABOVE GEOID, not chart datum or clearance. ${detail(physics)}`],
      ['navigation', "Current", `${value(physics?.current_knots, 'kn')}${physics?.current_to_degrees == null ? '' : ' → ' + physics.current_to_degrees + '°'}`, `Surface current speed and direction TO. ${detail(physics)}`],
    ];
    container.insertAdjacentHTML('beforeend', fields.map(([symbol,label,text,title]) => `<span class="map-environment-item" tabindex="0" title="${esc(title)}" aria-label="${esc(label + " " + text + ". " + title)}">${icon(symbol)}<span>${esc(label + " " + text)}</span></span>`).join(''));
    const compact = widget?.querySelector(".weather-widget-compact");
    compact?.insertAdjacentHTML("beforeend", fields.map(args => compactReading(...args)).join(""));
    window.P.icons();
  } catch {
    if (container.isConnected && S.portId === port) container.insertAdjacentHTML('beforeend', '<small class="map-environment-source">Marine data unavailable</small>');
  }
}
