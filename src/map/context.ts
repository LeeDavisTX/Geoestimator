// Reference ("context") overlays from public services. Nothing is hosted by GeoEstimator:
// the browser asks each service for the current map view only.
// To add a layer, add an entry to CONTEXT_LAYERS.

declare const L: any;

export interface ContextLayerDef {
  id: string;
  label: string;
  /** Shown in the legend under the label. */
  source: string;
  kind: 'wms' | 'arcgis-tiles' | 'arcgis-geojson';
  url: string;
  /** wms: comma-separated layer names. */
  layers?: string;
  /** arcgis-tiles: deepest zoom the service has tiles for (Leaflet upscales beyond it). */
  maxNativeZoom?: number;
  /** arcgis-geojson: only query at or above this zoom (keeps requests small). */
  minZoom?: number;
  opacity: number;
  swatch: string;
}

export const CONTEXT_LAYERS: ContextLayerDef[] = [
  {
    id: 'nwi',
    label: 'Wetlands (NWI)',
    source: 'USFWS National Wetlands Inventory · WMS',
    kind: 'wms',
    url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/services/Wetlands/MapServer/WMSServer',
    layers: '0',
    opacity: 0.7,
    swatch: '#3f9e8f',
  },
  {
    id: 'nhd',
    label: 'Streams & waterbodies (NHD)',
    source: 'USGS National Hydrography Dataset · WMS',
    kind: 'wms',
    url: 'https://hydro.nationalmap.gov/arcgis/services/nhd/MapServer/WMSServer',
    layers: '0,2,3,5,6,8',
    opacity: 0.9,
    swatch: '#4dabf7',
  },
  {
    id: 'padus',
    label: 'Protected lands (PAD-US)',
    source: 'USGS PAD-US 3.0 by manager type · tiled map service (generalized below ~1:750k)',
    kind: 'arcgis-tiles',
    url: 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS3_0Manager_Type/MapServer',
    maxNativeZoom: 9,
    opacity: 0.55,
    swatch: '#8ce99a',
  },
  {
    id: 'trans',
    label: 'Transmission lines (HIFLD)',
    source: 'HIFLD Electric Power Transmission Lines, 69–765 kV, Dec 2021 · zoom in to load',
    kind: 'arcgis-geojson',
    url: 'https://services2.arcgis.com/wdQEqhSQSuYA89VW/ArcGIS/rest/services/ElectricTransLines12012021/FeatureServer/0',
    minZoom: 9,
    opacity: 1,
    swatch: '#ff922b',
  },
];

const voltColor = (kv: number) => (kv >= 345 ? '#e03131' : kv >= 230 ? '#f76707' : kv >= 115 ? '#fab005' : '#ffd8a8');

/** Transmission lines as interactive vectors, fetched for the visible extent. */
function geoJsonLayer(def: ContextLayerDef, pane: string, onStatus: (id: string, msg: string) => void) {
  const group = L.layerGroup();
  const renderer = L.canvas({ pane });
  let map: any = null;
  let ctrl: AbortController | null = null;
  let timer: number | undefined;

  const load = async () => {
    if (!map) return;
    group.clearLayers();
    ctrl?.abort();
    if (map.getZoom() < (def.minZoom ?? 0)) { onStatus(def.id, `Zoom in to load (level ${def.minZoom}+)`); return; }
    ctrl = new AbortController();
    const b = map.getBounds();
    const params = new URLSearchParams({
      where: '1=1',
      geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'OWNER,VOLTAGE,VOLT_CLASS,TYPE,STATUS,SUB_1,SUB_2',
      outSR: '4326',
      maxAllowableOffset: String(Math.max(0.00001, (b.getEast() - b.getWest()) / 4000)),
      f: 'geojson',
    });
    onStatus(def.id, 'Loading…');
    try {
      const res = await fetch(`${def.url}/query?${params}`, { signal: ctrl.signal });
      const gj = await res.json();
      if (gj.error) throw new Error(gj.error.message ?? 'service error');
      const n = gj.features?.length ?? 0;
      L.geoJSON(gj, {
        renderer,
        style: (f: any) => ({ color: voltColor(Number(f.properties.VOLTAGE) || 0), weight: Number(f.properties.VOLTAGE) >= 345 ? 3.5 : 2.5, opacity: def.opacity }),
        onEachFeature: (f: any, layer: any) => {
          const p = f.properties;
          const kv = Number(p.VOLTAGE) > 0 ? `${p.VOLTAGE} kV` : p.VOLT_CLASS || 'voltage n/a';
          layer.bindTooltip(`<b>Transmission line</b> · ${kv}<br>${esc(p.OWNER || 'Owner n/a')}${p.SUB_1 ? `<br>${esc(p.SUB_1)} – ${esc(p.SUB_2 || '')}` : ''}`, { sticky: true });
        },
      }).addTo(group);
      onStatus(def.id, n >= 1000 ? `${n}+ lines (zoom in for all)` : `${n} line${n === 1 ? '' : 's'} in view`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onStatus(def.id, 'Service did not respond');
    }
  };
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 350); };

  group.on('add', () => { map = group._map; map.on('moveend', schedule); load(); });
  group.on('remove', () => { map?.off('moveend', schedule); ctrl?.abort(); group.clearLayers(); onStatus(def.id, ''); map = null; });
  return group;
}

export function makeContextLayer(def: ContextLayerDef, pane: string, onStatus: (id: string, msg: string) => void): any {
  if (def.kind === 'wms') {
    const lyr = L.tileLayer.wms(def.url, {
      pane, layers: def.layers, format: 'image/png', transparent: true, version: '1.3.0',
      opacity: def.opacity, maxZoom: 21, attribution: def.source.split(' · ')[0],
    });
    lyr.on('tileerror', () => onStatus(def.id, 'Some tiles did not load'));
    return lyr;
  }
  if (def.kind === 'arcgis-tiles') {
    return L.tileLayer(`${def.url}/tile/{z}/{y}/{x}`, {
      pane, opacity: def.opacity, maxZoom: 21, maxNativeZoom: def.maxNativeZoom ?? 19, attribution: 'USGS PAD-US',
    });
  }
  return geoJsonLayer(def, pane, onStatus);
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
