import React, { useEffect, useRef, useState } from 'react';
import AvatarDisplay from './AvatarDisplay';
import Icon from '../portal/Icon';
import { createServerSpeech } from './answer-audio-player';
import AnswerStyleSettings, { learningFormats } from './AnswerStyleSettings';
import VisualAnswerPanel from './VisualAnswerPanel';
import './alya-chat.css';

const preferenceKey = 'univrse-alya-voice-v1';
const activeChatPrefix = 'univrse-alya-active-chat-v1';
function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey));
    return {
      enabled: value?.enabled !== false,
      voiceURI: typeof value?.voiceURI === 'string' ? value.voiceURI : '',
      rate: [0.85, 0.95, 1.05].includes(value?.rate) ? value.rate : 0.95,
      reducedMotion: value?.reducedMotion === true,
    };
  } catch {
    return { enabled: true, voiceURI: '', rate: 0.95, reducedMotion: false };
  }
}
const greeting = {
  id: 'welcome',
  role: 'assistant',
  text: 'Hi, I’m Alya. Welcome to UniVRse. Ask me about UniVRse or any onboarding task.',
  intro: true,
};
export function presentAnswer(result) {
  if (typeof result?.answer !== 'string' || !result.answer.trim())
    throw new Error('The answer was empty. Please try again.');
  const passages = Array.isArray(result.passages) ? result.passages : [];
  const text =
    result.mode === 'document-search' && passages.length
      ? passages.map((p) => p.preview || p.text).join('\n\n')
      : result.answer;
  return {
    text,
    spoken: text,
    mode: result.mode,
    passages,
    learning: result.learning,
    source: typeof result.source === 'string' ? result.source : '',
  };
}
function Message({
  message,
  onRetry,
  onCopy,
  onFeedback,
  onSupport,
  onViewVisual,
  onHumanHelp,
  onOpenSupport,
  disabled,
  memoryEnabled,
}) {
  if (message.role === 'user')
    return (
      <article className="alya-message user">
        <span>You</span>
        <p>{message.text}</p>
      </article>
    );
  return (
    <article className={'alya-message assistant ' + (message.error ? 'error' : '')}>
      <div className="alya-message-author">
        <span className="alya-message-mark">A</span>
        <strong>Alya</strong>
        {!message.intro && !message.error && (
          <small>
            {message.mode === 'document-search'
              ? 'DOCUMENT SEARCH'
              : message.mode === 'demo'
                ? 'SAMPLE ANSWER'
                : 'COMPANY ASSISTANT'}
          </small>
        )}
      </div>
      <div className="alya-answer-body">
        {message.error ? (
          <>
            <p>{message.error}</p>
            <button className="alya-retry" onClick={() => onRetry(message)}>
              <Icon name="arrow" size={15} />
              Try again
            </button>
          </>
        ) : (
          <>
            {message.mode !== 'document-search' && <p>{message.text}</p>}
            {message.passages?.length ? (
              message.mode === 'document-search' ? (
                message.passages.map((passage, index) => (
                  <div className="alya-passage" key={index}>
                    <p>{passage.preview || passage.text}</p>
                    <details>
                      <summary>
                        <Icon name="book" size={13} />
                        {passage.heading || passage.title}
                        <Icon name="down" size={13} />
                      </summary>
                      <div>
                        <span>{passage.title}</span>
                        <p>{passage.text}</p>
                      </div>
                    </details>
                  </div>
                ))
              ) : (
                <details className="alya-source-group">
                  <summary>
                    <Icon name="book" size={13} />
                    Company sources ({message.passages.length})<Icon name="down" size={13} />
                  </summary>
                  {message.passages.map((passage, index) => (
                    <section key={index}>
                      <h4>{passage.heading || passage.title}</h4>
                      <small>{passage.title}</small>
                      <p>{passage.text}</p>
                    </section>
                  ))}
                </details>
              )
            ) : (
              message.mode === 'document-search' && <p>{message.text}</p>
            )}
            {!message.intro && !message.error && memoryEnabled && (
              <details className="alya-help-controls">
                <summary>
                  Need another explanation?
                  <Icon name="down" size={13} />
                </summary>
                <div className="alya-answer-tools" aria-label="Answer support options">
                  {memoryEnabled && (
                    <>
                      <button disabled={disabled} onClick={() => onSupport(message, 'steps')}>
                        <Icon name="checklist" size={13} />
                        Smaller steps
                      </button>
                      <button disabled={disabled} onClick={() => onSupport(message, 'example')}>
                        <Icon name="spark" size={13} />
                        Show example
                      </button>
                      <button disabled={disabled} onClick={() => onSupport(message, 'brief')}>
                        Keep it brief
                      </button>
                      <button
                        disabled={disabled || message.humanHelpRequested}
                        onClick={() => onHumanHelp(message)}
                      >
                        <Icon name="people" size={13} />I need a person
                      </button>
                    </>
                  )}
                </div>
              </details>
            )}
            {!message.intro && memoryEnabled && (
              <div className="alya-answer-feedback" aria-label="Feedback on this answer">
                <span>Did this help?</span>
                <button
                  disabled={disabled}
                  aria-pressed={message.feedback === 'helpful'}
                  onClick={() =>
                    onFeedback(message, message.feedback === 'helpful' ? null : 'helpful')
                  }
                >
                  <Icon name="check" size={13} />
                  Helpful
                </button>
                <button
                  disabled={disabled}
                  aria-pressed={message.feedback === 'unclear'}
                  onClick={() =>
                    onFeedback(message, message.feedback === 'unclear' ? null : 'unclear')
                  }
                >
                  <Icon name="help" size={13} />
                  Still unclear
                </button>
              </div>
            )}
            {message.humanHelpRequested && (
              <p className="alya-help-note">
                You requested human help. HR has not been notified.{' '}
                <button onClick={onOpenSupport}>Find your support contact</button>
              </p>
            )}
            {message.learning && (
              <span className="alya-answer-format">
                {learningFormats[message.learning.format] || 'Short explanation'}
              </span>
            )}
            {!message.intro && (
              <div className="alya-answer-footer">
                <span>
                  <Icon name={message.mode === 'demo' ? 'info' : 'book'} size={12} />
                  {message.mode === 'document-search'
                    ? message.passages?.length
                      ? 'From your connected company documents'
                      : 'No matching company passage'
                    : message.source || 'Company assistant'}
                </span>
                <button className="alya-view-visual" onClick={() => onViewVisual(message.id)}>
                  View visual
                  <Icon name="arrow" size={13} />
                </button>
                <button aria-label="Copy answer" onClick={() => onCopy(message.text)}>
                  <Icon name="copy" size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export default function AlyaChatPage({ navigate, employeeId }) {
  const activeChatKey = employeeId ? activeChatPrefix + '-' + employeeId : activeChatPrefix;
  const jsonRequest = (url, options = {}) =>
    requestJson(url, {
      ...options,
      headers: {
        ...options.headers,
        ...(employeeId ? { 'X-OnboardAi-Employee': employeeId } : {}),
      },
    });
  const [preferences, setPreferences] = useState(readPreferences),
    [speechState, setSpeechState] = useState({ state: 'idle', error: '' }),
    [config, setConfig] = useState(null),
    [connectionError, setConnectionError] = useState(''),
    [messages, setMessages] = useState([greeting]),
    [question, setQuestion] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [copied, setCopied] = useState(false);
  const [conversations, setConversations] = useState([]),
    [conversationId, setConversationId] = useState(''),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState(''),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const [learning, setLearning] = useState(null),
    [learningOpen, setLearningOpen] = useState(false),
    [learningBusy, setLearningBusy] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false),
    [supportError, setSupportError] = useState('');
  const visualWorkspace = useRef(null);
  const [selectedAnswerId, setSelectedAnswerId] = useState('');
  const [view, setView] = useState('chat');
  const speechRef = useRef(null),
    preferencesRef = useRef(preferences),
    request = useRef(null),
    sequence = useRef(0),
    chatLog = useRef(null),
    inputRef = useRef(null),
    configAbort = useRef(null),
    copyTimer = useRef(null),
    historyAbort = useRef(null),
    learningAbort = useRef(null);
  preferencesRef.current = preferences;
  useEffect(() => {
    const speech = createServerSpeech({ onStatus: setSpeechState });
    speechRef.current = speech;
    if (!speech.supported)
      setSpeechState({
        state: 'unavailable',
        error: 'Audio playback is unavailable in this browser. Text chat still works.',
      });
    const cancelOnLeave = () => speech.stop();
    window.addEventListener('pagehide', cancelOnLeave);
    return () => {
      sequence.current++;
      request.current?.abort();
      configAbort.current?.abort();
      historyAbort.current?.abort();
      learningAbort.current?.abort();
      clearTimeout(copyTimer.current);
      speech.dispose();
      window.removeEventListener('pagehide', cancelOnLeave);
      speechRef.current = null;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {}
  }, [preferences]);
  async function connect() {
    configAbort.current?.abort();
    const abort = new AbortController();
    configAbort.current = abort;
    setConnectionError('');
    setConfig(null);
    try {
      const data = await jsonRequest('/api/config', { signal: abort.signal });
      if (!Array.isArray(data.tasks) || !data.tasks.length) throw new Error();
      if (data.conversationMemory) {
        const list = await jsonRequest('/api/conversations', { signal: abort.signal });
        let active;
        try {
          active = localStorage.getItem(activeChatKey);
        } catch {}
        const selected = list.conversations.find((c) => c.id === active) || list.conversations[0];
        const chat = selected
          ? await jsonRequest('/api/conversations/' + selected.id, { signal: abort.signal })
          : await jsonRequest('/api/conversations', { method: 'POST', signal: abort.signal });
        abort.signal.throwIfAborted();
        applyChat(chat);
        setConversations(selected ? list.conversations : [chat]);
      }
      setConfig(data);
    } catch (error) {
      if (error.name !== 'AbortError')
        setConnectionError(
          error.message || 'The assistant connection is unavailable. Please try reconnecting.',
        );
    }
  }
  useEffect(() => {
    connect();
  }, []);
  function stopVoice() {
    speechRef.current?.stop();
  }
  function mute() {
    const enabled = !preferences.enabled;
    setPreferences({ ...preferences, enabled });
    if (!enabled) stopVoice();
  }
  function cancelRequest() {
    sequence.current++;
    request.current?.abort();
    setBusy(false);
    stopVoice();
  }
  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || 'The server could not complete that request. Please try again.',
      );
    return data;
  }
  function applyChat(chat) {
    setSelectedAnswerId('');
    setConversationId(chat.id);
    setLearning(chat.learning || null);
    setLearningOpen(false);
    try {
      localStorage.setItem(activeChatKey, chat.id);
    } catch {}
    setMessages([
      greeting,
      ...chat.messages.map((m, i) =>
        m.role === 'assistant'
          ? { ...m, ...presentAnswer(m.result), referenceQuestion: chat.messages[i - 1]?.text }
          : m,
      ),
    ]);
    setQuestion('');
    setDeleteConfirm(false);
  }
  async function changeChat(id = null, erase = false) {
    if (historyBusy || learningBusy || supportBusy) return;
    cancelRequest();
    historyAbort.current?.abort();
    const abort = new AbortController();
    historyAbort.current = abort;
    const token = sequence.current;
    setHistoryBusy(true);
    setHistoryError('');
    setDeleteConfirm(false);
    try {
      if (erase)
        await jsonRequest('/api/conversations/' + conversationId, {
          method: 'DELETE',
          signal: abort.signal,
        });
      const chat = id
        ? await jsonRequest('/api/conversations/' + id, { signal: abort.signal })
        : await jsonRequest('/api/conversations', { method: 'POST', signal: abort.signal });
      const list = await jsonRequest('/api/conversations', { signal: abort.signal });
      if (token !== sequence.current) return;
      applyChat(chat);
      setConversations(list.conversations);
      setHistoryOpen(false);
      inputRef.current?.focus();
    } catch (error) {
      if (error.name !== 'AbortError') setHistoryError(error.message);
    } finally {
      if (token === sequence.current) setHistoryBusy(false);
    }
  }
  function newChat() {
    if (config?.conversationMemory) {
      changeChat();
      return;
    }
    cancelRequest();
    setMessages([greeting]);
    setSelectedAnswerId('');
    setQuestion('');
    inputRef.current?.focus();
  }
  async function changeLearning(patch) {
    if (busy || historyBusy || learningBusy || supportBusy || !conversationId) return false;
    const abort = new AbortController(),
      token = sequence.current;
    learningAbort.current = abort;
    setLearningBusy(true);
    setHistoryError('');
    try {
      const result = await jsonRequest('/api/conversations/' + conversationId + '/learning', {
        method: 'POST',
        signal: abort.signal,
        body: JSON.stringify(patch),
      });
      if (token === sequence.current) {
        setLearning(result.learning);
      }
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') setHistoryError(error.message);
      return false;
    } finally {
      if (token === sequence.current) setLearningBusy(false);
    }
  }
  async function ask(text, retryId = null, retryRequestId = null) {
    const trimmed = text.trim();
    if (
      !trimmed ||
      trimmed.length > 1600 ||
      busy ||
      historyBusy ||
      learningBusy ||
      supportBusy ||
      !config ||
      (config.conversationMemory && !conversationId)
    )
      return;
    request.current?.abort();
    speechRef.current?.stop();
    if (preferencesRef.current.enabled) speechRef.current?.prime();
    const token = ++sequence.current,
      abort = new AbortController(),
      requestId = retryRequestId || crypto.randomUUID();
    request.current = abort;
    setBusy(true);
    setQuestion('');
    setLearningOpen(false);
    setHistoryOpen(false);
    setMessages((previous) =>
      retryId
        ? previous.filter((message) => message.id !== retryId)
        : [...previous, { id: requestId + '-u', role: 'user', text: trimmed }],
    );
    const timeout = setTimeout(() => abort.abort('timeout'), 65000);
    try {
      const task = config.tasks.find((task) => task.id === 'company-resources') || config.tasks[0];
      // Shared Kokoro audio is requested separately; no Google TTS is called.
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(employeeId ? { 'X-OnboardAi-Employee': employeeId } : {}),
        },
        signal: abort.signal,
        body: JSON.stringify({
          question: trimmed,
          taskId: task.id,
          style: 'simple',
          speechEnabled: false,
          conversationId,
          requestId,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'The assistant could not answer. Please try again.');
      const answer = presentAnswer(result);
      if (sequence.current !== token) return;
      setMessages((previous) => [
        ...previous,
        { id: requestId + '-a', role: 'assistant', ...answer, referenceQuestion: trimmed },
      ]);
      setSelectedAnswerId(requestId + '-a');
      if (result.learning) setLearning(result.learning);
      if (config.conversationMemory)
        setConversations((previous) => [
          {
            ...(previous.find((c) => c.id === conversationId) || {}),
            id: conversationId,
            title:
              previous.find((c) => c.id === conversationId)?.title === 'New conversation'
                ? trimmed.slice(0, 65)
                : previous.find((c) => c.id === conversationId)?.title || trimmed.slice(0, 65),
            updated: Date.now(),
          },
          ...previous.filter((c) => c.id !== conversationId),
        ]);
      if (preferencesRef.current.enabled)
        speechRef.current?.speak(answer.spoken, preferencesRef.current);
    } catch (error) {
      if (sequence.current !== token) return;
      if (error.name === 'AbortError' && abort.signal.reason !== 'timeout') return;
      const errorText =
        abort.signal.reason === 'timeout'
          ? 'The answer took too long. Please try again.'
          : error instanceof TypeError
            ? 'The server connection was interrupted. Please try again.'
            : error.message;
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          error: errorText,
          question: trimmed,
          requestId,
        },
      ]);
    } finally {
      clearTimeout(timeout);
      if (sequence.current === token) setBusy(false);
    }
  }
  async function feedback(message, rating) {
    if (busy || supportBusy || historyBusy) return;
    setSupportBusy(true);
    setSupportError('');
    const id = conversationId,
      token = sequence.current;
    try {
      const result = await jsonRequest('/api/conversations/' + id + '/feedback', {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id, rating }),
      });
      if (token !== sequence.current) return;
      setMessages((previous) =>
        previous.map((m) => (m.id === message.id ? { ...m, feedback: result.rating } : m)),
      );
    } catch (error) {
      setSupportError(error.message);
    } finally {
      setSupportBusy(false);
    }
  }
  async function humanHelp(message) {
    if (busy || supportBusy || historyBusy) return;
    setSupportBusy(true);
    setSupportError('');
    const token = sequence.current;
    try {
      const result = await jsonRequest('/api/conversations/' + conversationId + '/human-help', {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id }),
      });
      if (token !== sequence.current) return;
      setMessages((previous) =>
        previous.map((m) => (m.id === message.id ? { ...m, humanHelpRequested: true } : m)),
      );
    } catch (error) {
      setSupportError(error.message);
    } finally {
      setSupportBusy(false);
    }
  }
  async function requestSupport(message, format) {
    const changed = await changeLearning({ preference: format });
    if (!changed) return;
    const requestText = {
      steps: 'Please explain this step by step',
      example: 'Please give me a worked example',
      brief: 'Please keep it short',
    }[format];
    ask(
      requestText +
        (message.referenceQuestion ? ' for this question: ' + message.referenceQuestion : '.'),
    );
  }
  function viewVisual(id) {
    setSelectedAnswerId(id);
    setView('visual');
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  const speaking = speechState.state === 'speaking',
    voicing = speaking || speechState.state === 'starting';
  const modeLabel =
    config?.aiMode === 'document-search'
      ? 'Company document search'
      : config?.aiMode === 'demo'
        ? 'Sample answers · confirm with HR'
        : config?.conversationMemory
          ? 'Gemini · company knowledge · saved memory'
          : 'Company knowledge';
  return (
    <div className="alya-page">
      <header className="alya-page-heading">
        <div>
          <span className="uv-eyebrow">
            <span className="uv-page-number">03</span>YOUR ONBOARDING COMPANION
          </span>
          <h1>
            A familiar face.
            <br />
            <em>A clearer next step.</em>
          </h1>
        </div>
        <p>
          Ask your question. Alya will answer here
          <br />
          and speak it aloud when voice is on.
        </p>
      </header>
      <div className="alya-conversation-shell">
        <AvatarDisplay
          speechRef={speechRef}
          speaking={speaking}
          thinking={busy}
          reducedMotion={preferences.reducedMotion}
        />
        <div className="oa-answer-column">
          <div className="oa-switch" role="group" aria-label="Answer view">
            <button aria-pressed={view === 'chat'} onClick={() => setView('chat')}>
              Chat
            </button>
            <button aria-pressed={view === 'visual'} onClick={() => setView('visual')}>
              Visual guide
            </button>
          </div>
          <div className="alya-voice-toolbar">
            <button
              className={'alya-voice-toggle ' + (preferences.enabled ? 'on' : '')}
              aria-pressed={preferences.enabled}
              onClick={mute}
            >
              <Icon name={preferences.enabled ? 'volume' : 'mute'} size={16} />
              {preferences.enabled ? 'Voice on' : 'Voice off'}
            </button>
            {speechState.state === 'starting' && (
              <span className="alya-voice-preparing">Preparing voice…</span>
            )}
            {voicing && (
              <button className="alya-stop-voice" onClick={stopVoice}>
                <Icon name="stop" size={13} />
                Stop voice
              </button>
            )}
            <button
              className="alya-voice-settings"
              aria-label="Voice settings"
              aria-expanded={settings}
              aria-controls="alya-voice-options"
              onClick={() => setSettings(!settings)}
            >
              <Icon name="settings" size={16} />
            </button>
          </div>
          {settings && (
            <div className="alya-voice-options" id="alya-voice-options">
              <div className="alya-shared-voice-label">
                <strong>Alya · Heart</strong>
                <p>English female voice · the same voice for every visitor.</p>
              </div>
              <label>
                Speaking speed
                <select
                  value={preferences.rate}
                  onChange={(event) => {
                    stopVoice();
                    setPreferences({ ...preferences, rate: Number(event.target.value) });
                  }}
                >
                  <option value={0.85}>Slower</option>
                  <option value={0.95}>Natural</option>
                  <option value={1.05}>Faster</option>
                </select>
              </label>
              <label className="alya-motion-option">
                <input
                  type="checkbox"
                  checked={preferences.reducedMotion}
                  onChange={(e) =>
                    setPreferences({ ...preferences, reducedMotion: e.target.checked })
                  }
                />
                Reduce avatar movement
              </label>
              <p>
                Voice generated by the server with Kokoro. Speed changes apply to the next answer.
                Mouth timing is approximate.
              </p>
            </div>
          )}
          {view === 'visual' && (
            <VisualAnswerPanel
              messages={messages}
              selectedId={selectedAnswerId}
              onSelect={setSelectedAnswerId}
              workspaceRef={visualWorkspace}
              busy={busy}
            />
          )}
          <section className="alya-chat-panel" aria-label="Chat with Alya" hidden={view !== 'chat'}>
            <header className="alya-chat-heading">
              <div>
                <Icon name="chat" size={19} />
                <h2>Let’s talk.</h2>
              </div>
              <button
                className="alya-new-chat"
                disabled={!config || historyBusy || learningBusy || supportBusy}
                onClick={newChat}
              >
                <Icon name="spark" size={14} />
                New chat
              </button>
            </header>
            <div className="alya-connection">
              <span className={'uv-small-dot ' + (config ? 'mint' : '')} />
              <span>
                {connectionError
                  ? 'Connection unavailable'
                  : config
                    ? modeLabel
                    : 'Connecting to your assistant…'}
              </span>
              {config?.aiMode === 'document-search' && (
                <span className="alya-no-ai-bill">SEARCH PREVIEW</span>
              )}
            </div>
            {config?.conversationMemory && (
              <div className="alya-memory-control">
                <div className="alya-memory-bar">
                  <button
                    onClick={() => {
                      setHistoryOpen(!historyOpen);
                      setLearningOpen(false);
                      setDeleteConfirm(false);
                    }}
                    aria-expanded={historyOpen}
                    aria-controls="alya-saved-chats"
                  >
                    <Icon name="clock" size={13} />
                    Saved chats <span>{conversations.length}</span>
                    <Icon name="down" size={12} />
                  </button>
                  {config.adaptiveLearning ? (
                    <button
                      className="alya-learning-toggle"
                      aria-expanded={learningOpen}
                      aria-controls="alya-learning-options"
                      onClick={() => {
                        setLearningOpen(!learningOpen);
                        setHistoryOpen(false);
                      }}
                    >
                      <Icon name="book" size={13} />
                      {learningBusy ? 'Saving…' : 'Answer style'}
                      <Icon name="down" size={12} />
                    </button>
                  ) : (
                    <span>
                      {historyBusy ? 'Loading conversation…' : 'Remembers this conversation'}
                    </span>
                  )}
                </div>
                {learningOpen && (
                  <AnswerStyleSettings
                    learning={learning}
                    disabled={busy || historyBusy || learningBusy || supportBusy}
                    onSettings={changeLearning}
                    onClose={() => setLearningOpen(false)}
                  />
                )}
                {historyOpen && (
                  <div className="alya-saved-chats" id="alya-saved-chats">
                    <p>
                      Reopen a chat to continue where you left off. Chats expire after 30 days
                      without activity.
                    </p>
                    <div className="alya-chat-list">
                      {conversations.map((chat) => (
                        <button
                          key={chat.id}
                          className={chat.id === conversationId ? 'selected' : ''}
                          disabled={historyBusy}
                          onClick={() => changeChat(chat.id)}
                        >
                          <Icon name="chat" size={13} />
                          <span>{chat.title}</span>
                          <small>
                            {chat.id === conversationId
                              ? 'Current'
                              : new Date(chat.updated).toLocaleDateString()}
                          </small>
                        </button>
                      ))}
                    </div>
                    {deleteConfirm ? (
                      <div className="alya-delete-confirm">
                        <p>Delete this chat and its saved memory?</p>
                        <button disabled={historyBusy} onClick={() => changeChat(null, true)}>
                          Delete chat
                        </button>
                        <button onClick={() => setDeleteConfirm(false)}>Keep chat</button>
                      </div>
                    ) : (
                      <button
                        className="alya-delete-chat"
                        disabled={busy || historyBusy}
                        onClick={() => setDeleteConfirm(true)}
                      >
                        Delete current chat
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {supportError && (
              <p role="alert" className="alya-inline-error">
                {supportError}
              </p>
            )}
            {historyError && (
              <div className="alya-inline-error" role="alert">
                <p>{historyError}</p>
                <button onClick={() => setHistoryError('')}>Dismiss</button>
              </div>
            )}
            <div
              className="alya-chat-log"
              ref={chatLog}
              role="log"
              aria-label="Conversation with Alya"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {messages.map((message) => (
                <Message
                  message={message}
                  key={message.id}
                  onRetry={(item) => ask(item.question, item.id, item.requestId)}
                  onCopy={copy}
                  onFeedback={feedback}
                  onSupport={requestSupport}
                  onViewVisual={viewVisual}
                  onHumanHelp={humanHelp}
                  onOpenSupport={() => navigate('/support')}
                  disabled={busy || historyBusy || learningBusy || supportBusy}
                  memoryEnabled={config?.conversationMemory}
                />
              ))}
              {busy && (
                <div className="alya-chat-thinking" role="status">
                  <span className="alya-message-mark">A</span>
                  <span>Alya is finding your answer</span>
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
            {connectionError && (
              <div className="alya-inline-error" role="alert">
                <p>{connectionError}</p>
                <button onClick={connect}>Reconnect</button>
              </div>
            )}
            {speechState.error && preferences.enabled && (
              <p className="alya-voice-error" role="status">
                <Icon name="info" size={14} />
                {speechState.error}
              </p>
            )}
            <div className="alya-composer-area">
              <form
                className="alya-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  ask(question);
                }}
              >
                <label className="alya-question-label" htmlFor="alya-question">
                  Your question
                </label>
                <textarea
                  id="alya-question"
                  ref={inputRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={2}
                  maxLength={1600}
                  placeholder="Ask about UniVRse or any onboarding task…"
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      ask(question);
                    }
                  }}
                />
                <div className="alya-composer-bottom">
                  <span>
                    {question.length
                      ? `${question.length} / 1600`
                      : 'Enter to send · Shift + Enter for a new line'}
                  </span>
                  {busy ? (
                    <button
                      type="button"
                      className="alya-send cancel"
                      aria-label="Cancel answer"
                      onClick={cancelRequest}
                    >
                      <Icon name="stop" size={17} />
                    </button>
                  ) : (
                    <button
                      className="alya-send"
                      aria-label="Send question"
                      disabled={
                        !question.trim() || !config || historyBusy || learningBusy || supportBusy
                      }
                    >
                      <Icon name="arrow" size={21} />
                    </button>
                  )}
                </div>
              </form>
              <p className="alya-chat-caption">
                Keep passwords and private employee details out of chat.
                {config?.conversationMemory && (
                  <> Saved to this browser session on the server for up to 30 days.</>
                )}
              </p>
            </div>
          </section>
        </div>
      </div>
      <div className="alya-page-footnote">
        <span>
          <Icon name="shield" size={14} />
          Local employee preview · answers are not HR approval
        </span>
        <button onClick={() => navigate('/support')}>
          Need a person? Find support <Icon name="arrow" size={15} />
        </button>
      </div>
      {copied && (
        <div className="alya-copy-toast" role="status">
          <Icon name="check" size={16} />
          Answer copied
        </div>
      )}
    </div>
  );
}
