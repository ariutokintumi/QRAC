// Web Worker: builds an LMS key tree off the main thread and reports progress.
import { buildTree } from './lms.js';

self.onmessage = (ev) => {
  const { id, lmsType, otsType, I, seed } = ev.data;
  try {
    const t0 = performance.now();
    const T = buildTree(lmsType, otsType, I, seed, (done, total) => self.postMessage({ id, progress: done / total }));
    self.postMessage({ id, T, ms: performance.now() - t0 }, [T.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message ? e.message : e) });
  }
};
