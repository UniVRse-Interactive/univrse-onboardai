import { useLayoutEffect, useRef, useState } from 'react';
import { paginateVisualText } from './visual-text-pagination.mjs';

export default function useVisualTextPages(text, maximumWords = Infinity) {
  const viewport = useRef(null),
    measure = useRef(null);
  const [layout, setLayout] = useState(null);
  useLayoutEffect(() => {
    const area = viewport.current,
      probe = measure.current;
    if (!area || !probe) return;
    let disposed = false;
    function calculate() {
      if (disposed || area.clientWidth < 1 || area.clientHeight < 1) return;
      // The probe uses the paragraph font in bold to allow for emphasized
      // policy words. Leave a few pixels for fractional zoom rounding too.
      const style = getComputedStyle(area);
      const height =
        area.clientHeight -
        parseFloat(style.paddingTop || 0) -
        parseFloat(style.paddingBottom || 0) -
        4;
      const pages = paginateVisualText(text, (candidate) => {
        if ((candidate.match(/\S+/g) || []).length > maximumWords) return false;
        probe.textContent = candidate;
        return probe.getBoundingClientRect().height <= height;
      });
      probe.textContent = '';
      setLayout((previous) =>
        previous?.text === text &&
        previous.pages.map((page) => page.end).join(',') === pages.map((page) => page.end).join(',')
          ? previous
          : { text, pages },
      );
    }
    calculate();
    const observer = new ResizeObserver(calculate);
    observer.observe(area);
    document.fonts?.ready.then(calculate);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [text, maximumWords]);
  return {
    viewport,
    measure,
    pages: layout?.text === text ? layout.pages : [{ start: 0, end: text.length, text }],
  };
}
