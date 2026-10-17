import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import Heatmap from 'ol/layer/Heatmap.js';
import Draw from 'ol/interaction/Draw.js';
import OSM from 'ol/source/OSM.js';
import XYZ from 'ol/source/XYZ.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Cluster from 'ol/source/Cluster.js';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj.js';
import { getArea, getLength } from 'ol/sphere.js';
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

function WeatherStationDetails({ station }) {
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>Live weather station <span>·</span> {station.station_id}</p></div>
    <div className="flow-card"><div className="flow-card-top"><span>OBSERVED TEMPERATURE</span><span className="live-weather-label">LIVE METAR</span></div><div className="flow-value">{station.temperature_c == null ? 'N/A' : station.temperature_c}<small>°C</small></div><div className="weather-observation-note">{station.weather || station.flight_category || 'No significant weather reported'}</div></div>
    <div className="metadata-grid"><div><small>OBSERVATION TIME · UTC</small><b>{station.valid_at ? dateLabel(station.valid_at) + ' UTC' : 'Unavailable'}</b></div><div><small>WIND</small><b>{station.wind_speed_kmh == null ? 'Unavailable' : `${station.wind_speed_kmh.toFixed(0)} km/h`}{station.wind_direction_degrees == null ? '' : ` · ${station.wind_direction_degrees}°`}</b></div><div><small>WIND GUST</small><b>{station.wind_gust_kmh == null ? 'Unavailable' : `${station.wind_gust_kmh.toFixed(0)} km/h`}</b></div><div><small>DEW POINT</small><b>{station.dew_point_c == null ? 'Unavailable' : `${station.dew_point_c}°C`}</b></div><div><small>VISIBILITY</small><b>{station.visibility_km == null ? 'Unavailable' : `${station.visibility_km.toFixed(1)} km`}</b></div><div><small>FLIGHT CATEGORY</small><b>{station.flight_category || 'Unavailable'}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>Measured airport weather observation from the Aviation Weather Center. <a href="https://aviationweather.gov/data/api/" target="_blank" rel="noreferrer">View source</a>{station.raw_report && <small className="metar-raw">{station.raw_report}</small>}</p></div>
  </>;
}

function RiverGaugeDetails({ station }) {
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>Live river gauge <span>·</span> {station.station_id}</p></div>
    <div className="flow-card"><div className="flow-card-top"><span>{station.discharge_m3s == null ? 'LATEST WATER LEVEL' : 'LATEST RIVER FLOW'}</span><span className="live-weather-label">LIVE GAUGE</span></div>{station.discharge_m3s == null ? <div className="flow-value">{station.water_level_m == null ? 'N/A' : station.water_level_m}<small>m</small></div> : <div className="flow-value">{fmt.format(station.discharge_m3s)}<small>m³/s</small></div>}<div className="weather-observation-note">{station.parameter || 'Current provider observation'}{station.qualifier ? ` · ${station.qualifier}` : ''}</div></div>
    <div className="metadata-grid"><div><small>OBSERVED · UTC</small><b>{station.valid_at ? dateLabel(station.valid_at) + ' UTC' : 'Unavailable'}</b></div><div><small>WATER LEVEL</small><b>{station.water_level_m == null ? 'Unavailable' : `${station.water_level_m} m`}</b></div><div><small>DISCHARGE</small><b>{station.discharge_m3s == null ? 'Unavailable' : `${fmt.format(station.discharge_m3s)} m³/s`}</b></div><div><small>PROVIDER</small><b>{station.source}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>Live provider measurement. Reading frequency and units are set by the source agency. <a href={station.source_url} target="_blank" rel="noreferrer">View source</a></p></div>
  </>;
}

function AirQualityDetails({ station }) {
  const readings = Object.entries(station.pollutants || {}).sort(([a], [b]) => a.localeCompare(b));
  return <>
    <div className="site-title"><h1>{station.name}</h1><p>CPCB air monitor · {station.city}, {station.state}</p></div>
    <div className="flow-card air-quality-card"><div className="flow-card-top"><span>REPORTED POLLUTANTS</span><span className="live-weather-label">CPCB</span></div><div className="aq-pollutant-grid">{readings.map(([name, value]) => <div key={name}><small>{name}</small><b>{value.average == null ? 'N/A' : fmt.format(value.average)}</b></div>)}</div><div className="weather-observation-note">Values are reported by CPCB; units are not included in this feed.</div></div>
    <div className="metadata-grid"><div><small>LAST READING</small><b>{station.valid_at || 'Unavailable'}</b></div><div><small>LOCATION</small><b>{station.city}, {station.state}</b></div><div><small>COORDINATES</small><b>{station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}</b></div><div><small>PROVIDER</small><b>{station.source}</b></div></div>
    <div className="forecast-note"><span>ⓘ</span><p>This layer shows the source pollutant readings. It does not calculate or imply an official AQI. <a href={station.source_url} target="_blank" rel="noreferrer">View source</a></p></div>
  </>;
}

