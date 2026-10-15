import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { visualAnswer } from '../src/avatar/visual-answer-content.mjs';

test('access and reading markup keep preview labels, manual views and written instructions', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { AccessScreen } = await vite.ssrLoadModule('/src/portal/WorkspaceAccess.jsx');
    const access = renderToStaticMarkup(React.createElement(AccessScreen, { onAccess() {} }));
    assert.match(access, /OnboardAi/);
    assert.match(access, /not employee authentication or verified HR access/);
    assert.match(access, /Employee ID/);
    assert.match(access, /Continue as a new guest/);
    assert.doesNotMatch(access, /type="password"|Company A|Company B/);
    const { default: Chat } = await vite.ssrLoadModule('/src/avatar/AlyaChatPage.jsx');
    const chat = renderToStaticMarkup(
      React.createElement(Chat, { navigate() {}, employeeId: 'synthetic' }),
    );
    assert.match(chat, /aria-label="Answer view"/);
    assert.match(chat, /aria-pressed="true">Chat/);
    assert.match(chat, /aria-pressed="false">Visual guide/);
    assert.match(chat, /alya-canvas/);
    assert.match(chat, /aria-label="Send question"/);
    assert.doesNotMatch(chat, /Your onboarding experience|Review employee summary/);
    // Voice is outside the chat-only section, so switching views does not hide stop/mute.
    assert.ok(chat.indexOf('alya-voice-toolbar') < chat.indexOf('aria-label="Chat with Alya"'));
    const { default: Illustrated } = await vite.ssrLoadModule('/src/avatar/IllustratedAnswer.jsx');
    const text = '1. Ask HR before requesting access.\n2. Keep your badge visible.';
    const html = renderToStaticMarkup(
      React.createElement(Illustrated, {
        guide: visualAnswer({ text, passages: [{ title: 'Synthetic guidance' }] }),
      }),
    );
    assert.match(html, /disabled="" aria-label="Previous step"/);
    assert.match(html, /aria-label="Next step"/);
    assert.match(html, /Full answer/);
    assert.match(html, /Ask HR before requesting access/);
    assert.match(html, /Keep your badge visible/);
    assert.doesNotMatch(html, /type="checkbox"|task completed/i);
  } finally {
    await vite.close();
  }
});
