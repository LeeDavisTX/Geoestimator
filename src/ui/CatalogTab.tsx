import { useRef, useState } from 'react';
import { seedCatalog } from '../core/catalog';
import { catalogFromXlsx, catalogToXlsx } from '../core/io';
import { exportBaseName } from '../core/exports';
import { INDUSTRY_PREFIX, type CatalogItem, type GeomKind, type Industry, type LineStyle, type Portfolio } from '../core/types';
import { saveFile } from './save';
import type { Updater } from './store';
import { Swatch } from './TakeoffTab';

interface Props {
  p: Portfolio;
  update: Updater;
  notify: (m: string) => void;
  goSetup: () => void;
}

export default function CatalogTab({ p, update, notify, goSetup }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const used = new Map<string, number>();
  for (const f of p.features) used.set(f.code, (used.get(f.code) ?? 0) + 1);
  if (!p.industry) {
    return (
      <div className="stack">
        <section className="card empty-state">
          <h2>Item catalog</h2>
          <p>Select the portfolio industry in Setup to see and edit its items.</p>
          <div><button className="btn primary" onClick={goSetup}>Go to Setup</button></div>
        </section>
      </div>
    );
  }
  const industry: Industry = p.industry;
  const list = p.catalog.filter((c) => c.industry === industry);

  const setItem = (code: string, fn: (c: CatalogItem) => void) =>
    update((d) => { const c = d.catalog.find((x) => x.code === code); if (c) fn(c); });

  const rename = (oldCode: string, raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code || code === oldCode) return;
    if (p.catalog.some((c) => c.code === code)) { notify(`Code ${code} is already in the catalog.`); return; }
    update((d) => {
      const c = d.catalog.find((x) => x.code === oldCode);
      if (c) c.code = code;
      for (const f of d.features) if (f.code === oldCode) f.code = code;
      if (d.activeCode === oldCode) d.activeCode = code;
    });
    setOpen(code);
  };

  const add = () => {
    const prefix = INDUSTRY_PREFIX[industry];
    let n = 1;
    while (p.catalog.some((c) => c.code === `${prefix}-NEW${n}`)) n++;
    const code = `${prefix}-NEW${n}`;
    update((d) => {
      d.catalog.push({ code, industry, category: '', name: 'New item', geometry: 'Point', color: '#868E96', size: 8, style: 'Solid', method: false, description: '' });
    });
    setOpen(code);
  };

  const download = async () => {
    const msg = await saveFile(`${exportBaseName(p)}_${industry.toLowerCase()}_catalog.xlsx`, catalogToXlsx(list), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (msg) notify(msg);
  };

  /** Replace the items of the industries in `items`; other industries are untouched. Never drop an item features still use. */
  const replaceCatalog = (items: CatalogItem[], label: string) => {
    const codes = new Set(items.map((c) => c.code));
    const inds = new Set(items.map((c) => c.industry));
    const kept = p.catalog.filter((c) => !codes.has(c.code) && (!inds.has(c.industry) || used.has(c.code)));
    const keptUsed = kept.filter((c) => inds.has(c.industry));
    update((d) => { d.catalog = [...items, ...kept]; });
    notify(`${label}: ${items.length} items.${keptUsed.length ? ` Kept ${keptUsed.length} item${keptUsed.length > 1 ? 's' : ''} still used on the map (${keptUsed.map((c) => c.code).join(', ')}).` : ''}`);
  };

  const onUpload = async (file: File) => {
    setErrors([]);
    try {
      const { items, errors: errs } = await catalogFromXlsx(await file.arrayBuffer());
      if (errs.length) { setErrors(errs); return; }
      replaceCatalog(items, `Catalog loaded from ${file.name}`);
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Item catalog</h2>
        <p className="muted small">Physical items for this portfolio's industry. Codes feed the cost tool, so keep them stable.</p>
        <div className="btn-row">
          <button className="btn" onClick={download}>Download Excel</button>
          <button className="btn" onClick={() => upload.current?.click()}>Upload Excel</button>
          {confirmReset ? (
            <span className="confirm-inline">
              Reset to starter catalog?
              <button className="btn danger" onClick={() => { replaceCatalog(seedCatalog().filter((c) => c.industry === industry), 'Catalog reset'); setConfirmReset(false); }}>Reset</button>
              <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn ghost" onClick={() => setConfirmReset(true)}>Reset</button>
          )}
          <input ref={upload} type="file" hidden accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
        </div>
        {errors.length > 0 && (
          <div className="error">
            <b>Catalog not loaded. Fix these rows and upload again:</b>
            <ul>{errors.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}</ul>
            {errors.length > 12 && <span>+{errors.length - 12} more</span>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>{industry} items <span className="count">{list.length}</span></h2>
        <div className="cat-list">
          {list.map((c) => {
            const isOpen = open === c.code;
            const n = used.get(c.code) ?? 0;
            const fid = (k: string) => `cat-${c.code}-${k}`;
            return (
              <div key={c.code} className={`cat-row ${isOpen ? 'open' : ''}`}>
                <button className="cat-head" onClick={() => setOpen(isOpen ? null : c.code)} aria-expanded={isOpen}>
                  <Swatch item={c} />
                  <span className="item-code">{c.code}</span>
                  <span className="item-name">{c.name}</span>
                  {n > 0 && <span className="muted small num">{n} used</span>}
                </button>
                {isOpen && (
                  <div className="cat-body">
                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={fid('code')}>Code</label>
                        <input id={fid('code')} defaultValue={c.code} onBlur={(e) => rename(c.code, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      </div>
                      <div className="field">
                        <label htmlFor={fid('cat')}>Category</label>
                        <input id={fid('cat')} value={c.category} onChange={(e) => setItem(c.code, (x) => { x.category = e.target.value; })} />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={fid('name')}>Name</label>
                      <input id={fid('name')} value={c.name} onChange={(e) => setItem(c.code, (x) => { x.name = e.target.value; })} />
                    </div>
                    <div className="grid3">
                      <div className="field">
                        <label htmlFor={fid('geom')}>Geometry</label>
                        <select id={fid('geom')} value={c.geometry} disabled={n > 0} title={n > 0 ? 'In use on the map' : ''}
                          onChange={(e) => setItem(c.code, (x) => { x.geometry = e.target.value as GeomKind; })}>
                          <option>Line</option><option>Point</option><option>Polygon</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={fid('color')}>Color</label>
                        <input id={fid('color')} type="color" value={c.color} onChange={(e) => setItem(c.code, (x) => { x.color = e.target.value.toUpperCase(); })} />
                      </div>
                      <div className="field">
                        <label htmlFor={fid('size')}>{c.geometry === 'Point' ? 'Size (px)' : 'Width (px)'}</label>
                        <input id={fid('size')} type="number" min={1} max={30} value={c.size}
                          onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 30) setItem(c.code, (x) => { x.size = v; }); }} />
                      </div>
                    </div>
                    {c.geometry !== 'Point' && (
                      <div className="grid2">
                        <div className="field">
                          <label htmlFor={fid('style')}>Line style</label>
                          <select id={fid('style')} value={c.style} onChange={(e) => setItem(c.code, (x) => { x.style = e.target.value as LineStyle; })}>
                            <option>Solid</option><option>Dashed</option><option>Dotted</option>
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={fid('desc')}>Description</label>
                      <input id={fid('desc')} value={c.description} onChange={(e) => setItem(c.code, (x) => { x.description = e.target.value; })} />
                    </div>
                    <div className="btn-row">
                      <button className="btn ghost danger-text" disabled={n > 0} title={n > 0 ? 'Delete or reassign its features first' : ''}
                        onClick={() => { update((d) => { d.catalog = d.catalog.filter((x) => x.code !== c.code); if (d.activeCode === c.code) d.activeCode = null; }); setOpen(null); }}>
                        Delete item
                      </button>
                      {n > 0 && <span className="muted small">Used by {n} feature{n > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn" onClick={add}>Add {industry.toLowerCase()} item</button>
      </section>
    </div>
  );
}
