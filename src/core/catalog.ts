// Seeded item catalogs and setup pick-lists. Users edit the catalog per portfolio.

import type { CatalogItem, GeomKind, Industry, LineStyle, Portfolio, SubProject } from './types';
import { SUBPROJECT_COLORS } from './types';

type Seed = [code: string, category: string, name: string, geometry: GeomKind, color: string, size: number, style: LineStyle, method: boolean, description?: string];

const SEEDS: Record<Industry, Seed[]> = {
  Pipeline: [
    ['PL-OC', 'Pipe', 'Open cut', 'Line', '#E8590C', 4, 'Solid', true, 'Trench, lay, backfill'],
    ['PL-HDD', 'Pipe', 'Horizontal directional drill', 'Line', '#C92A2A', 5, 'Dashed', true],
    ['PL-BORE', 'Pipe', 'Conventional bore', 'Line', '#862E9C', 5, 'Dotted', true, 'Road/rail crossing, cased or uncased'],
    ['PL-ABV', 'Pipe', 'Aboveground pipe', 'Line', '#F59F00', 4, 'Solid', true],
    ['PL-ELB', 'Fittings', 'Elbow / fitting', 'Point', '#FFFFFF', 10, 'Solid', false, 'Factory bend or elbow placed by the engineer'],
    ['PL-TEE', 'Fittings', 'Tee', 'Point', '#748FFC', 10, 'Solid', false],
    ['PL-MLV', 'Valves', 'Mainline block valve', 'Point', '#1971C2', 12, 'Solid', false],
    ['PL-TAP', 'Valves', 'Hot tap / tie-in', 'Point', '#0B7285', 10, 'Solid', false],
    ['PL-PIG', 'Facilities', 'Pig launcher / receiver', 'Point', '#5F3DC4', 12, 'Solid', false],
    ['PL-CP', 'Corrosion', 'CP test station', 'Point', '#2F9E44', 8, 'Solid', false],
    ['PL-MKR', 'Marking', 'Line marker', 'Point', '#FAB005', 7, 'Solid', false],
    ['PL-SITE', 'Facilities', 'Station / facility site', 'Polygon', '#2F9E44', 2, 'Solid', false],
    ['PL-ATWS', 'Workspace', 'Additional temporary workspace', 'Polygon', '#FAB005', 2, 'Dashed', false],
  ],
  Power: [
    ['PW-OH3', 'Conductor', '3-phase overhead', 'Line', '#F08C00', 3, 'Solid', true],
    ['PW-OH1', 'Conductor', '1-phase overhead', 'Line', '#FAB005', 2, 'Solid', true],
    ['PW-UG', 'Underground', 'Underground in conduit', 'Line', '#5F3DC4', 3, 'Dashed', true],
    ['PW-POLE', 'Structures', 'Tangent pole', 'Point', '#A0522D', 8, 'Solid', false],
    ['PW-ANG', 'Structures', 'Angle / dead-end pole', 'Point', '#C92A2A', 10, 'Solid', false],
    ['PW-GUY', 'Structures', 'Guy & anchor', 'Point', '#868E96', 6, 'Solid', false],
    ['PW-XFMR', 'Equipment', 'Transformer', 'Point', '#1971C2', 10, 'Solid', false],
    ['PW-RCL', 'Equipment', 'Recloser / switch', 'Point', '#E64980', 10, 'Solid', false],
    ['PW-RISER', 'Equipment', 'Riser (OH to UG)', 'Point', '#5F3DC4', 9, 'Solid', false],
    ['PW-SUB', 'Facilities', 'Substation site', 'Polygon', '#1971C2', 2, 'Solid', false],
    ['PW-CLR', 'ROW', 'Vegetation clearing area', 'Polygon', '#2F9E44', 2, 'Dashed', false],
  ],
  Fiber: [
    ['FO-BORE', 'Conduit', 'Directional bore', 'Line', '#1098AD', 3, 'Dashed', true],
    ['FO-PLOW', 'Conduit', 'Plow / trench', 'Line', '#15AABF', 3, 'Solid', true],
    ['FO-AER', 'Aerial', 'Aerial lash', 'Line', '#F08C00', 2, 'Dotted', true],
    ['FO-HH', 'Structures', 'Handhole', 'Point', '#495057', 8, 'Solid', false],
    ['FO-VLT', 'Structures', 'Vault', 'Point', '#212529', 10, 'Solid', false],
    ['FO-PED', 'Structures', 'Pedestal', 'Point', '#2F9E44', 8, 'Solid', false],
    ['FO-SPL', 'Splicing', 'Splice closure', 'Point', '#1971C2', 9, 'Solid', false],
    ['FO-MR', 'Aerial', 'Make-ready pole', 'Point', '#E8590C', 8, 'Solid', false],
    ['FO-REST', 'Restoration', 'Surface restoration', 'Polygon', '#2F9E44', 2, 'Solid', false],
  ],
  Water: [
    ['WT-OC', 'Main', 'Open cut main', 'Line', '#1971C2', 3, 'Solid', true],
    ['WT-HDD', 'Main', 'HDD main', 'Line', '#5F3DC4', 4, 'Dashed', true],
    ['WT-BORE', 'Main', 'Cased bore', 'Line', '#862E9C', 4, 'Dotted', true],
    ['WT-GV', 'Valves', 'Gate valve', 'Point', '#C92A2A', 8, 'Solid', false],
    ['WT-ARV', 'Valves', 'Air release valve', 'Point', '#F08C00', 8, 'Solid', false],
    ['WT-HYD', 'Hydrants', 'Fire hydrant assembly', 'Point', '#FA5252', 10, 'Solid', false],
    ['WT-BEND', 'Fittings', 'Bend', 'Point', '#FFFFFF', 8, 'Solid', false],
    ['WT-TEE', 'Fittings', 'Tee', 'Point', '#748FFC', 8, 'Solid', false],
    ['WT-SVC', 'Services', 'Service connection', 'Point', '#2F9E44', 7, 'Solid', false],
    ['WT-PAVE', 'Restoration', 'Pavement repair', 'Polygon', '#868E96', 2, 'Solid', false],
    ['WT-SITE', 'Facilities', 'Pump / tank site', 'Polygon', '#1971C2', 2, 'Solid', false],
  ],
  Sewer: [
    ['SW-GRAV', 'Main', 'Gravity main', 'Line', '#5C940D', 3, 'Solid', true],
    ['SW-FM', 'Main', 'Force main', 'Line', '#E8590C', 3, 'Dashed', true],
    ['SW-BORE', 'Main', 'Cased bore', 'Line', '#862E9C', 4, 'Dotted', true],
    ['SW-MH', 'Structures', 'Manhole', 'Point', '#495057', 10, 'Solid', false],
    ['SW-CO', 'Structures', 'Cleanout', 'Point', '#868E96', 7, 'Solid', false],
    ['SW-LAT', 'Services', 'Lateral connection', 'Point', '#1971C2', 7, 'Solid', false],
    ['SW-LS', 'Facilities', 'Lift station', 'Point', '#C92A2A', 12, 'Solid', false],
    ['SW-PAVE', 'Restoration', 'Pavement repair', 'Polygon', '#868E96', 2, 'Solid', false],
  ],
};

