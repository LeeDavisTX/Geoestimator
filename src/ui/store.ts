// Portfolio state helpers and browser persistence.

import { useCallback, useEffect, useRef, useState } from 'react';
import { newPortfolio } from '../core/catalog';
import { parsePortfolio, serializePortfolio } from '../core/io';
import type { Portfolio } from '../core/types';

const KEY = 'geoestimator.portfolio.v1';

function loadSaved(): Portfolio {
  try {
    const t = localStorage.getItem(KEY);
    if (t) return parsePortfolio(t);
  } catch {
    /* storage blocked or bad data: start fresh */
  }
  return newPortfolio();
}

export type Updater = (fn: (draft: Portfolio) => void) => void;

export function usePortfolio() {
  const [p, setP] = useState<Portfolio>(loadSaved);
  const [saveState, setSaveState] = useState<'saved' | 'blocked'>('saved');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, serializePortfolio(p));
        setSaveState('saved');
      } catch {
        setSaveState('blocked');
      }
    }, 250);
  }, [p]);

  const update: Updater = useCallback((fn) => {
    setP((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  return { p, setP, update, saveState };
}

export const nowIso = () => new Date().toISOString();
export const featureId = (n: number) => `F-${String(n).padStart(4, '0')}`;
