import { useEffect, useRef } from 'react';
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
import { api } from '../services/api.js';
import { dateLabel } from '../components/formatters.js';

const colors = { normal: '#30977b', watch: '#e8a942', warning: '#e06553' };

export default function useRiverCastMap({ stations, selected, selectedId, loadStations, loadAssets, setStations, setSelectedId, setError, setNewStationCoordinates, setPickStationLocation, setActiveAirQualityStation, setActiveWeatherStation, setActiveRiverStation, stationWeather, setStationWeather, setStationWeatherStatus, weatherStations, setWeatherStations, setWeatherStationsStatus, riverStations, setRiverStations, setRiverStationsStatus, airQualityStations, setAirQualityStations, setAirQualityStatus, liveLayers, airHeatRadius, airHeatBlur, setLiveMeta, measureMode, setLastMeasurement, observations, setObservations, forecast, setForecast, setForecastStep, rasters, activeRasters }) {
  const mapElement = useRef(null);
  const mapObject = useRef(null);
  const stationLayer = useRef(null);
  const waterwaysLayer = useRef(null);
  const weatherStationSource = useRef(null);
  const riverGaugeSource = useRef(null);
  const riverGaugeLayer = useRef(null);
  const airQualitySource = useRef(null);
  const airQualityLayer = useRef(null);
  const airQualityHeatLayer = useRef(null);
  const weatherStationsRef = useRef([]);
  const riverStationsRef = useRef([]);
  const airQualityStationsRef = useRef([]);
  const stationLocationPickRef = useRef(false);
  const measureSource = useRef(null);
  const rasterLayers = useRef([]);
  const liveLayerRefs = useRef({});

  weatherStationsRef.current = weatherStations;
  riverStationsRef.current = riverStations;

  const setStationLocationPicking = (enabled) => { stationLocationPickRef.current = enabled; };

    useEffect(() => {
    const markers = new VectorSource();
    const markerLayer = new VectorLayer({ source: markers, style: (feature) => {
      const color = colors[feature.get('status')] || colors.normal;
      return [new Style({ image: new CircleStyle({ radius: feature.get('selected') ? 9 : 7, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 3 }) }) }), new Style({ text: new Text({ text: feature.get('selected') ? feature.get('name') : '', offsetY: -19, font: '600 12px Inter, sans-serif', fill: new Fill({ color: '#193b36' }), backgroundFill: new Fill({ color: '#ffffffdd' }), padding: [3, 6, 3, 6] }) })];
    } });
    stationLayer.current = markerLayer;
    const waterways = new VectorLayer({ source: new VectorSource(), style: new Style({ stroke: new Stroke({ color: '#2b7bb9', width: 3, lineCap: 'round', lineJoin: 'round' }) }) });
    waterwaysLayer.current = waterways;
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
    const airHeatLayer = new Heatmap({ source: airMarkers, blur: airHeatBlur, radius: airHeatRadius, weight: (feature) => feature.get('heatWeight'), gradient: ['#3288bd', '#66c2a5', '#abdda4', '#ffffbf', '#fdae61', '#d7191c'], visible: false });
    airQualityHeatLayer.current = airHeatLayer;
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
    const map = new Map({ target: mapElement.current, layers: [new TileLayer({ source: new OSM() }), waterways, markerLayer, weatherMarkerLayer, riverLayer, airHeatLayer, airLayer, measureLayer], view: new View({ center: fromLonLat([84.4, 22.8]), zoom: 5, minZoom: 2, maxZoom: 18 }), controls: [] });
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
    const map = mapObject.current;
    const layer = waterwaysLayer.current;
    if (!map || !layer) return undefined;
    layer.setVisible(liveLayers.waterways);
    if (!liveLayers.waterways) {
      layer.getSource().clear();
      return undefined;
    }
    let cancelled = false;
    let debounceTimer;
    let requestSequence = 0;
    const refresh = async () => {
      const sequence = ++requestSequence;
      try {
        const size = map.getSize();
        if (!size) return;
        const [west, south, east, north] = transformExtent(map.getView().calculateExtent(size), map.getView().getProjection(), 'EPSG:4326');
        if ((north - south) * (east - west) > 1600) {
          layer.getSource().clear();
          setLiveMeta((state) => ({ ...state, waterways: 'Zoom in to view river lines' }));
          return;
        }
        const query = new URLSearchParams({ south: south.toFixed(2), west: west.toFixed(2), north: north.toFixed(2), east: east.toFixed(2) });
        const data = await api(`/api/live/waterways?${query}`);
        if (cancelled || sequence !== requestSequence) return;
        layer.getSource().clear(true);
        layer.getSource().addFeatures(new GeoJSON().readFeatures(data, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
        setLiveMeta((state) => ({ ...state, waterways: `OpenStreetMap · ${data.features?.length || 0} river and canal segments` }));
      } catch (reason) {
        if (!cancelled && sequence === requestSequence) setLiveMeta((state) => ({ ...state, waterways: `Waterway data unavailable: ${reason.message}` }));
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refresh, 650);
    };
    refresh();
    map.on('moveend', scheduleRefresh);
    return () => { cancelled = true; map.un('moveend', scheduleRefresh); window.clearTimeout(debounceTimer); };
  }, [liveLayers.waterways]);

  useEffect(() => {
    if (!mapObject.current || !airQualityLayer.current || !airQualityHeatLayer.current) return;
    airQualityLayer.current.setVisible(liveLayers.airQuality);
    airQualityHeatLayer.current.setVisible(liveLayers.airQuality);
  }, [liveLayers.airQuality]);

  useEffect(() => {
    if (!airQualityHeatLayer.current) return;
    airQualityHeatLayer.current.setRadius(airHeatRadius);
    airQualityHeatLayer.current.setBlur(airHeatBlur);
  }, [airHeatRadius, airHeatBlur]);

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
    airQualityStations.forEach((station) => {
      const particulate = station.pollutants?.['PM2.5'] || station.pollutants?.PM10;
      const concentration = Number(particulate?.average);
      const heatWeight = Number.isFinite(concentration) ? Math.min(1, Math.max(0, concentration) / 250) : 0;
      source.addFeature(new Feature({
        geometry: new Point(fromLonLat([station.longitude, station.latitude])),
        stationId: station.station_id, name: station.name, heatWeight,
      }));
    });
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

  return { mapElement, mapObject, measureSource, setStationLocationPicking };
}
