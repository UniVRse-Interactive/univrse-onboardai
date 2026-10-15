import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('3D-only stage preserves identity and status without an image or mode selector', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { default: AvatarDisplay } = await vite.ssrLoadModule('/src/avatar/AvatarDisplay.jsx');
    for (const [speaking, thinking, status] of [
      [false, false, 'Ready for your question'],
      [true, false, 'Speaking'],
      [false, true, 'Finding your answer'],
    ]) {
      // Server markup must reserve the 3D stage without substituting a portrait.
      const html = renderToStaticMarkup(
        React.createElement(AvatarDisplay, {
          speechRef: { current: null },
          speaking,
          thinking,
          reducedMotion: true,
        }),
      );
      assert.match(html, /alya-canvas/);
      assert.ok(html.includes(status));
      assert.match(html, /Alya/);
      assert.match(html, /Preparing Alya/);
      assert.doesNotMatch(html, /<img|<video|<select|Alva|Portrait · still/);
    }
  } finally {
    await vite.close();
  }
});
