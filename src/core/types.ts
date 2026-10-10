// GeoEstimator data model. A portfolio is the unit of save/load.

import type { LinearUnit, Vertex } from '../pi-engine';

export type { LinearUnit, Vertex };

export type Industry = 'Pipeline' | 'Power' | 'Fiber' | 'Water' | 'Sewer';
export type GeomKind = 'Line' | 'Point' | 'Polygon';
export type LineStyle = 'Solid' | 'Dashed' | 'Dotted';

export const INDUSTRIES: Industry[] = ['Pipeline', 'Power', 'Fiber', 'Water', 'Sewer'];
export const INDUSTRY_PREFIX: Record<Industry, string> = {
  Pipeline: 'PL',
  Power: 'PW',
  Fiber: 'FO',
  Water: 'WT',
  Sewer: 'SW',
};

/** One physical item a user can draw. Code is the key the cost tool will use. */
export interface CatalogItem {
  code: string;
  industry: Industry;
  category: string;
  name: string;
  geometry: GeomKind;
  color: string;
  /** Line width or point diameter in pixels. Polygons use it as outline width. */
  size: number;
  style: LineStyle;
  /** Construction-method line: these lines together should cover the centerline. */
  method: boolean;
  description: string;
}

export interface SubProject {
  id: string;
  name: string;
  number: string;
  industry: Industry;
  commodity: string;
  size: string;
  material: string;
  scope: string;
  location: string;
  terrain: string;
  costYear: string;
  color: string;
  /** Centerline vertices in stationing order (start = station 0). */
  centerline: Vertex[] | null;
  centerlineName: string;
  centerlineFile: string;
  /** Pipeline only: bend class cutoffs in degrees. */
  freeStressDeg: number;
  fieldBendDeg: number;
}

export interface TakeoffFeature {
  id: string;
  subId: string;
  code: string;
  kind: GeomKind;
  /** [lon, lat] pairs. Point = 1 pair; Polygon = open ring (first point not repeated). */
  coords: [number, number][];
  name: string;
  notes: string;
  created: string;
  modified: string;
}

export interface Portfolio {
  version: 1;
  name: string;
  number: string;
  units: LinearUnit;
  /** One industry per portfolio; null until the user picks it in Setup. Sub-projects mirror it. */
  industry: Industry | null;
  /** Milepost (or kilopost) marker interval on the map. */
  mpInterval: number;
  /** Flag features farther than this from their centerline, in feet (converted for metric). */
  offsetLimitFt: number;
  subprojects: SubProject[];
  catalog: CatalogItem[];
  features: TakeoffFeature[];
  nextFeatureNo: number;
  activeSubId: string | null;
  activeCode: string | null;
}

export const MAX_SUBPROJECTS = 10;

export const SUBPROJECT_COLORS = [
  '#E8590C', '#1971C2', '#2F9E44', '#AE3EC9', '#F08C00',
  '#0C8599', '#C2255C', '#5C940D', '#364FC7', '#862E9C',
];
