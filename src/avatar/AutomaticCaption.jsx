import React from 'react';
import useVisualTextPages from './use-visual-text-pages';
import { visualPageAt } from './visual-text-pagination.mjs';

export default function AutomaticCaption({ text, character }) {
  const { viewport, measure, pages } = useVisualTextPages(text, 28);
  const page = visualPageAt(pages, character);
  return (
    <div className="automatic-caption" ref={viewport}>
      <p className="automatic-caption-text">{pages[page]?.text}</p>
      <p
        className="automatic-caption-text automatic-caption-measure"
        ref={measure}
        aria-hidden="true"
      />
    </div>
  );
}
