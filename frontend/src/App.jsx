import { useCallback, useEffect, useMemo, useState } from 'react';
import 'ol/ol.css';
import StationSidebar from './components/StationSidebar.jsx';
import { DashboardHeader, DashboardFooter } from './components/DashboardChrome.jsx';
import StationDetailsPanel from './components/StationDetailsPanel.jsx';
import MapWorkspace from './components/MapWorkspace.jsx';
import { fmt, dateLabel } from './components/formatters.js';
import { api } from './services/api.js';
import useRiverCastMap from './hooks/useRiverCastMap.js';

const colors = { normal: '#30977b', watch: '#e8a942', warning: '#e06553' };


function App() {
  const [stations, setStations] = useState([]);
  const [stationQuery, setStationQuery] = useState('');
  const [sidebarTab, setSidebarTab] = useState('sites');
  const [mobileView, setMobileView] = useState('map');
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
  const [airHeatRadius, setAirHeatRadius] = useState(18);
  const [airHeatBlur, setAirHeatBlur] = useState(24);
  const [liveLayers, setLiveLayers] = useState({ rainfall: false, radar: false, cyclones: false, riverGauges: false, airQuality: true, waterways: true });
  const [liveMeta, setLiveMeta] = useState({});

  const selected = stations.find((station) => station.id === selectedId) || stations[0];
  const visibleStations = useMemo(() => {
    const query = stationQuery.trim().toLocaleLowerCase();
    return stations.filter((station) => !query || `${station.name} ${station.river} ${station.id}`.toLocaleLowerCase().includes(query));
  }, [stations, stationQuery]);
  const selectedWeather = selected ? stationWeather[selected.id] : null;
  useEffect(() => {
    const frame = requestAnimationFrame(() => mapObject.current?.updateSize());
    return () => cancelAnimationFrame(frame);
  }, [mobileView]);
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

  const { mapElement, mapObject, measureSource, setStationLocationPicking } = useRiverCastMap({
    stations,
    selected,
    selectedId,
    loadStations,
    loadAssets,
    setStations,
    setSelectedId,
    setError,
    setNewStationCoordinates,
    setPickStationLocation,
    setActiveAirQualityStation,
    setActiveWeatherStation,
    setActiveRiverStation,
    stationWeather,
    setStationWeather,
    setStationWeatherStatus,
    weatherStations,
    setWeatherStations,
    setWeatherStationsStatus,
    riverStations,
    setRiverStations,
    setRiverStationsStatus,
    airQualityStations,
    setAirQualityStations,
    setAirQualityStatus,
    liveLayers,
    airHeatRadius,
    airHeatBlur,
    setLiveMeta,
    measureMode,
    setLastMeasurement,
    observations,
    setObservations,
    forecast,
    setForecast,
    setForecastStep,
    rasters,
    activeRasters
  });


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
      setStationLocationPicking(false);
      setPickStationLocation(false);
    }
  }

  function startStationLocationPick() {
    setMeasureMode(null);
    setStationLocationPicking(true);
    setPickStationLocation(true);
  }

  function cancelStationLocationPick() {
    setStationLocationPicking(false);
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
    <DashboardHeader
      health={health}
      stations={stations}
      weatherStations={weatherStations}
      riverStations={riverStations}
      alertCount={alertCount}
      mobileView={mobileView}
      setMobileView={setMobileView}
    />
    <main className={`workspace mobile-${mobileView}`}>
      <StationSidebar
        sidebarTab={sidebarTab}
        setSidebarTab={setSidebarTab}
        stations={stations}
        weatherStations={weatherStations}
        riverStations={riverStations}
        airQualityStations={airQualityStations}
        rasters={rasters}
        stationQuery={stationQuery}
        setStationQuery={setStationQuery}
        visibleStations={visibleStations}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        setActiveWeatherStation={setActiveWeatherStation}
        setActiveRiverStation={setActiveRiverStation}
        setActiveAirQualityStation={setActiveAirQualityStation}
        stationWeather={stationWeather}
        stationWeatherStatus={stationWeatherStatus}
        weatherStationsStatus={weatherStationsStatus}
        riverStationsStatus={riverStationsStatus}
        airQualityStatus={airQualityStatus}
        liveLayers={liveLayers}
        mapObject={mapObject}
        uploadFile={uploadFile}
        activeRasters={activeRasters}
        setActiveRasters={setActiveRasters}
        toggleStationForm={toggleStationForm}
      />
      <MapWorkspace
        mapObject={mapObject}
        locateUser={locateUser}
        measureMode={measureMode}
        setMeasureMode={setMeasureMode}
        measureSource={measureSource}
        liveLayers={liveLayers}
        setLiveLayers={setLiveLayers}
        rasters={rasters}
        setActiveRasters={setActiveRasters}
        mapElement={mapElement}
        pickStationLocation={pickStationLocation}
        cancelStationLocationPick={cancelStationLocationPick}
        airHeatBlur={airHeatBlur}
        setAirHeatBlur={setAirHeatBlur}
        airHeatRadius={airHeatRadius}
        setAirHeatRadius={setAirHeatRadius}
        selected={selected}
        lastMeasurement={lastMeasurement}
        setLastMeasurement={setLastMeasurement}
        liveMeta={liveMeta}
      />
      <StationDetailsPanel
        activeAirQualityStation={activeAirQualityStation}
        activeWeatherStation={activeWeatherStation}
        activeRiverStation={activeRiverStation}
        runs={runs}
        showStationForm={showStationForm}
        toggleStationForm={toggleStationForm}
        createStation={createStation}
        startStationLocationPick={startStationLocationPick}
        pickStationLocation={pickStationLocation}
        cancelStationLocationPick={cancelStationLocationPick}
        newStationCoordinates={newStationCoordinates}
        setNewStationCoordinates={setNewStationCoordinates}
        busy={busy}
        selected={selected}
        lastUpdate={lastUpdate}
        selectedWeather={selectedWeather}
        stationWeatherStatus={stationWeatherStatus}
        forecast={forecast}
        chartObserved={chartObserved}
        combinedForecast={combinedForecast}
        runForecast={runForecast}
        forecastStep={forecastStep}
        setForecastStep={setForecastStep}
        activeForecastPoint={activeForecastPoint}
        fmt={fmt}
        colors={colors}
      />
    </main>
    <DashboardFooter
      health={health}
      token={token}
      saveToken={saveToken}
      message={message}
      error={error}
      setMessage={setMessage}
      setError={setError}
    />
  </div>;
}

export default App;