function App() {
  const mapElement = useRef(null);
  const mapObject = useRef(null);
  const stationLayer = useRef(null);
  const weatherStationSource = useRef(null);
  const riverGaugeSource = useRef(null);
  const riverGaugeLayer = useRef(null);
  const airQualitySource = useRef(null);
  const airQualityLayer = useRef(null);
  const weatherStationsRef = useRef([]);
  const riverStationsRef = useRef([]);
  const airQualityStationsRef = useRef([]);
  const stationLocationPickRef = useRef(false);
  const measureSource = useRef(null);
  const rasterLayers = useRef([]);
  const liveLayerRefs = useRef({});
  const [stations, setStations] = useState([]);
  const [stationWeather, setStationWeather] = useState({});
  const [weatherStations, setWeatherStations] = useState([]);
  const [activeWeatherStation, setActiveWeatherStation] = useState(null);
  const [riverStations, setRiverStations] = useState([]);
  const [activeRiverStation, setActiveRiverStation] = useState(null);
  const [airQualityStations, setAirQualityStations] = useState([]);
  const [activeAirQualityStation, setActiveAirQualityStation] = useState(null);
  const [airQualityStatus, setAirQualityStatus] = useState('Turn on India air to load CPCB readings.');
  const [riverStationsStatus, setRiverStationsStatus] = useState('Turn on River gauges to load public live flows.');
  const [weatherStationsStatus, setWeatherStationsStatus] = useState('Loading public METAR reports...');
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
  const [pickStationLocation, setPickStationLocation] = useState(false);
  const [newStationCoordinates, setNewStationCoordinates] = useState({ latitude: '', longitude: '' });
  const [forecastStep, setForecastStep] = useState(0);
  const [measureMode, setMeasureMode] = useState(null);
  const [lastMeasurement, setLastMeasurement] = useState('');
  const [liveLayers, setLiveLayers] = useState({ rainfall: false, radar: false, cyclones: false, riverGauges: false, airQuality: false });
  const [liveMeta, setLiveMeta] = useState({});

  const selected = stations.find((station) => station.id === selectedId) || stations[0];
  weatherStationsRef.current = weatherStations;
  riverStationsRef.current = riverStations;
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
    const weatherMarkers = new VectorSource();
    weatherStationSource.current = weatherMarkers;
    const weatherMarkerLayer = new VectorLayer({ source: new Cluster({ distance: 30, source: weatherMarkers }), style: (clusterFeature) => {
      const members = clusterFeature.get('features') || [];
      if (members.length > 1) return new Style({ image: new CircleStyle({ radius: Math.min(15, 8 + Math.log2(members.length)), fill: new Fill({ color: '#174873dd' }), stroke: new Stroke({ color: '#fff', width: 2 }) }), text: new Text({ text: String(members.length), fill: new Fill({ color: '#fff' }), font: '700 10px sans-serif' }) });
      const stationId = members[0]?.get('stationId') || '';
      return [
        new Style({ image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#287fce' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }),
        new Style({ text: new Text({ text: stationId, offsetY: -16, font: '700 9px sans-serif', fill: new Fill({ color: '#174873' }), backgroundFill: new Fill({ color: '#ffffffdf' }), padding: [2, 3, 2, 3] }) }),
      ];
    } });
    const riverMarkers = new VectorSource();
    riverGaugeSource.current = riverMarkers;
    const riverLayer = new VectorLayer({ source: new Cluster({ distance: 32, source: riverMarkers }), style: (clusterFeature) => {
      const members = clusterFeature.get('features') || [];
      if (members.length > 1) return new Style({ image: new CircleStyle({ radius: Math.min(16, 8 + Math.log2(members.length)), fill: new Fill({ color: '#17866ddd' }), stroke: new Stroke({ color: '#fff', width: 2 }) }), text: new Text({ text: String(members.length), fill: new Fill({ color: '#fff' }), font: '700 10px sans-serif' }) });
      const feature = members[0] || clusterFeature;
      return [
        new Style({ image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#17866d' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }),
        new Style({ text: new Text({ text: feature.get('name') || feature.get('stationId') || '', offsetY: -16, font: '700 9px sans-serif', fill: new Fill({ color: '#155748' }), backgroundFill: new Fill({ color: '#ffffffdf' }), padding: [2, 3, 2, 3] }) }),
      ];
    } });
    riverGaugeLayer.current = riverLayer;
    const airMarkers = new VectorSource();
    airQualitySource.current = airMarkers;
    const airLayer = new VectorLayer({ source: new Cluster({ distance: 32, source: airMarkers }), visible: false, style: (clusterFeature) => {
      const members = clusterFeature.get('features') || [];
      if (members.length > 1) return new Style({ image: new CircleStyle({ radius: Math.min(16, 8 + Math.log2(members.length)), fill: new Fill({ color: '#d66b36dd' }), stroke: new Stroke({ color: '#fff', width: 2 }) }), text: new Text({ text: String(members.length), fill: new Fill({ color: '#fff' }), font: '700 10px sans-serif' }) });
      const feature = members[0] || clusterFeature;
      return [
        new Style({ image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#d66b36' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }),
        new Style({ text: new Text({ text: feature.get('name') || '', offsetY: -16, font: '700 9px sans-serif', fill: new Fill({ color: '#85431f' }), backgroundFill: new Fill({ color: '#ffffffdf' }), padding: [2, 3, 2, 3] }) }),
      ];
    } });
    airQualityLayer.current = airLayer;
    const measurements = new VectorSource();
    measureSource.current = measurements;
    const measureLayer = new VectorLayer({ source: measurements, style: new Style({ stroke: new Stroke({ color: '#174db5', width: 4, lineDash: [8, 5] }), fill: new Fill({ color: '#4687ef55' }), image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#174db5' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }), zIndex: 1000 });
    // Keep measurement sketches above weather/raster overlays so they remain visible.
    const map = new Map({ target: mapElement.current, layers: [new TileLayer({ source: new OSM() }), markerLayer, weatherMarkerLayer, riverLayer, airLayer, measureLayer], view: new View({ center: fromLonLat([84.4, 22.8]), zoom: 5, minZoom: 2, maxZoom: 18 }), controls: [] });
    mapObject.current = map;
    map.on('singleclick', (event) => {
      if (stationLocationPickRef.current) {
        const [longitude, latitude] = toLonLat(event.coordinate);
        setNewStationCoordinates({ latitude: latitude.toFixed(5), longitude: longitude.toFixed(5) });
        stationLocationPickRef.current = false;
        setPickStationLocation(false);
        return;
      }
      const airFeature = map.forEachFeatureAtPixel(event.pixel, (item) => item, { layerFilter: (layer) => layer === airLayer });
      if (airFeature) {
        const members = airFeature.get('features') || [];
        if (members.length > 1) {
          map.getView().animate({ center: airFeature.getGeometry().getCoordinates(), zoom: Math.min((map.getView().getZoom() || 2) + 2, 14), duration: 350 });
          return;
        }
        const airStation = members[0] || airFeature;
        setActiveAirQualityStation(airQualityStationsRef.current.find((station) => station.station_id === airStation.get('stationId')) || null);
        setActiveWeatherStation(null);
        setActiveRiverStation(null);
        return;
      }
      const weatherFeature = map.forEachFeatureAtPixel(event.pixel, (item) => item, { layerFilter: (layer) => layer === weatherMarkerLayer });
      if (weatherFeature) {
        const members = weatherFeature.get('features') || [];
        if (members.length > 1) {
          map.getView().animate({ center: weatherFeature.getGeometry().getCoordinates(), zoom: Math.min((map.getView().getZoom() || 2) + 2, 14), duration: 350 });
          return;
        }
        const weatherStationFeature = members[0] || weatherFeature;
        const weatherStationId = weatherStationFeature.get('stationId');
        setActiveWeatherStation(weatherStationsRef.current.find((station) => station.station_id === weatherStationId) || null);
        setActiveRiverStation(null);
        setActiveAirQualityStation(null);
        return;
      }
      const gaugeFeature = map.forEachFeatureAtPixel(event.pixel, (item) => item, { layerFilter: (layer) => layer === riverLayer });
      if (gaugeFeature) {
        const members = gaugeFeature.get('features') || [];
        if (members.length > 1) {
          map.getView().animate({ center: gaugeFeature.getGeometry().getCoordinates(), zoom: Math.min((map.getView().getZoom() || 2) + 2, 14), duration: 350 });
          return;
        }
        const gauge = members[0] || gaugeFeature;
        setActiveRiverStation(riverStationsRef.current.find((station) => station.station_id === gauge.get('stationId')) || null);
        setActiveWeatherStation(null);
        setActiveAirQualityStation(null);
        return;
      }
      const feature = map.forEachFeatureAtPixel(event.pixel, (item) => item, { layerFilter: (layer) => layer === markerLayer });
      if (feature) {
        setSelectedId(feature.get('stationId'));
        setActiveWeatherStation(null);
        setActiveRiverStation(null);
        setActiveAirQualityStation(null);
      }
    });
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
    const map = mapObject.current;
    if (!map) return undefined;
    let cancelled = false;
    let requestSequence = 0;
    let debounceTimer;
    const refresh = async () => {
      const sequence = ++requestSequence;
      try {
        const size = map.getSize();
        if (!size) return;
        let [west, south, east, north] = transformExtent(map.getView().calculateExtent(size), map.getView().getProjection(), 'EPSG:4326');
        const latitudeClamp = (value) => Math.max(-89.9, Math.min(89.9, value));
        const longitudeNormalize = (value) => ((value + 180) % 360 + 360) % 360 - 180;
        south = latitudeClamp(south);
        north = latitudeClamp(north);
        if (north <= south) { south = Math.max(-89.9, south - 0.05); north = Math.min(89.9, north + 0.05); }
        if (east - west >= 360) { west = -180; east = 180; }
        else { west = longitudeNormalize(west); east = longitudeNormalize(east); }
        const query = new URLSearchParams({ south: south.toFixed(4), west: west.toFixed(4), north: north.toFixed(4), east: east.toFixed(4) });
        const response = await api(`/api/live/weather-stations?${query}`);
        if (cancelled || sequence !== requestSequence) return;
        const reports = response.stations || [];
        weatherStationsRef.current = reports;
        setWeatherStations(reports);
        setActiveWeatherStation((current) => current ? reports.find((station) => station.station_id === current.station_id) || current : null);
        setWeatherStationsStatus(`${reports.length} reports in this map view · updated ${dateLabel(response.fetched_at)} UTC`);
      } catch (reason) {
        if (!cancelled && sequence === requestSequence) setWeatherStationsStatus(`Live weather station feed unavailable: ${reason.message}`);
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refresh, 500);
    };
    refresh();
    map.on('moveend', scheduleRefresh);
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => { cancelled = true; map.un('moveend', scheduleRefresh); window.clearTimeout(debounceTimer); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const map = mapObject.current;
    if (!map || !riverGaugeLayer.current) return;
    riverGaugeLayer.current.setVisible(liveLayers.riverGauges);
  }, [liveLayers.riverGauges]);

  useEffect(() => {
    if (!mapObject.current || !airQualityLayer.current) return;
    airQualityLayer.current.setVisible(liveLayers.airQuality);
  }, [liveLayers.airQuality]);

  useEffect(() => {
    const map = mapObject.current;
    if (!map || !airQualitySource.current || !liveLayers.airQuality) return undefined;
    let cancelled = false;
    let debounceTimer;
    let requestSequence = 0;
    const refresh = async () => {
      const sequence = ++requestSequence;
      try {
        const size = map.getSize();
        if (!size) return;
        const [west, south, east, north] = transformExtent(map.getView().calculateExtent(size), map.getView().getProjection(), 'EPSG:4326');
        if (north < 6 || south > 38 || east < 67 || west > 98) {
          airQualitySource.current.clear();
          airQualityStationsRef.current = [];
          setAirQualityStations([]);
          setActiveAirQualityStation(null);
          setAirQualityStatus('Pan or zoom to India to view CPCB air-quality stations.');
          return;
        }
        const query = new URLSearchParams({ south: south.toFixed(4), west: west.toFixed(4), north: north.toFixed(4), east: east.toFixed(4) });
        const response = await api(`/api/live/air-quality-stations?${query}`);
        if (cancelled || sequence !== requestSequence) return;
        const reports = response.stations || [];
        airQualityStationsRef.current = reports;
        setAirQualityStations(reports);
        setActiveAirQualityStation((current) => current ? reports.find((station) => station.station_id === current.station_id) || null : null);
        setAirQualityStatus(response.status === 'api_key_required' ? response.message : `${reports.length} CPCB stations · refreshed ${dateLabel(response.fetched_at)} UTC`);
      } catch (reason) {
        if (!cancelled && sequence === requestSequence) setAirQualityStatus(`CPCB air-quality feed unavailable: ${reason.message}`);
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refresh, 500);
    };
    refresh();
    map.on('moveend', scheduleRefresh);
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; map.un('moveend', scheduleRefresh); window.clearTimeout(debounceTimer); window.clearInterval(timer); };
  }, [liveLayers.airQuality]);

  useEffect(() => {
    if (!mapObject.current || !airQualitySource.current) return;
    const source = airQualitySource.current;
    source.clear();
    airQualityStations.forEach((station) => source.addFeature(new Feature({
      geometry: new Point(fromLonLat([station.longitude, station.latitude])),
      stationId: station.station_id, name: station.name,
    })));
  }, [airQualityStations]);

  useEffect(() => {
    const map = mapObject.current;
    if (!map || !riverGaugeSource.current || !liveLayers.riverGauges) return undefined;
    let cancelled = false;
    let debounceTimer;
    let requestSequence = 0;
    const refresh = async () => {
      const sequence = ++requestSequence;
      try {
        const size = map.getSize();
        if (!size) return;
        let [west, south, east, north] = transformExtent(map.getView().calculateExtent(size), map.getView().getProjection(), 'EPSG:4326');
        south = Math.max(-89.9, Math.min(89.9, south));
        north = Math.max(-89.9, Math.min(89.9, north));
        const query = new URLSearchParams({ south: south.toFixed(4), west: west.toFixed(4), north: north.toFixed(4), east: east.toFixed(4) });
        const response = await api(`/api/live/river-stations?${query}`);
        if (cancelled || sequence !== requestSequence) return;
        const gauges = response.stations || [];
        riverStationsRef.current = gauges;
        setRiverStations(gauges);
        setActiveRiverStation((current) => current ? gauges.find((station) => station.station_id === current.station_id) || null : null);
        const count = gauges.length;
        const activeProviders = (response.providers || []).filter((provider) => provider.status === 'ok').map((provider) => provider.id);
        setRiverStationsStatus(count ? `${count} live gauges · ${activeProviders.join(', ')}` : `No supported live gauges in this view · ${activeProviders.join(', ') || 'providers unavailable'}`);
      } catch (reason) {
        if (!cancelled && sequence === requestSequence) setRiverStationsStatus(`Live river feeds unavailable: ${reason.message}`);
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refresh, 500);
    };
    refresh();
    map.on('moveend', scheduleRefresh);
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; map.un('moveend', scheduleRefresh); window.clearTimeout(debounceTimer); window.clearInterval(timer); };
  }, [liveLayers.riverGauges]);

  useEffect(() => {
    if (!mapObject.current || !riverGaugeSource.current) return;
    const source = riverGaugeSource.current;
    source.clear();
    riverStations.forEach((station) => source.addFeature(new Feature({
      geometry: new Point(fromLonLat([station.longitude, station.latitude])),
      stationId: station.station_id, name: station.name,
    })));
  }, [riverStations]);

  useEffect(() => {
    const map = mapObject.current;
    if (!map || !measureSource.current || !measureMode) return undefined;
    const draw = new Draw({ source: measureSource.current, type: measureMode, stopClick: true });
    draw.on('drawend', ({ feature }) => {
      const geometry = feature.getGeometry();
      if (measureMode === 'LineString') {
        const meters = getLength(geometry);
        setLastMeasurement(meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`);
      } else {
        const squareMeters = getArea(geometry);
        setLastMeasurement(squareMeters >= 1_000_000 ? `${(squareMeters / 1_000_000).toFixed(2)} km²` : `${squareMeters.toFixed(0)} m²`);
      }
    });
    map.addInteraction(draw);
    return () => map.removeInteraction(draw);
  }, [measureMode]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setObservations([]);
      setForecast(null);
      return undefined;
    }
    const stationId = selected.id;
    setForecastStep(0);
    setObservations([]);
    setForecast(null);
    const refresh = async () => {
      try {
        const [history, prediction, stationRows] = await Promise.all([
          api(`/api/stations/${stationId}/observations?hours=168`),
          api(`/api/stations/${stationId}/forecast?hours=48`),
          api('/api/stations'),
        ]);
        if (cancelled) return;
        setObservations(history.points || []);
        setForecast(prediction);
        setStations(stationRows);
        setError('');
      } catch (reason) {
        if (!cancelled) setError(reason.message);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
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
    if (!mapObject.current || !weatherStationSource.current) return;
    const source = weatherStationSource.current;
    source.clear();
    weatherStations.forEach((station) => source.addFeature(new Feature({
      geometry: new Point(fromLonLat([station.longitude, station.latitude])),
      stationId: station.station_id,
    })));
  }, [weatherStations]);

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

  function toggleStationForm() {
    const next = !showStationForm;
    setShowStationForm(next);
    if (!next) {
      stationLocationPickRef.current = false;
      setPickStationLocation(false);
    }
  }

  function startStationLocationPick() {
    setMeasureMode(null);
    stationLocationPickRef.current = true;
    setPickStationLocation(true);
  }

  function cancelStationLocationPick() {
    stationLocationPickRef.current = false;
    setPickStationLocation(false);
  }

  async function createStation(event) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await withBusy(async () => {
      const station = Object.fromEntries(form);
      await api('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(station) }, token);
      await loadStations(); setSelectedId(station.id); setActiveWeatherStation(null); setActiveRiverStation(null);
      mapObject.current?.getView().animate({ center: fromLonLat([Number(station.longitude), Number(station.latitude)]), zoom: Math.max(mapObject.current?.getView().getZoom() || 5, 7), duration: 450 });
      setShowStationForm(false); setNewStationCoordinates({ latitude: '', longitude: '' }); cancelStationLocationPick(); formElement.reset();
    }, 'Monitoring station added.');
  }

  async function runForecast() {
    await withBusy(async () => { await api(`/api/forecast-runs?hours=48${selected ? `&station_id=${encodeURIComponent(selected.id)}` : ''}`, { method: 'POST' }, token); await loadAssets(); if (selected) setForecast(await api(`/api/stations/${selected.id}/forecast?hours=48`)); }, 'Forecast run completed.');
  }

  function locateUser() {
    if (!navigator.geolocation) { setError('This browser does not provide location access.'); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapObject.current?.getView().animate({ center: fromLonLat([coords.longitude, coords.latitude]), zoom: 10, duration: 500 });
      setMessage('Map centered on your location.');
    }, (reason) => setError(reason.message || 'Could not read your location.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
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
        <div className="section-heading"><span>Monitoring stations</span></div>
        <div className="station-list">{stations.map((station) => { const weather = stationWeather[station.id]; return <button className={`station-card ${station.id === selectedId ? 'selected' : ''}`} key={station.id} onClick={() => { setSelectedId(station.id); setActiveWeatherStation(null); }}>
          <span className={`status-pin ${station.is_demo_data ? 'sample' : station.status}`} /><span className="station-info"><strong>{station.name}</strong><small>{station.river} River <span>·</span> {weather ? `${weather.temperature_c?.toFixed(0) ?? '—'}°C · rain ${weather.precipitation_mm?.toFixed(1) ?? '—'} mm` : 'Loading live weather…'}</small></span><span className="station-flow"><b>{fmt.format(station.current_discharge_m3s)}</b><small>{station.is_demo_data ? 'DEMO · ' : ''}m³/s</small></span>
        </button>; })}</div><div className="station-feed-status">{stationWeatherStatus}</div>
        <div className="weather-station-section"><div className="section-heading"><span>Live weather stations</span><span className="layer-count">{weatherStations.length} METAR</span></div><div className="station-feed-status">{weatherStationsStatus}</div>{weatherStations.slice(0, 6).map((weatherStation) => <button className="weather-station-row" key={weatherStation.station_id} onClick={() => { setActiveWeatherStation(weatherStation); setActiveRiverStation(null); const map = mapObject.current; if (map) map.getView().animate({ center: fromLonLat([weatherStation.longitude, weatherStation.latitude]), zoom: Math.max(map.getView().getZoom() || 5, 7), duration: 450 }); }}><span className="weather-station-pin" /><span><b>{weatherStation.name}</b><small>{weatherStation.station_id} · {weatherStation.valid_at ? dateLabel(weatherStation.valid_at) + ' UTC' : 'time unavailable'}</small></span><strong>{weatherStation.temperature_c == null ? 'N/A' : `${weatherStation.temperature_c}°C`}</strong></button>)}{!weatherStations.length && <div className="weather-station-empty">No current METAR reports in this map view.</div>}</div>

        <div className="river-gauge-section"><div className="section-heading"><span>Live river gauges</span><span className="layer-count">{riverStations.length} LIVE</span></div><div className="station-feed-status">{riverStationsStatus}</div>{riverStations.slice(0, 8).map((station) => <button className="river-gauge-row" key={station.station_id} onClick={() => { setActiveRiverStation(station); setActiveWeatherStation(null); setActiveAirQualityStation(null); const map = mapObject.current; if (map) map.getView().animate({ center: fromLonLat([station.longitude, station.latitude]), zoom: Math.max(map.getView().getZoom() || 5, 7), duration: 450 }); }}><span className="river-gauge-pin" /><span><b>{station.name}</b><small>{station.source} / {station.valid_at ? dateLabel(station.valid_at) + ' UTC' : 'time unavailable'}</small></span><strong>{station.discharge_m3s == null ? (station.water_level_m == null ? 'N/A' : `${station.water_level_m} m`) : `${fmt.format(station.discharge_m3s)} m3/s`}</strong></button>)}{!riverStations.length && liveLayers.riverGauges && <div className="weather-station-empty">Pan or zoom to the US, Canada, or England for public gauges.</div>}</div>
        <div className="air-quality-section"><div className="section-heading"><span>India air quality</span><span className="layer-count">{airQualityStations.length} CPCB</span></div><div className="station-feed-status">{airQualityStatus}</div>{airQualityStations.slice(0, 6).map((station) => { const particulate = station.pollutants?.['PM2.5'] || station.pollutants?.PM10; return <button className="air-quality-row" key={station.station_id} onClick={() => { setActiveAirQualityStation(station); setActiveWeatherStation(null); setActiveRiverStation(null); const map = mapObject.current; if (map) map.getView().animate({ center: fromLonLat([station.longitude, station.latitude]), zoom: Math.max(map.getView().getZoom() || 5, 7), duration: 450 }); }}><span className="air-quality-pin" /><span><b>{station.name}</b><small>{station.city}, {station.state} · {particulate?.valid_at || 'time unavailable'}</small></span><strong>{particulate?.average == null ? '—' : fmt.format(particulate.average)}</strong></button>; })}{!airQualityStations.length && liveLayers.airQuality && airQualityStatus.includes('Pan or zoom') && <div className="weather-station-empty">Pan or zoom to India to view station readings.</div>}</div>
        <div className="sidebar-bottom"><div className="section-heading"><span>Data layers</span><span className="layer-count">{rasters.length} GRID{rasters.length === 1 ? '' : 'S'}</span></div>
          <label className="upload-row"><span className="upload-icon">↥</span><span><b>Import observations</b><small>CSV or JSON · up to 5,000 rows</small></span><input type="file" accept=".csv,.json" onChange={(event) => uploadFile(event.target.files?.[0], 'observations')} /></label>
          <label className="upload-row"><span className="upload-icon">▧</span><span><b>Upload raster or grid</b><small>GeoTIFF · NetCDF · GRIB</small></span><input type="file" accept=".tif,.tiff,.nc,.grib,.grb,.grb2" onChange={(event) => uploadFile(event.target.files?.[0], 'raster')} /></label>
          {rasters.map((asset) => asset.tile_url ? <label className="raster-toggle" key={asset.id}><input type="checkbox" checked={!!activeRasters[asset.id]} onChange={(event) => setActiveRasters((current) => ({ ...current, [asset.id]: event.target.checked }))} /><span>{asset.filename}</span><small>COG</small></label> : <div className="raster-failed" key={asset.id}><span>{asset.filename}</span><small>{asset.processing_status || 'failed'}</small></div>)}
        </div>
      </aside>
      <section className="map-panel">
        <div className="map-toolbar"><div><span className="map-title">River network</span><span className="map-subtitle">LIVE WEATHER · CYCLONE LAYERS</span></div><div className="map-actions"><button className="map-action" onClick={() => mapObject.current?.getView().animate({ center: fromLonLat([84.4, 22.8]), zoom: 5, duration: 500 })}>◎ <span>Overview</span></button><button className="map-action" onClick={locateUser} title="Center map on your location">⌖ <span>My location</span></button><button className={`map-action ${measureMode === 'LineString' ? 'active' : ''}`} aria-pressed={measureMode === 'LineString'} onClick={() => setMeasureMode((mode) => mode === 'LineString' ? null : 'LineString')}>↗ <span>Distance</span></button><button className={`map-action ${measureMode === 'Polygon' ? 'active' : ''}`} aria-pressed={measureMode === 'Polygon'} onClick={() => setMeasureMode((mode) => mode === 'Polygon' ? null : 'Polygon')}>▱ <span>Area</span></button><button className="map-action" onClick={() => { measureSource.current?.clear(); setLastMeasurement(''); }}>× <span>Clear measure</span></button><button className={`map-action ${liveLayers.rainfall ? 'active' : ''}`} aria-pressed={liveLayers.rainfall} onClick={() => setLiveLayers((state) => ({ ...state, rainfall: !state.rainfall }))}>🌧 <span>Rain heat</span></button><button className={`map-action ${liveLayers.radar ? 'active' : ''}`} aria-pressed={liveLayers.radar} onClick={() => setLiveLayers((state) => ({ ...state, radar: !state.radar }))}>▧ <span>Radar</span></button><button className={`map-action ${liveLayers.cyclones ? 'active' : ''}`} aria-pressed={liveLayers.cyclones} onClick={() => setLiveLayers((state) => ({ ...state, cyclones: !state.cyclones }))}>🌀 <span>Cyclones</span></button><button className="map-action" onClick={() => setActiveRasters(Object.fromEntries(rasters.map((asset) => [asset.id, true])))}>▤ <span>Show grids</span></button><button className={`map-action ${liveLayers.riverGauges ? 'active' : ''}`} aria-pressed={liveLayers.riverGauges} onClick={() => { const enable = !liveLayers.riverGauges; setLiveLayers((state) => ({ ...state, riverGauges: enable })); if (enable) mapObject.current?.getView().animate({ center: fromLonLat([0, 15]), zoom: 2, duration: 500 }); }}><span>River gauges</span></button><button className={`map-action ${liveLayers.airQuality ? 'active' : ''}`} aria-pressed={liveLayers.airQuality} onClick={() => { const enable = !liveLayers.airQuality; setLiveLayers((state) => ({ ...state, airQuality: enable })); if (enable) mapObject.current?.getView().animate({ center: fromLonLat([84.4, 22.8]), zoom: 5, duration: 450 }); }}><span>India air</span></button></div></div>
        <div className={`map-canvas ${pickStationLocation ? "location-picking" : ""}`} ref={mapElement}>{pickStationLocation && <div className="pick-hint" role="status">Click the map to set the coordinates<button type="button" onClick={cancelStationLocationPick}>Cancel</button></div>}<div className="map-legend"><b>MAP LAYERS</b><span><i className="weather-legend metar-legend" /> Live METAR observation</span>{liveLayers.riverGauges && <span><i className="river-gauge-legend" /> Live river gauges: USGS, Canada, England</span>}{liveLayers.airQuality && <span><i className="air-quality-legend" /> CPCB air monitors</span>}{liveLayers.rainfall && <span><i className="weather-legend rainfall-legend" /> Rainfall · model</span>}{liveLayers.radar && <span><i className="weather-legend radar-legend" /> Recent radar</span>}{liveLayers.cyclones && <span><i className="weather-legend cyclone-legend" /> Cyclone alerts</span>}<span><i className="normal" /> Normal station</span><span><i className="watch" /> Watch station</span><span><i className="warning" /> Warning station</span><span><i className="weather-legend sample-legend" /> Sample flow</span><small>© OpenStreetMap · weather observations: Aviation Weather Center METAR</small></div><div className="scale-pill">{selected ? `${selected.latitude.toFixed(2)}° N  ·  ${selected.longitude.toFixed(2)}° E` : 'Map loading'}</div>{measureMode && <div className="measure-hint" role="status">{measureMode === 'LineString' ? 'Distance' : 'Area'}: click map points, then double-click to finish{lastMeasurement ? ` · Result: ${lastMeasurement}` : ''}<button type="button" onClick={() => setMeasureMode(null)}>Done</button></div>}</div>
        <div className="map-footer"><span><i className="live-dot" /> {liveLayers.radar ? liveMeta.radar || 'Loading radar…' : liveLayers.rainfall ? liveMeta.rainfall || 'Loading rainfall…' : liveLayers.cyclones ? liveMeta.cyclones || 'Loading cyclone alerts…' : 'Live overlays are off'}</span><span>{liveLayers.cyclones && 'GDACS · '}{liveLayers.rainfall && 'Open-Meteo · '}{liveLayers.radar && <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer · </a>}Basemap · OpenStreetMap</span></div>
      </section>
      <aside className="detail-panel">
        <div className="detail-header"><div className="eyebrow">SITE INTELLIGENCE{activeAirQualityStation ? ` · ${activeAirQualityStation.station_id}` : activeWeatherStation ? ` · ${activeWeatherStation.station_id}` : activeRiverStation ? ` · ${activeRiverStation.station_id}` : ''}</div><button type="button" className="site-add-button" onClick={toggleStationForm}>{showStationForm ? 'Cancel' : '+ Add site'}</button></div>
        {showStationForm ? <form className="inline-form site-create-form" onSubmit={createStation}><div className="form-title">Add a monitoring site</div><button type="button" className="pick-location-button" onClick={startStationLocationPick}>Pick location on map</button><input name="id" placeholder="station-id (lowercase)" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /><input name="name" placeholder="Station name" required /><input name="river" placeholder="River" required /><div className="form-row"><input name="latitude" type="number" min="-90" max="90" step="any" placeholder="Latitude" value={newStationCoordinates.latitude} onChange={(event) => setNewStationCoordinates((current) => ({ ...current, latitude: event.target.value }))} required /><input name="longitude" type="number" min="-180" max="180" step="any" placeholder="Longitude" value={newStationCoordinates.longitude} onChange={(event) => setNewStationCoordinates((current) => ({ ...current, longitude: event.target.value }))} required /></div><input name="alert_level_m3s" type="number" min="1" placeholder="Alert threshold (m3/s)" required /><button className="primary-button" disabled={busy}>Save station</button></form> : activeAirQualityStation ? <AirQualityDetails station={activeAirQualityStation} /> : activeWeatherStation ? <WeatherStationDetails station={activeWeatherStation} /> : activeRiverStation ? <RiverGaugeDetails station={activeRiverStation} /> : selected ? <>
          <div className="site-title"><h1>{selected.name}</h1><p>{selected.river} River <span>·</span> Gauge station</p></div>
          <div className="flow-card"><div className="flow-card-top"><span>LATEST RIVER FLOW</span><span className={selected.is_demo_data ? 'sample-label' : ''}>{selected.is_demo_data ? 'DEMO SAMPLE' : 'OBSERVATION'}</span></div><div className="flow-value">{fmt.format(selected.current_discharge_m3s)}<small>m³/s</small></div><div className="flow-track"><i style={{ width: `${Math.min(100, selected.current_discharge_m3s / selected.alert_level_m3s * 100)}%`, background: colors[selected.status] }} /></div><div className="flow-range"><span>0</span><span>Alert threshold <b>{fmt.format(selected.alert_level_m3s)} m³/s</b></span></div></div>
          <div className="metadata-grid"><div><small>LAST OBSERVED</small><b>{lastUpdate}</b></div><div><small>MODEL WEATHER · OPEN-METEO</small><b>{selectedWeather ? `${selectedWeather.temperature_c?.toFixed(1) ?? '—'}°C · rain ${selectedWeather.precipitation_mm?.toFixed(1) ?? '—'} mm` : 'Loading…'}</b></div><div><small>WIND · VALID UTC</small><b>{selectedWeather ? `${selectedWeather.wind_speed_kmh?.toFixed(0) ?? '—'} km/h · ${selectedWeather.valid_at || '—'}` : stationWeatherStatus}</b></div><div><small>FORECAST MODEL</small><b>{forecast?.model_name || 'Loading…'}</b></div><div><small>FORECAST WINDOW</small><b>48 hours</b></div><div><small>FLOW DATA PROVENANCE</small><b>{selected.is_demo_data ? 'Illustrative sample' : 'Station observations'}</b></div></div>
          <div className="chart-section"><div className="chart-heading"><div><b>Discharge outlook</b><small>Observed & forecast · m³/s</small></div><button className="run-button" disabled={busy} onClick={runForecast}>↻ Run forecast</button></div><div className="chart-legend"><span><i className="legend-observed" /> Observed</span><span><i className="legend-forecast" /> Forecast</span></div><RiverChart observed={chartObserved} forecast={combinedForecast} /><div className="forecast-timeline"><label>VALID TIME <b>{activeForecastPoint ? dateLabel(activeForecastPoint.valid_at) + ' UTC' : 'Loading forecast'}</b></label><input aria-label="Forecast time step" type="range" min="0" max={Math.max(0, combinedForecast.length - 1)} value={Math.min(forecastStep, Math.max(0, combinedForecast.length - 1))} disabled={!combinedForecast.length} onChange={(event) => setForecastStep(Number(event.target.value))} /><strong>{activeForecastPoint ? `${fmt.format(activeForecastPoint.discharge_m3s)} m³/s` : '—'}</strong></div></div>
          <div className="forecast-note"><span>ⓘ</span><p>{forecast?.is_demo_data ? 'Baseline forecast is illustrative and uncalibrated. Do not use for emergency decisions.' : 'Model outputs require local validation before operational use.'}</p></div>
        </> : <div className="empty-site">Waiting for station data…</div>}
        {!activeAirQualityStation && !activeWeatherStation && !activeRiverStation && !showStationForm && <div className="run-history"><div className="section-heading"><b>Recent model runs</b><span className="layer-count">{runs.length} RUNS</span></div>{runs.slice(0, 4).map((run) => <div className="run-row" key={run.id}><span className={`run-ok ${run.status === 'failed' ? 'run-failed' : ''}`} title={run.error_message || undefined}>{run.status === 'failed' ? '!' : '✓'}</span><span><b>{run.station_name}</b><small>{run.model_name} · {dateLabel(run.generated_at)} UTC</small>{run.error_message && <small className="run-error" title={run.error_message}>{run.error_message}</small>}</span><small className={`run-status ${run.status === 'failed' ? 'failed' : ''}`}>{run.status}</small></div>)}</div>}
      </aside>
    </main>
    <footer className="bottom-bar"><div>RIVERCAST <span>·</span> LOCAL FORECASTING PLATFORM</div><div><label>Write token <input aria-label="API write token" type="password" value={token} onChange={(event) => saveToken(event.target.value)} placeholder={health?.write_auth_enabled ? 'Required for edits' : 'Optional'} /></label><span className="footer-divider" /> <span>PostGIS</span><span className="footer-dot" /><span>MinIO</span><span className="footer-dot" /><span>FastAPI</span></div></footer>
    {(message || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span>{error || message}<button onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
  </div>;
}

export default App;
