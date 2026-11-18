import { getLocale } from "./preferences.js?v=8";
export async function mountWeather() {
  const { S, api, path, esc, icon } = window.P;
  const container = document.querySelector('#port-weather');
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
    window.P.icons();
  } catch {
    if (container.isConnected && S.portId === port) container.innerHTML = 'Weather unavailable. Retrying on the next dashboard refresh.';
  } finally {
    if (container.isConnected && S.portId === port) mountMarine(container, port);
  }
}

async function mountMarine(container, port) {
  const { S, api, path, esc, icon } = window.P;
  try {
    const marine = await api(path('/marine'));
    if (!container.isConnected || S.portId !== port) return;
    const waves = marine.groups?.waves;
    const physics = marine.groups?.physics;
    const value = (v, unit) => v == null ? '—' : Number(v).toLocaleString(getLocale(), { maximumFractionDigits: 2 }) + unit;
    const detail = group => group ? `E.U. Copernicus Marine Service · ${group.status === 'current' ? 'Forecast' : 'STALE forecast'} · ${new Date(group.valid_at).toLocaleString(getLocale(), {timeZone:S.data.port.timezone})} · Model cell ${group.distance_km} km from port` : 'No forecast retrieved';
    const fields = [
      ['waves', `Waves ${value(waves?.VHM0, 'm')} · ${value(waves?.VTPK, 's')}`, `Significant offshore wave height / peak period. ${detail(waves)}`],
      ['waves', `Swell ${value(waves?.VHM0_SW1, 'm')}`, `Primary swell height. ${detail(waves)}`],
      ['arrow-up-down', `Level ${value(physics?.zos, 'm')} (geoid)`, `Tide-inclusive model sea level ABOVE GEOID, not chart datum or clearance. ${detail(physics)}`],
      ['navigation', `Current ${value(physics?.current_knots, 'kn')}${physics?.current_to_degrees == null ? '' : ' → ' + physics.current_to_degrees + '°'}`, `Surface current speed and direction TO. ${detail(physics)}`],
    ];
    container.insertAdjacentHTML('beforeend', fields.map(([symbol,text,title]) => `<span class="map-environment-item" tabindex="0" title="${esc(title)}" aria-label="${esc(text + '. ' + title)}">${icon(symbol)}<span>${esc(text)}</span></span>`).join(''));
    window.P.icons();
  } catch {
    if (container.isConnected && S.portId === port) container.insertAdjacentHTML('beforeend', '<small class="map-environment-source">Marine data unavailable</small>');
  }
}
