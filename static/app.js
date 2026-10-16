const state = { stations: [], selectedId: null, forecast: null, observations: null, map: null, markers: new Map(), rasterLayers: new Map(), layerControl: null, writeAuthEnabled: false };
const colors = { normal: '#45a97e', watch: '#dfa63b', warning: '#d87363' };

const byId = (id) => document.getElementById(id);
const formatTime = (value) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value));
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed (${response.status})`);
  }
  return response.json();
}

function stationIcon(status, active = false) {
  const color = colors[status] || colors.normal;
  const size = active ? 28 : 22;
  return L.divIcon({
    className: 'station-marker',
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 9px #173d3044,0 0 0 5px ${color}26"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function initMap() {
  state.map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([22.8, 84.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);
  state.map.on('click', () => state.map.scrollWheelZoom.enable());
}

async function refreshRasterLayers(activateLatest = false) {
  const assets = await getJson('/api/data/gridded').catch(() => []);
  if (state.layerControl) state.map.removeControl(state.layerControl);
  state.rasterLayers.forEach((layer) => state.map.removeLayer(layer));
  state.rasterLayers.clear();
  const overlays = {};
  assets.filter((asset) => asset.tile_url).forEach((asset) => {
    const layer = L.tileLayer(asset.tile_url, { opacity: 0.68, maxZoom: 18, attribution: 'RiverCast raster' });
    const label = `Raster ${String(asset.id).slice(0, 6)}`;
    state.rasterLayers.set(label, layer);
    overlays[label] = layer;
  });
  if (Object.keys(overlays).length) {
    state.layerControl = L.control.layers(null, overlays, { collapsed: true, position: 'topright' }).addTo(state.map);
    if (activateLatest) {
      const latest = [...state.rasterLayers.values()].at(-1);
      latest?.addTo(state.map);
    }
  }
}

function renderStations() {
  const list = byId('station-list');
  list.replaceChildren();
  state.stations.forEach((station) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `station-item${station.id === state.selectedId ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(station.id === state.selectedId));
    const dot = document.createElement('span');
    dot.className = `station-status ${station.status}`;
    const copy = document.createElement('span');
    copy.className = 'station-copy';
    const name = document.createElement('strong');
    name.textContent = station.name;
    const river = document.createElement('small');
    river.textContent = station.observed_at ? `${station.river} River` : 'Awaiting readings';
    copy.append(name, river);
    const arrow = document.createElement('span');
    arrow.className = 'station-arrow';
    arrow.textContent = '>';
    button.append(dot, copy, arrow);
    button.addEventListener('click', () => selectStation(station.id, true));
    list.append(button);

    let marker = state.markers.get(station.id);
    if (!marker) {
      marker = L.marker([station.latitude, station.longitude], { icon: stationIcon(station.status) }).addTo(state.map);
      marker.on('click', () => selectStation(station.id, false));
      state.markers.set(station.id, marker);
    }
    const popup = document.createElement('div');
    const popupTitle = document.createElement('div');
    popupTitle.className = 'popup-title';
    popupTitle.textContent = `${station.name} - ${station.river}`;
    const popupDetail = document.createElement('div');
    popupDetail.className = 'popup-detail';
    popupDetail.textContent = station.observed_at ? `${numberFormat.format(station.current_discharge_m3s)} m3/s - ${station.status}` : 'Awaiting first observation';
    popup.append(popupTitle, popupDetail);
    marker.bindPopup(popup);
    marker.setIcon(stationIcon(station.status, station.id === state.selectedId));
  });

  byId('network-count').textContent = `${state.stations.length} stations configured`;
  byId('metric-sites').textContent = state.stations.length;
  const reporting = state.stations.filter((station) => station.observed_at);
  byId('metric-normal').textContent = reporting.filter((station) => station.status === 'normal').length;
  byId('metric-attention').textContent = reporting.filter((station) => station.status !== 'normal').length;
  const basinCount = new Set(state.stations.map((station) => station.river)).size;
  document.querySelector('.metric-card:first-child .metric-note').innerHTML = `<span class="note-dot green"></span>Across ${basinCount} river basins`;
  byId('normal-note').textContent = `${state.stations.length - reporting.length} awaiting readings`;
}

