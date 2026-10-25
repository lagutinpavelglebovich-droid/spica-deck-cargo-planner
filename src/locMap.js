/* ════════════════════════════════════════════════════════════
   POSITION CHECK MAP — v3.23
   Before a location position is saved, it is shown on a real map
   (OpenStreetMap + OpenSeaMap sea marks, where offshore installations
   are charted) so a typo in the latitude / longitude is seen at once.
   The pin can be dragged; zoom with the wheel or the +/− buttons.
   Leaflet is bundled with the app; only the map tiles come from the
   internet.
════════════════════════════════════════════════════════════ */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatLatLon } from './fieldWeather.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
let map = null, pin = null, others = null, resolver = null;

function ensure(){
  let ov = document.getElementById('posMapOv');
  if(ov) return ov;
  ov = document.createElement('div');
  ov.id = 'posMapOv'; ov.className = 'pm-ov';
  ov.innerHTML = `
    <div class="pm" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
      <div class="pm-head">
        <div class="pm-head-text">
          <div class="pm-kicker">Check the position</div>
          <div class="pm-title" id="pmTitle"></div>
        </div>
        <button type="button" class="pm-x" id="pmClose" title="Cancel (Esc)">✕</button>
      </div>
      <div class="pm-map" id="pmMap"></div>
      <div class="pm-foot">
        <div class="pm-pos"><span class="pm-pos-k">Position</span><b id="pmPos"></b><span class="pm-hint">Drag the pin to correct it</span></div>
        <div class="pm-btns">
          <button type="button" class="pm-btn" id="pmCancel">Back</button>
          <button type="button" class="pm-btn pm-ok" id="pmOk">Save this position</button>
        </div>
      </div>
      <div class="pm-attr">Map © OpenStreetMap contributors · sea marks © OpenSeaMap</div>
    </div>`;
  document.body.appendChild(ov);
  const done = v => { ov.classList.remove('open'); const r = resolver; resolver = null; if(r) r(v); };
  ov.querySelector('#pmClose').addEventListener('click', () => done(null));
  ov.querySelector('#pmCancel').addEventListener('click', () => done(null));
  ov.querySelector('#pmOk').addEventListener('click', () => { const p = pin.getLatLng(); done({ lat: +p.lat.toFixed(5), lon: +p.lng.toFixed(5) }); });
  ov.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.stopPropagation(); done(null); } });
  ov.addEventListener('mousedown', e => { if(e.target === ov) done(null); });
  map = L.map(ov.querySelector('#pmMap'), { zoomControl: true, attributionControl: false, worldCopyJump: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, opacity: 1 }).addTo(map);
  L.control.scale({ metric: true, imperial: true, position: 'bottomleft' }).addTo(map);
  others = L.layerGroup().addTo(map);
  const icon = L.divIcon({ className: 'pm-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
  pin = L.marker([58, 0], { draggable: true, icon, autoPan: true }).addTo(map);
  const show = () => { const p = pin.getLatLng(); ov.querySelector('#pmPos').textContent = formatLatLon(p.lat, p.lng); };
  pin.on('drag', show); pin.on('dragend', show);
  map.on('click', e => { pin.setLatLng(e.latlng); show(); });
  return ov;
}

/* Show a position for checking. Resolves to {lat, lon} (possibly moved
   by the pin) when saved, or null when cancelled. `around` = other
   located locations, drawn small for orientation. */
export function checkPositionOnMap({ name, lat, lon, around = [] }){
  const ov = ensure();
  ov.querySelector('#pmTitle').textContent = name || 'Location';
  ov.classList.add('open');
  ov.tabIndex = -1; ov.focus();
  others.clearLayers();
  around.forEach(o => {
    if(!isFinite(o.lat) || !isFinite(o.lon)) return;
    L.circleMarker([o.lat, o.lon], { radius: 5, color: '#1e293b', weight: 1.5, fillColor: o.c || '#64748b', fillOpacity: .9 })
      .bindTooltip(esc(o.name), { permanent: true, direction: 'right', offset: [6, 0], className: 'pm-tip' }).addTo(others);
  });
  pin.setLatLng([lat, lon]);
  ov.querySelector('#pmPos').textContent = formatLatLon(lat, lon);
  setTimeout(() => { map.invalidateSize(); map.setView([lat, lon], 8); }, 30);
  return new Promise(res => { resolver = res; });
}
