import React, { useEffect, useId, useRef } from 'react';
import Icon from './Icon';

// A modal dialog in the portal's style. It uses the native <dialog> element, so
// focus stays inside, Escape asks to close, and focus returns to the opener.
// When the dialog unmounts, focus goes back to the button that opened it. If that
// button is gone (a step was completed, a request was sent), the first visible
// element matching one of `fallbacks` (CSS selectors) gets focus instead.
function visible(element) {
  return !!element && element.isConnected && element.getClientRects().length > 0;
}
export default function UvDialog({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  fallbacks = [],
}) {
  const ref = useRef(null);
  const titleId = useId();
  const fallbackRef = useRef(fallbacks);
  fallbackRef.current = fallbacks;
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      // Wait for the page to settle, then pick the best place for focus.
      requestAnimationFrame(() => {
        // Only a control is an opener. A dialog opened by the page itself (such as
        // a check handed over from Alya's page) returns focus to a fallback.
        const control =
          opener?.matches?.(
            'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
          ) && !opener.disabled;
        const candidates = [
          control ? opener : null,
          ...fallbackRef.current.map((selector) => document.querySelector(selector)),
        ];
        const target = candidates.find(visible);
        target?.focus({ preventScroll: false });
      });
    };
  }, []);
  return (
    <dialog
      className={'uv-dialog ' + (wide ? 'wide ' : '') + className}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="uv-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="uv-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
