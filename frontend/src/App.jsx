import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import Heatmap from 'ol/layer/Heatmap.js';
import OSM from 'ol/source/OSM.js';
import XYZ from 'ol/source/XYZ.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js';
import 'ol/ol.css';

const colors = { normal: '#30977b', watch: '#e8a942', warning: '#e06553' };
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', timeZone: 'UTC' }).format(new Date(value));

async function api(path, options = {}, token = '') {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('X-API-Token', token);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join(', ') : body.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function RiverChart({ observed = [], forecast = [] }) {
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

function App() {
  const mapElement = useRef(null);
  const mapObject = useRef(null);
  const stationLayer = useRef(null);
  const rasterLayers = useRef([]);
  const liveLayerRefs = useRef({});
  const [stations, setStations] = useState([]);
  const [stationWeather, setStationWeather] = useState({});
  const [stationWeatherStatus, setStationWeatherStatus] = useState('Loading live weather…');
  const [selectedId, setSelectedId] = useState(null);
  const [observations, setObservations] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [runs, setRuns] = useState([]);
  const [rasters, setRasters] = useState([]);
  const [activeRasters, setActiveRasters] = useState({});
  const [health, setHealth] = useState(null);
  const [token, setToken] = useState(() => sessionStorage.getItem('rivercast-token') || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showStationForm, setShowStationForm] = useState(false);
  const [forecastStep, setForecastStep] = useState(0);
  const [liveLayers, setLiveLayers] = useState({ rainfall: false, radar: false, cyclones: false });
  const [liveMeta, setLiveMeta] = useState({});

  const selected = stations.find((station) => station.id === selectedId) || stations[0];
  const selectedWeather = selected ? stationWeather[selected.id] : null;
  const loadStations = useCallback(async () => {
    const rows = await api('/api/stations');
    setStations(rows);
    setSelectedId((current) => current && rows.some((s) => s.id === current) ? current : rows[0]?.id || null);
  }, []);
  const loadAssets = useCallback(async () => {
    const [assets, history, status] = await Promise.all([api('/api/data/gridded'), api('/api/forecast-runs?limit=30'), api('/api/health')]);
    setRasters(assets);
    setRuns(history);
    setHealth(status);
  }, []);

  useEffect(() => {
    const markers = new VectorSource();
    const markerLayer = new VectorLayer({ source: markers, style: (feature) => {
      const color = colors[feature.get('status')] || colors.normal;
      return [new Style({ image: new CircleStyle({ radius: feature.get('selected') ? 9 : 7, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 3 }) }) }), new Style({ text: new Text({ text: feature.get('selected') ? feature.get('name') : '', offsetY: -19, font: '600 12px Inter, sans-serif', fill: new Fill({ color: '#193b36' }), backgroundFill: new Fill({ color: '#ffffffdd' }), padding: [3, 6, 3, 6] }) })];
    } });
    stationLayer.current = markerLayer;
    const map = new Map({ target: mapElement.current, layers: [new TileLayer({ source: new OSM() }), markerLayer], view: new View({ center: fromLonLat([84.4, 22.8]), zoom: 5, minZoom: 3, maxZoom: 18 }), controls: [] });
    mapObject.current = map;
    map.on('singleclick', (event) => map.forEachFeatureAtPixel(event.pixel, (feature) => setSelectedId(feature.get('stationId'))));
    Promise.allSettled([loadStations(), loadAssets()]).then((results) => {
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) setError(failure.reason.message);
    });
    return () => map.setTarget(undefined);
  }, [loadAssets, loadStations]);

  useEffect(() => {
    if (!stations.length) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await api('/api/live/stations');
        if (cancelled) return;
        setStationWeather(Object.fromEntries(response.stations.map((reading) => [reading.station_id, reading])));
        setStationWeatherStatus(`Open-Meteo weather updated ${dateLabel(response.fetched_at)} UTC`);
      } catch (reason) {
        if (!cancelled) setStationWeatherStatus(`Live weather unavailable: ${reason.message}`);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [stations]);

  useEffect(() => {
    if (!selected) return;
    setForecastStep(0);
    Promise.all([api(`/api/stations/${selected.id}/observations?hours=168`), api(`/api/stations/${selected.id}/forecast?hours=48`)]).then(([history, prediction]) => {
      setObservations(history.points || []); setForecast(prediction); setError('');
    }).catch((reason) => setError(reason.message));
  }, [selected?.id]);

  useEffect(() => {
    if (!mapObject.current) return;
    const source = stationLayer.current.getSource();
    source.clear();
    stations.forEach((station) => source.addFeature(new Feature({
      geometry: new Point(fromLonLat([station.longitude, station.latitude])), stationId: station.id,
      name: station.name, status: station.status, selected: station.id === selectedId,
    })));
  }, [stations, selectedId]);

  useEffect(() => {
    if (!mapObject.current) return;
    rasterLayers.current.forEach((layer) => mapObject.current.removeLayer(layer));
    rasterLayers.current = [];
    rasters.forEach((asset) => {
      if (!asset.tile_url || !activeRasters[asset.id]) return;
      const layer = new TileLayer({ source: new XYZ({ url: asset.tile_url, crossOrigin: 'anonymous' }), opacity: .68 });
      mapObject.current.getLayers().insertAt(1, layer);
      rasterLayers.current.push(layer);
    });
  }, [rasters, activeRasters]);

  useEffect(() => {
    if (!mapObject.current) return undefined;
    let cancelled = false;
    let timer;
    const key = 'rainfall';
    const existing = liveLayerRefs.current[key];
    if (!liveLayers.rainfall) {
      if (existing) mapObject.current.removeLayer(existing);
      liveLayerRefs.current[key] = null;
      return undefined;
    }
    const refresh = async () => {
      try {
        const data = await api('/api/live/rainfall');
        if (cancelled) return;
        const source = new VectorSource();
        data.features.forEach((item) => {
          const feature = new Feature({ geometry: new Point(fromLonLat(item.geometry.coordinates)), weight: item.properties.weight });
          feature.setProperties(item.properties);
          source.addFeature(feature);
        });
        if (!liveLayerRefs.current[key]) {
          const layer = new Heatmap({ source, blur: 36, radius: 25, weight: 'weight', gradient: ['#fff7bc', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04'] });
          liveLayerRefs.current[key] = layer;
          mapObject.current.getLayers().insertAt(Math.max(1, mapObject.current.getLayers().getLength() - 1), layer);
        } else liveLayerRefs.current[key].setSource(source);
        setLiveMeta((state) => ({ ...state, rainfall: `${data.layer} · ${data.valid_at || 'updated'} UTC` }));
      } catch (reason) {
        if (!cancelled) setLiveMeta((state) => ({ ...state, rainfall: `Unavailable: ${reason.message}` }));
      }
    };
    refresh();
    timer = window.setInterval(refresh, 30 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [liveLayers.rainfall]);

  useEffect(() => {
    if (!mapObject.current) return undefined;
    let cancelled = false;
    let timer;
    const key = 'radar';
    const existing = liveLayerRefs.current[key];
    if (!liveLayers.radar) {
      if (existing) mapObject.current.removeLayer(existing);
      liveLayerRefs.current[key] = null;
      return undefined;
    }
    const refresh = async () => {
      try {
        const data = await api('/api/live/radar');
        if (cancelled) return;
        if (!liveLayerRefs.current[key]) {
          const layer = new TileLayer({ source: new XYZ({ url: data.tile_url, maxZoom: 7, crossOrigin: 'anonymous' }), opacity: .72 });
          liveLayerRefs.current[key] = layer;
          mapObject.current.getLayers().insertAt(Math.max(1, mapObject.current.getLayers().getLength() - 1), layer);
        } else liveLayerRefs.current[key].getSource().setUrl(data.tile_url);
        setLiveMeta((state) => ({ ...state, radar: `RainViewer radar · ${dateLabel(data.latest_at)} UTC` }));
      } catch (reason) {
        if (!cancelled) setLiveMeta((state) => ({ ...state, radar: `Unavailable: ${reason.message}` }));
      }
    };
    refresh();
    timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [liveLayers.radar]);

  useEffect(() => {
    if (!mapObject.current) return undefined;
    let cancelled = false;
    let timer;
    const key = 'cyclones';
    const existing = liveLayerRefs.current[key];
    if (!liveLayers.cyclones) {
      if (existing) mapObject.current.removeLayer(existing);
      liveLayerRefs.current[key] = null;
      return undefined;
    }
    const refresh = async () => {
      try {
        const data = await api('/api/live/cyclones');
        if (cancelled) return;
        const source = new VectorSource({ features: new GeoJSON().readFeatures(data, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }) });
        if (!liveLayerRefs.current[key]) {
          const layer = new VectorLayer({ source, style: (feature) => {
            const level = String(feature.get('alertlevel') || feature.get('alertLevel') || 'green').toLowerCase();
            const color = level === 'red' ? '#cb443c' : level === 'orange' ? '#e58b32' : '#d7b13d';
            const geometry = feature.getGeometry();
            const styles = [new Style({ stroke: new Stroke({ color, width: 3 }), fill: new Fill({ color: `${color}30` }), image: new CircleStyle({ radius: 8, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 2 }) }) })];
            if (geometry?.getType() === 'Point') styles[0].setText(new Text({ text: String(feature.get('eventname') || feature.get('name') || 'Cyclone'), offsetY: -16, font: '600 11px sans-serif', fill: new Fill({ color: '#7c322b' }), backgroundFill: new Fill({ color: '#ffffffdd' }), padding: [2, 4, 2, 4] }));
            return styles;
          } });
          liveLayerRefs.current[key] = layer;
          mapObject.current.getLayers().insertAt(Math.max(1, mapObject.current.getLayers().getLength() - 1), layer);
        } else liveLayerRefs.current[key].setSource(source);
        const eventCount = new Set(source.getFeatures().map((feature) => feature.get('eventid')).filter(Boolean)).size;
        setLiveMeta((state) => ({ ...state, cyclones: `GDACS · ${eventCount} current cyclones · ${dateLabel(data.fetched_at)} UTC` }));
      } catch (reason) {
        if (!cancelled) setLiveMeta((state) => ({ ...state, cyclones: `Unavailable: ${reason.message}` }));
      }
    };
    refresh();
    timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [liveLayers.cyclones]);

  useEffect(() => {
    if (!selected || !mapObject.current) return;
    mapObject.current.getView().animate({ center: fromLonLat([selected.longitude, selected.latitude]), zoom: Math.max(mapObject.current.getView().getZoom(), 6), duration: 450 });
  }, [selectedId]);

  async function withBusy(action, success) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(success); }
    catch (reason) { setError(reason.message || 'Something went wrong'); }
    finally { setBusy(false); }
  }

  async function uploadFile(file, kind) {
    if (!file) return;
    await withBusy(async () => {
      const form = new FormData(); form.append('file', file);
      await api(kind === 'raster' ? '/api/data/gridded' : '/api/observations/import', { method: 'POST', body: kind === 'raster' ? form : file, headers: kind === 'raster' ? {} : { 'Content-Type': file.name.endsWith('.json') ? 'application/json' : 'text/csv' } }, token);
      await Promise.all([loadStations(), loadAssets()]);
    }, kind === 'raster' ? 'Grid processed and stored in object storage.' : 'Observations imported and forecasts refreshed.');
  }

  async function createStation(event) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await withBusy(async () => {
      await api('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) }, token);
      await loadStations(); setShowStationForm(false); formElement.reset();
    }, 'Monitoring station added.');
  }

  async function runForecast() {
    await withBusy(async () => { await api(`/api/forecast-runs?hours=48${selected ? `&station_id=${encodeURIComponent(selected.id)}` : ''}`, { method: 'POST' }, token); await loadAssets(); if (selected) setForecast(await api(`/api/stations/${selected.id}/forecast?hours=48`)); }, 'Forecast run completed.');
  }

  function saveToken(value) { setToken(value); sessionStorage.setItem('rivercast-token', value); }
  const alertCount = useMemo(() => stations.filter((station) => !station.is_demo_data && station.status !== 'normal').length, [stations]);
  const lastUpdate = selected?.observed_at ? dateLabel(selected.observed_at) + ' UTC' : 'No observation yet';
  const combinedForecast = forecast?.points || [];
  const activeForecastPoint = combinedForecast[Math.min(forecastStep, Math.max(0, combinedForecast.length - 1))];
  const chartObserved = observations.slice(-36);

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark">R</span><span><strong>RiverCast</strong><small>HYDRO INTELLIGENCE</small></span></a>
      <div className="topbar-center"><span className="live-dot" /> LIVE MONITORING <span className="topbar-divider">/</span> INDIA RIVER NETWORK</div>
      <div className="topbar-right"><span className="service-state"><i /> {health?.status === 'ok' ? 'Systems operational' : 'Connecting'}</span><a className="docs-link" href="/docs" target="_blank">API docs ↗</a></div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <div className="eyebrow">NETWORK OVERVIEW <span>●</span></div>
        <div className="network-summary"><div><strong>{stations.length.toString().padStart(2, '0')}</strong><small>REGISTERED SITES</small></div><div className="summary-separator" /><div><strong className={alertCount ? 'alert-number' : ''}>{alertCount.toString().padStart(2, '0')}</strong><small>SENSOR ALERTS</small></div></div>
        <div className="section-heading"><span>Monitoring stations</span><button className="icon-button" title="Add station" onClick={() => setShowStationForm((value) => !value)}>＋</button></div>
        <div className="station-list">{stations.map((station) => { const weather = stationWeather[station.id]; return <button className={`station-card ${station.id === selectedId ? 'selected' : ''}`} key={station.id} onClick={() => setSelectedId(station.id)}>
          <span className={`status-pin ${station.is_demo_data ? 'sample' : station.status}`} /><span className="station-info"><strong>{station.name}</strong><small>{station.river} River <span>·</span> {weather ? `${weather.temperature_c?.toFixed(0) ?? '—'}°C · rain ${weather.precipitation_mm?.toFixed(1) ?? '—'} mm` : 'Loading live weather…'}</small></span><span className="station-flow"><b>{fmt.format(station.current_discharge_m3s)}</b><small>{station.is_demo_data ? 'DEMO · ' : ''}m³/s</small></span>
        </button>; })}</div><div className="station-feed-status">{stationWeatherStatus}</div>
        {showStationForm && <form className="inline-form" onSubmit={createStation}><div className="form-title">Add a monitoring site</div><input name="id" placeholder="station-id (lowercase)" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /><input name="name" placeholder="Station name" required /><input name="river" placeholder="River" required /><div className="form-row"><input name="latitude" type="number" step="any" placeholder="Latitude" required /><input name="longitude" type="number" step="any" placeholder="Longitude" required /></div><input name="alert_level_m3s" type="number" min="1" placeholder="Alert threshold (m³/s)" required /><button className="primary-button" disabled={busy}>Save station</button></form>}
        <div className="sidebar-bottom"><div className="section-heading"><span>Data layers</span><span className="layer-count">{rasters.length} GRID{rasters.length === 1 ? '' : 'S'}</span></div>
          <label className="upload-row"><span className="upload-icon">↥</span><span><b>Import observations</b><small>CSV or JSON · up to 5,000 rows</small></span><input type="file" accept=".csv,.json" onChange={(event) => uploadFile(event.target.files?.[0], 'observations')} /></label>
          <label className="upload-row"><span className="upload-icon">▧</span><span><b>Upload raster or grid</b><small>GeoTIFF · NetCDF · GRIB</small></span><input type="file" accept=".tif,.tiff,.nc,.grib,.grb,.grb2" onChange={(event) => uploadFile(event.target.files?.[0], 'raster')} /></label>
          {rasters.map((asset) => asset.tile_url ? <label className="raster-toggle" key={asset.id}><input type="checkbox" checked={!!activeRasters[asset.id]} onChange={(event) => setActiveRasters((current) => ({ ...current, [asset.id]: event.target.checked }))} /><span>{asset.filename}</span><small>COG</small></label> : <div className="raster-failed" key={asset.id}><span>{asset.filename}</span><small>{asset.processing_status || 'failed'}</small></div>)}
        </div>
      </aside>
      <section className="map-panel">
        <div className="map-toolbar"><div><span className="map-title">River network</span><span className="map-subtitle">LIVE WEATHER · CYCLONE LAYERS</span></div><div className="map-actions"><button className="map-action" onClick={() => mapObject.current?.getView().animate({ center: fromLonLat([84.4, 22.8]), zoom: 5, duration: 500 })}>◎ <span>Overview</span></button><button className={`map-action ${liveLayers.rainfall ? 'active' : ''}`} aria-pressed={liveLayers.rainfall} onClick={() => setLiveLayers((state) => ({ ...state, rainfall: !state.rainfall }))}>🌧 <span>Rain heat</span></button><button className={`map-action ${liveLayers.radar ? 'active' : ''}`} aria-pressed={liveLayers.radar} onClick={() => setLiveLayers((state) => ({ ...state, radar: !state.radar }))}>▧ <span>Radar</span></button><button className={`map-action ${liveLayers.cyclones ? 'active' : ''}`} aria-pressed={liveLayers.cyclones} onClick={() => setLiveLayers((state) => ({ ...state, cyclones: !state.cyclones }))}>🌀 <span>Cyclones</span></button><button className="map-action" onClick={() => setActiveRasters(Object.fromEntries(rasters.map((asset) => [asset.id, true])))}>▤ <span>Show grids</span></button></div></div>
        <div className="map-canvas" ref={mapElement}><div className="map-legend"><b>MAP LAYERS</b>{liveLayers.rainfall && <span><i className="weather-legend rainfall-legend" /> Rainfall · model</span>}{liveLayers.radar && <span><i className="weather-legend radar-legend" /> Recent radar</span>}{liveLayers.cyclones && <span><i className="weather-legend cyclone-legend" /> Cyclone alerts</span>}<span><i className="normal" /> Normal station</span><span><i className="watch" /> Watch station</span><span><i className="warning" /> Warning station</span><span><i className="weather-legend sample-legend" /> Sample flow</span><small>© OpenStreetMap · Weather by RainViewer</small></div><div className="scale-pill">{selected ? `${selected.latitude.toFixed(2)}° N  ·  ${selected.longitude.toFixed(2)}° E` : 'Map loading'}</div></div>
        <div className="map-footer"><span><i className="live-dot" /> {liveLayers.radar ? liveMeta.radar || 'Loading radar…' : liveLayers.rainfall ? liveMeta.rainfall || 'Loading rainfall…' : liveLayers.cyclones ? liveMeta.cyclones || 'Loading cyclone alerts…' : 'Live overlays are off'}</span><span>{liveLayers.cyclones && 'GDACS · '}{liveLayers.rainfall && 'Open-Meteo · '}{liveLayers.radar && <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer · </a>}Basemap · OpenStreetMap</span></div>
      </section>
      <aside className="detail-panel">
        <div className="detail-header"><div className="eyebrow">SITE INTELLIGENCE</div><span className={`status-badge ${selected?.is_demo_data ? 'demo' : selected?.status || 'normal'}`}><i />{selected?.is_demo_data ? 'sample' : selected?.status || 'normal'}</span></div>
        {selected ? <>
          <div className="site-title"><h1>{selected.name}</h1><p>{selected.river} River <span>·</span> Gauge station</p></div>
          <div className="flow-card"><div className="flow-card-top"><span>LATEST RIVER FLOW</span><span className={selected.is_demo_data ? 'sample-label' : ''}>{selected.is_demo_data ? 'DEMO SAMPLE' : 'OBSERVATION'}</span></div><div className="flow-value">{fmt.format(selected.current_discharge_m3s)}<small>m³/s</small></div><div className="flow-track"><i style={{ width: `${Math.min(100, selected.current_discharge_m3s / selected.alert_level_m3s * 100)}%`, background: colors[selected.status] }} /></div><div className="flow-range"><span>0</span><span>Alert threshold <b>{fmt.format(selected.alert_level_m3s)} m³/s</b></span></div></div>
          <div className="metadata-grid"><div><small>LAST OBSERVED</small><b>{lastUpdate}</b></div><div><small>LIVE WEATHER · OPEN-METEO</small><b>{selectedWeather ? `${selectedWeather.temperature_c?.toFixed(1) ?? '—'}°C · rain ${selectedWeather.precipitation_mm?.toFixed(1) ?? '—'} mm` : 'Loading…'}</b></div><div><small>WIND · VALID UTC</small><b>{selectedWeather ? `${selectedWeather.wind_speed_kmh?.toFixed(0) ?? '—'} km/h · ${selectedWeather.valid_at || '—'}` : stationWeatherStatus}</b></div><div><small>FORECAST MODEL</small><b>{forecast?.model_name || 'Loading…'}</b></div><div><small>FORECAST WINDOW</small><b>48 hours</b></div><div><small>FLOW DATA PROVENANCE</small><b>{selected.is_demo_data ? 'Illustrative sample' : 'Station observations'}</b></div></div>
          <div className="chart-section"><div className="chart-heading"><div><b>Discharge outlook</b><small>Observed & forecast · m³/s</small></div><button className="run-button" disabled={busy} onClick={runForecast}>↻ Run forecast</button></div><div className="chart-legend"><span><i className="legend-observed" /> Observed</span><span><i className="legend-forecast" /> Forecast</span></div><RiverChart observed={chartObserved} forecast={combinedForecast} /><div className="forecast-timeline"><label>VALID TIME <b>{activeForecastPoint ? dateLabel(activeForecastPoint.valid_at) + ' UTC' : 'Loading forecast'}</b></label><input aria-label="Forecast time step" type="range" min="0" max={Math.max(0, combinedForecast.length - 1)} value={Math.min(forecastStep, Math.max(0, combinedForecast.length - 1))} disabled={!combinedForecast.length} onChange={(event) => setForecastStep(Number(event.target.value))} /><strong>{activeForecastPoint ? `${fmt.format(activeForecastPoint.discharge_m3s)} m³/s` : '—'}</strong></div></div>
          <div className="forecast-note"><span>ⓘ</span><p>{forecast?.is_demo_data ? 'Baseline forecast is illustrative and uncalibrated. Do not use for emergency decisions.' : 'Model outputs require local validation before operational use.'}</p></div>
        </> : <div className="empty-site">Waiting for station data…</div>}
        <div className="run-history"><div className="section-heading"><b>Recent model runs</b><span className="layer-count">{runs.length} RUNS</span></div>{runs.slice(0, 4).map((run) => <div className="run-row" key={run.id}><span className={`run-ok ${run.status === 'failed' ? 'run-failed' : ''}`} title={run.error_message || undefined}>{run.status === 'failed' ? '!' : '✓'}</span><span><b>{run.station_name}</b><small>{run.model_name} · {dateLabel(run.generated_at)} UTC</small>{run.error_message && <small className="run-error" title={run.error_message}>{run.error_message}</small>}</span><small className={`run-status ${run.status === 'failed' ? 'failed' : ''}`}>{run.status}</small></div>)}</div>
      </aside>
    </main>
    <footer className="bottom-bar"><div>RIVERCAST <span>·</span> LOCAL FORECASTING PLATFORM</div><div><label>Write token <input aria-label="API write token" type="password" value={token} onChange={(event) => saveToken(event.target.value)} placeholder={health?.write_auth_enabled ? 'Required for edits' : 'Optional'} /></label><span className="footer-divider" /> <span>PostGIS</span><span className="footer-dot" /><span>MinIO</span><span className="footer-dot" /><span>FastAPI</span></div></footer>
    {(message || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span>{error || message}<button onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
  </div>;
}

export default App;
