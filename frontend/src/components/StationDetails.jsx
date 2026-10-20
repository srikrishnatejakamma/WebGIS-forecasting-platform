import { fmt, dateLabel } from './formatters.js';

export function RiverChart({ observed = [], forecast = [] }) {
  const all = [...observed, ...forecast];
  if (!all.length) return <div className="chart-empty">No readings available for this period.</div>;
  const width = 620, height = 162, pad = { t: 12, r: 12, b: 25, l: 42 };
  const values = all.map((d) => d.discharge_m3s);
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const x = (i) => pad.l + i * (width - pad.l - pad.r) / Math.max(1, all.length - 1);
  const y = (v) => height - pad.b - (v - min) / (max - min || 1) * (height - pad.t - pad.b);
  const path = (arr, offset = 0) => arr.map((d, i) => `${i ? 'L' : 'M'}${x(i + offset)},${y(d.discharge_m3s)}`).join(' ');
  const splitAt = Math.max(0, observed.length - 1);
  return <svg className="river-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Observed and forecast discharge chart">
    {[0, .5, 1].map((t) => <g key={t}><line x1={pad.l} x2={width - pad.r} y1={pad.t + t * (height - pad.t - pad.b)} y2={pad.t + t * (height - pad.t - pad.b)} className="gridline" /><text x={pad.l - 8} y={pad.t + t * (height - pad.t - pad.b) + 4} textAnchor="end" className="axis-label">{fmt.format(max * (1 - t))}</text></g>)}
    {observed.length > 1 && <path d={path(observed)} className="line-observed" />}
    {forecast.length > 1 && <path d={path(forecast, splitAt)} className="line-forecast" />}
    <text x={pad.l} y={height - 5} className="axis-label">{dateLabel(all[0].valid_at)}</text>
    <text x={width - pad.r} y={height - 5} textAnchor="end" className="axis-label">{dateLabel(all.at(-1).valid_at)}</text>
  </svg>;
}

export function WeatherStationDetails({ station }) {
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>Live weather station <span>·</span> {station.station_id}</p></div>
    <div className="flow-card"><div className="flow-card-top"><span>OBSERVED TEMPERATURE</span><span className="live-weather-label">LIVE METAR</span></div><div className="flow-value">{station.temperature_c == null ? 'N/A' : station.temperature_c}<small>°C</small></div><div className="weather-observation-note">{station.weather || station.flight_category || 'No significant weather reported'}</div></div>
    <div className="metadata-grid"><div><small>OBSERVATION TIME · UTC</small><b>{station.valid_at ? dateLabel(station.valid_at) + ' UTC' : 'Unavailable'}</b></div><div><small>WIND</small><b>{station.wind_speed_kmh == null ? 'Unavailable' : `${station.wind_speed_kmh.toFixed(0)} km/h`}{station.wind_direction_degrees == null ? '' : ` · ${station.wind_direction_degrees}°`}</b></div><div><small>WIND GUST</small><b>{station.wind_gust_kmh == null ? 'Unavailable' : `${station.wind_gust_kmh.toFixed(0)} km/h`}</b></div><div><small>DEW POINT</small><b>{station.dew_point_c == null ? 'Unavailable' : `${station.dew_point_c}°C`}</b></div><div><small>VISIBILITY</small><b>{station.visibility_km == null ? 'Unavailable' : `${station.visibility_km.toFixed(1)} km`}</b></div><div><small>FLIGHT CATEGORY</small><b>{station.flight_category || 'Unavailable'}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>Measured airport weather observation from the Aviation Weather Center. <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noreferrer">View source</a>{station.raw_report && <small className="metar-raw">{station.raw_report}</small>}</p></div>
  </>;
}

export function RiverGaugeDetails({ station }) {
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>Live river gauge <span>·</span> {station.station_id}</p></div>
    <div className="flow-card"><div className="flow-card-top"><span>{station.discharge_m3s == null ? 'LATEST WATER LEVEL' : 'LATEST RIVER FLOW'}</span><span className="live-weather-label">LIVE GAUGE</span></div>{station.discharge_m3s == null ? <div className="flow-value">{station.water_level_m == null ? 'N/A' : station.water_level_m}<small>m</small></div> : <div className="flow-value">{fmt.format(station.discharge_m3s)}<small>m³/s</small></div>}<div className="weather-observation-note">{station.parameter || 'Current provider observation'}{station.qualifier ? ` · ${station.qualifier}` : ''}</div></div>
    <div className="metadata-grid"><div><small>OBSERVED · UTC</small><b>{station.valid_at ? dateLabel(station.valid_at) + ' UTC' : 'Unavailable'}</b></div><div><small>WATER LEVEL</small><b>{station.water_level_m == null ? 'Unavailable' : `${station.water_level_m} m`}</b></div><div><small>DISCHARGE</small><b>{station.discharge_m3s == null ? 'Unavailable' : `${fmt.format(station.discharge_m3s)} m³/s`}</b></div><div><small>PROVIDER</small><b>{station.source}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>Live provider measurement. Reading frequency and units are set by the source agency. <a href={station.source_url} target="_blank" rel="noreferrer">View source</a></p></div>
  </>;
}

export function AirQualityDetails({ station }) {
  const readings = Object.entries(station.pollutants || {}).sort(([a], [b]) => a.localeCompare(b));
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>CPCB air monitor · {station.city}, {station.state}</p></div>
    <div className="flow-card air-quality-card"><div className="flow-card-top"><span>REPORTED POLLUTANTS</span><span className="live-weather-label">CPCB</span></div><div className="aq-pollutant-grid">{readings.map(([name, value]) => <div key={name}><small>{name}</small><b>{value.average == null ? 'N/A' : fmt.format(value.average)}</b></div>)}</div><div className="weather-observation-note">Values are reported by CPCB; units are not included in this feed.</div></div>
    <div className="metadata-grid"><div><small>LAST READING</small><b>{station.valid_at || 'Unavailable'}</b></div><div><small>LOCATION</small><b>{station.city}, {station.state}</b></div><div><small>COORDINATES</small><b>{station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</b></div><div><small>PROVIDER</small><b>{station.source}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>This layer shows the source pollutant readings. It does not calculate or imply an official AQI. <a href={station.source_url} target="_blank" rel="noreferrer">View source</a></p></div>
  </>;
}