export function seedCatalog(): CatalogItem[] {
  // `method` (centerline coverage) is retired; kept false so older files still load.
  const out: CatalogItem[] = [];
  for (const [industry, seeds] of Object.entries(SEEDS) as [Industry, Seed[]][]) {
    for (const [code, category, name, geometry, color, size, style, method, description = ''] of seeds) {
      out.push({ code, industry, category, name, geometry, color, size, style, method: method && false, description });
    }
  }
  return out;
}

/** Suggestions only: every field also accepts free text (e.g. a size range like 14-16"). */
export const PICK_LISTS: Record<Industry, { commodity: string[]; size: string[]; material: string[]; sizeLabel: string }> = {
  Pipeline: {
    commodity: ['Natural Gas', 'Crude Oil', 'NGL', 'Refined Products', 'CO2', 'Produced Water', 'Hydrogen'],
    size: ['2"', '3"', '4"', '6"', '8"', '10"', '12"', '16"', '20"', '24"', '30"', '36"', '42"', '48"'],
    material: ['Carbon Steel', 'HDPE', 'Fiberglass / RTP', 'Stainless Steel'],
    sizeLabel: 'Nominal diameter',
  },
  Power: {
    commodity: ['Distribution', 'Transmission'],
    size: ['12.47 kV', '25 kV', '34.5 kV', '69 kV', '138 kV', '345 kV'],
    material: ['ACSR', 'AAC', 'Copper', 'XLPE cable'],
    sizeLabel: 'Voltage',
  },
  Fiber: {
    commodity: ['Long haul', 'Middle mile', 'FTTH / last mile'],
    size: ['24 ct', '48 ct', '96 ct', '144 ct', '288 ct', '432 ct'],
    material: ['Single-mode loose tube', 'Ribbon', 'ADSS aerial'],
    sizeLabel: 'Fiber count',
  },
  Water: {
    commodity: ['Potable', 'Raw', 'Reclaimed'],
    size: ['6"', '8"', '12"', '16"', '24"', '36"'],
    material: ['PVC C900', 'Ductile Iron', 'HDPE', 'Steel'],
    sizeLabel: 'Nominal diameter',
  },
  Sewer: {
    commodity: ['Gravity sanitary', 'Force main', 'Storm'],
    size: ['8"', '10"', '12"', '15"', '18"', '24"'],
    material: ['PVC SDR-35', 'Ductile Iron', 'HDPE', 'RCP'],
    sizeLabel: 'Nominal diameter',
  },
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function newSubProject(index: number, industry: Industry = 'Pipeline'): SubProject {
  return {
    id: 'sp-' + uid(),
    name: `Sub-project ${index + 1}`,
    number: '',
    industry,
    commodity: '',
    size: '',
    material: '',
    scope: '',
    location: '',
    terrain: '',
    costYear: String(new Date().getFullYear()),
    color: SUBPROJECT_COLORS[index % SUBPROJECT_COLORS.length],
    centerline: null,
    centerlineName: '',
    centerlineFile: '',
    freeStressDeg: 1,
    fieldBendDeg: 18,
  };
}

export function newPortfolio(): Portfolio {
  const sp = newSubProject(0);
  return {
    version: 1,
    name: 'New portfolio',
    number: '',
    units: 'ft',
    industry: null,
    mpInterval: 1,
    offsetLimitFt: 100,
    subprojects: [sp],
    catalog: seedCatalog(),
    features: [],
    nextFeatureNo: 1,
    activeSubId: sp.id,
    activeCode: null,
  };
}