async function selectStation(stationId, panToStation) {
  state.selectedId = stationId;
  renderStations();
  const station = state.stations.find((item) => item.id === stationId);
  if (!station) return;
  byId('metric-current').textContent = numberFormat.format(station.current_discharge_m3s);
  byId('updated-at').textContent = station.observed_at ? formatTime(station.observed_at) : 'No reading';
  byId('forecast-subtitle').textContent = `${station.name}, ${station.river} River · forecast issued ${formatDate(new Date())}`;
  if (panToStation) {
    state.map.flyTo([station.latitude, station.longitude], Math.max(state.map.getZoom(), 6), { duration: 0.6 });
    state.markers.get(stationId)?.openPopup();
  }
  try {
    const safeId = encodeURIComponent(stationId);
    [state.forecast, state.observations] = await Promise.all([
      getJson(`/api/stations/${safeId}/forecast?hours=48`),
      getJson(`/api/stations/${safeId}/observations?hours=720`),
    ]);
    drawChart();
  } catch (error) {
    showToast(error.message);
    byId('forecast-chart').innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="axis-label">Forecast data could not be loaded.</text>';
  }
}

function drawChart() {
  const isObserved = byId('series-select').value === 'observations';
  const series = isObserved ? state.observations : state.forecast;
  const forecastPoints = series?.points || [];
  const svg = byId('forecast-chart');
  if (!forecastPoints.length) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" class="axis-label">${isObserved ? 'No observations in the selected period.' : 'Forecast is not available.'}</text>`;
    byId('time-readout').textContent = '—';
    byId('value-readout').textContent = '—';
    return;
  }
  const variable = byId('variable-select').value;
  const isRain = variable === 'rainfall';
  const values = forecastPoints.map((point) => isRain ? point.rainfall_mm : point.discharge_m3s);
  const slider = byId('time-slider');
  slider.max = String(values.length - 1);
  const selectedIndex = Math.min(Number(slider.value), values.length - 1);
  const width = 900;
  const height = 220;
  const pad = { top: 15, right: 7, bottom: 22, left: 46 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...values, isRain ? 1 : state.stations.find((station) => station.id === state.selectedId).alert_level_m3s) * 1.12;
  const minValue = 0;
  const x = (index) => pad.left + (index / Math.max(values.length - 1, 1)) * plotWidth;
  const y = (value) => pad.top + (1 - (value - minValue) / (maxValue - minValue || 1)) * plotHeight;
  const points = values.map((value, index) => [x(index), y(value)]);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L ${x(values.length - 1).toFixed(1)} ${(pad.top + plotHeight).toFixed(1)} L ${pad.left} ${(pad.top + plotHeight).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const grid = ticks.map((fraction) => {
    const py = pad.top + plotHeight * fraction;
    const tickValue = maxValue * (1 - fraction);
    return `<line class="grid-line" x1="${pad.left}" y1="${py}" x2="${width - pad.right}" y2="${py}"/><text class="axis-label" x="0" y="${py + 3}">${isRain ? tickValue.toFixed(1) : numberFormat.format(tickValue)}</text>`;
  }).join('');
  const station = state.stations.find((item) => item.id === state.selectedId);
  const threshold = !isRain && station ? `<line class="threshold-line" x1="${pad.left}" y1="${y(station.alert_level_m3s)}" x2="${width - pad.right}" y2="${y(station.alert_level_m3s)}"/>` : '';
  const selected = `<line class="selected-time-line" x1="${points[selectedIndex][0]}" y1="${pad.top}" x2="${points[selectedIndex][0]}" y2="${pad.top + plotHeight}"/><circle cx="${points[selectedIndex][0]}" cy="${points[selectedIndex][1]}" r="4.5" fill="#218b68" stroke="white" stroke-width="2"/>`;
  svg.innerHTML = `<defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3aa67b" stop-opacity=".19"/><stop offset="100%" stop-color="#3aa67b" stop-opacity=".015"/></linearGradient></defs>${grid}${threshold}<path class="forecast-area" d="${area}"/><path class="forecast-line" d="${line}"/>${selected}`;
  svg.setAttribute('aria-label', `${isObserved ? 'Observed' : 'Forecast'} ${isRain ? 'rainfall' : 'discharge'} for ${station.name}`);
  byId('chart-legend').textContent = `${isObserved ? 'Observed' : 'Forecast'} ${isRain ? 'rainfall' : 'discharge'}`;
  byId('threshold-note').textContent = isRain ? 'Rainfall intensity' : 'Dashed line: alert threshold';
  const axisLabels = [...document.querySelectorAll('.chart-axis span')];
  axisLabels.forEach((label, index) => {
    const point = forecastPoints[Math.round((forecastPoints.length - 1) * (index / (axisLabels.length - 1)))];
    label.textContent = formatDate(point.valid_at);
  });
  const current = forecastPoints[selectedIndex];
  byId('time-readout').textContent = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(current.valid_at));
  byId('value-readout').textContent = `${isRain ? current.rainfall_mm : numberFormat.format(current.discharge_m3s)} ${isRain ? 'mm/h' : 'm³/s'}`;
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

