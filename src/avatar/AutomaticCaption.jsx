import React, { useEffect, useRef } from 'react';
import useVisualTextPages from './use-visual-text-pages';
import { captionPage } from './scene-steps.mjs';

// While Alya speaks, `character` picks the caption page under her voice.
// Without voice, the employee steps through pages, so `page` picks it instead.
export default function AutomaticCaption({ text, character = 0, page = null, onPages }) {
  const { viewport, measure, pages } = useVisualTextPages(text, 28);
  const current = captionPage(pages, { character, page });
  const report = useRef(onPages);
  report.current = onPages;
  useEffect(() => {
    report.current?.(pages.length);
  }, [pages.length]);
  return (
    <div className="automatic-caption" ref={viewport}>
      <p className="automatic-caption-text">{pages[current]?.text}</p>
      <p
        className="automatic-caption-text automatic-caption-measure"
        ref={measure}
        aria-hidden="true"
      />
    </div>
  );
}
