import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

declare global {
  interface Window { L?: unknown }
}

const root = createRoot(document.getElementById('root')!);
if (!window.L) {
  root.render(
    <div className="boot-error">
      <h1>GeoEstimator</h1>
      <p>The map library (Leaflet) did not load. GeoEstimator needs an internet connection for the map library and basemap imagery. Check your connection and reload.</p>
    </div>,
  );
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