async function start() {
  if (!window.L) {
    showToast('The map library could not load. Check your network connection.');
    return;
  }
  initMap();
  refreshRasterLayers();
  byId('variable-select').addEventListener('change', drawChart);
  byId('series-select').addEventListener('change', drawChart);
  byId('time-slider').addEventListener('input', drawChart);
  byId('import-button').addEventListener('click', () => byId('file-input').click());
  byId('file-input').addEventListener('change', importFile);
  byId('run-button').addEventListener('click', runForecast);
  byId('add-station-button').addEventListener('click', () => byId('station-dialog').showModal());
  byId('close-station-dialog').addEventListener('click', () => byId('station-dialog').close());
  byId('cancel-station-dialog').addEventListener('click', () => byId('station-dialog').close());
  byId('site-name').addEventListener('input', updateStationId);
  byId('site-river').addEventListener('input', updateStationId);
  byId('station-form').addEventListener('submit', addStation);
  try {
    const health = await getJson('/api/health');
    state.writeAuthEnabled = health.write_auth_enabled === true;
    state.stations = await getJson('/api/stations');
    renderStations();
    if (state.stations.length) await selectStation(state.stations[0].id, false);
    byId('map').classList.add('ready');
  } catch (error) {
    byId('station-list').textContent = error.message;
    showToast('Could not connect to the forecast API.');
  }
}

function writeToken() {
  if (!state.writeAuthEnabled) return '';
  let token = sessionStorage.getItem('rivercast-write-token') || '';
  if (!token) {
    token = window.prompt('Enter the configured RiverCast write token:') || '';
    if (token) sessionStorage.setItem('rivercast-write-token', token);
  }
  return token;
}

async function postWrite(url, options = {}) {
  const token = writeToken();
  if (state.writeAuthEnabled && !token) throw new Error('A write token is required for this operation.');
  const headers = new Headers(options.headers || {});
  if (token) headers.set('X-API-Token', token);
  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem('rivercast-write-token');
    const detail = Array.isArray(result.detail) ? result.detail.join(' · ') : result.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return result;
}

async function importFile(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  const button = byId('import-button');
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const extension = file.name.split('.').pop().toLowerCase();
    if (['csv', 'json'].includes(extension)) {
      const result = await postWrite('/api/observations/import', {
        method: 'POST',
        headers: { 'Content-Type': extension === 'json' ? 'application/json' : 'text/csv' },
        body: await file.text(),
      });
      state.stations = await getJson('/api/stations');
      renderStations();
      await selectStation(state.selectedId || state.stations[0]?.id, false);
      showToast(`Imported ${result.imported_rows} readings for ${result.changed_stations.length} station(s).`);
    } else {
      const body = new FormData();
      body.append('file', file);
      const result = await postWrite('/api/data/gridded', { method: 'POST', body });
      await refreshRasterLayers(true);
      showToast(`Stored ${result.filename} (${result.metadata_status}).`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Import data';
    event.target.value = '';
  }
}

async function runForecast() {
  const button = byId('run-button');
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const query = state.selectedId ? `?station_id=${encodeURIComponent(state.selectedId)}&hours=48` : '?hours=48';
    const runs = await postWrite(`/api/forecast-runs${query}`, { method: 'POST' });
    if (state.selectedId) {
      state.forecast = await getJson(`/api/stations/${encodeURIComponent(state.selectedId)}/forecast?hours=48`);
    }
    drawChart();
    showToast(`Forecast completed for ${runs.length} station(s).`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Run forecast';
  }
}

function updateStationId() {
  const slug = (value) => value.toLowerCase().trim().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const name = slug(byId('site-name').value);
  const river = slug(byId('site-river').value);
  byId('site-id').value = [river, name].filter(Boolean).join('-');
}

async function addStation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  values.latitude = Number(values.latitude);
  values.longitude = Number(values.longitude);
  values.alert_level_m3s = Number(values.alert_level_m3s);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const created = await postWrite('/api/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    state.stations = await getJson('/api/stations');
    renderStations();
    byId('station-dialog').close();
    form.reset();
    state.map.flyTo([created.latitude, created.longitude], 7, { duration: 0.7 });
    await selectStation(created.id, false);
    showToast(`${created.name} added to the network.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

start();
