import React, { useEffect, useRef, useState } from 'react';
import AlyaPresentationStage from './AlyaPresentationStage';
import Icon from '../portal/Icon';
import { createServerSpeech } from './answer-audio-player';
import { answerReply, presentAnswer } from './chat-answer-presentation.mjs';
import { replySentences } from './short-answer.mjs';
import { answerPresentation } from './answer-presentation.mjs';
export { presentAnswer } from './chat-answer-presentation.mjs';
import AnswerStyleSettings, { learningFormats } from './AnswerStyleSettings';
import './answer-support-controls.css';
import './alya-chat.css';
import './alya-workspace.css';
import './alya-presentation.css';
import './clothing-presentation.css';
import './automatic-presentation.css';

const preferenceKey = 'univrse-alya-voice-v1';
const activeChatKey = 'univrse-alya-active-chat-v1';
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
  text: 'Hi, I’m Alya. Welcome to OnboardAi. Ask me about your company or any onboarding task.',
  intro: true,
};
function Message({
  message,
  onRetry,
  onCopy,
  onFeedback,
  onSupport,
  onHumanHelp,
  onOpenSupport,
  disabled,
  memoryEnabled,
  formatsEnabled = true,
  guestWorkspace = false,
}) {
  if (message.role === 'user')
    return (
      <article className="alya-message user">
        <span>You</span>
        <p>{message.text}</p>
      </article>
    );
  const sentences = message.intro || message.error ? [] : replySentences(answerReply(message));
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
            {message.learning?.format === 'steps' && !message.intro ? (
              <ol className="alya-short-steps" aria-label="Explanation in smaller steps">
                {replySentences(answerReply(message)).map((sentence, index) => (
                  <li key={index}>{sentence}</li>
                ))}
              </ol>
            ) : message.intro ? (
              <p>{message.text}</p>
            ) : (
              <div className="alya-short-reply">
                <p className="alya-answer-lead">{sentences[0]}</p>
                {sentences.length > 1 && <p>{sentences.slice(1).join(' ')}</p>}
              </div>
            )}
            {!message.intro && (
              <details className="alya-full-reply">
                <summary>
                  Full answer & conditions <Icon name="down" size={13} />
                </summary>
                <p>{message.text}</p>
                {message.passages?.length > 0 && (
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
                )}
              </details>
            )}
            {!message.intro && !message.error && memoryEnabled && (
              <details className="alya-help-controls">
                <summary>
                  {formatsEnabled ? 'Need another explanation?' : 'Need human support?'}
                  <Icon name="down" size={13} />
                </summary>
                <div className="alya-answer-tools" aria-label="Answer support options">
                  {formatsEnabled && (
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
                    </>
                  )}
                  <button
                    disabled={disabled || message.humanHelpRequested}
                    onClick={() => onHumanHelp(message)}
                  >
                    <Icon name="people" size={13} />I need a person
                  </button>
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
                {guestWorkspace
                  ? 'Your request is included in this workspace’s HR report. It does not send a notification. '
                  : 'You requested human help. HR has not been notified. '}
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

export default function AlyaChatPage({ navigate, guestId = null }) {
  const apiBase = guestId ? '/api/guest-workspace/guests/' + guestId : '/api';
  const savedChatKey = guestId ? 'onboardai-guest-chat-' + guestId : activeChatKey;
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
  const [selectedAnswerId, setSelectedAnswerId] = useState('');
  const [spokenAnswerId, setSpokenAnswerId] = useState('');
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
          active = localStorage.getItem(savedChatKey);
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
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    const log = chatLog.current;
    if (!log) return;
    // Wait for the memory toolbar and pane sizing before positioning the reply.
    // Only the chat transcript moves; the page and visual guide stay in place.
    let frame;
    let followingReply = true;
    const revealReply = () => {
      if (!followingReply || !log.getClientRects().length) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const latest = log.querySelector('.alya-message:last-of-type');
        if (!busy && messages.at(-1)?.role === 'assistant' && latest)
          log.scrollTop = Math.max(0, log.scrollHeight - latest.offsetHeight - 34);
        else log.scrollTop = log.scrollHeight;
      });
    };
    // Keep the reply in view while the window/fonts settle, until the reader
    // starts navigating the transcript themselves.
    const pauseFollowing = () => {
      followingReply = false;
      cancelAnimationFrame(frame);
    };
    const resize = new ResizeObserver(revealReply);
    resize.observe(log);
    const readingEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
    readingEvents.forEach((event) =>
      log.addEventListener(event, pauseFollowing, { passive: true }),
    );
    revealReply();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      readingEvents.forEach((event) => log.removeEventListener(event, pauseFollowing));
    };
  }, [lastMessageId, busy, conversationId, Boolean(config)]);
  function stopVoice() {
    speechRef.current?.stop();
  }
  function speakAnswer(message) {
    const text = answerReply(message);
    const presentation = answerPresentation(message, text);
    speechRef.current?.speak(text, {
      ...preferencesRef.current,
      segments: presentation?.scenes.map((scene) => scene.body),
    });
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
  async function jsonRequest(url, options = {}) {
    const response = await fetch(apiBase + url.slice(4), {
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
      localStorage.setItem(savedChatKey, chat.id);
    } catch {}
    setMessages([
      greeting,
      ...chat.messages.map((m, i) =>
        m.role === 'assistant'
          ? { ...m, ...presentAnswer(m.result, chat.messages[i - 1]?.text) }
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
      const response = await fetch(apiBase + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const answer = presentAnswer(result, trimmed);
      if (sequence.current !== token) return;
      setMessages((previous) => [
        ...previous,
        { id: requestId + '-a', role: 'assistant', ...answer },
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
      if (preferencesRef.current.enabled) {
        setSpokenAnswerId(requestId + '-a');
        speakAnswer(answer);
      }
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
      await jsonRequest('/api/conversations/' + conversationId + '/human-help', {
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
      brief: 'Please keep the answer brief',
    }[format];
    ask(
      requestText +
        (message.referenceQuestion ? ' for this question: ' + message.referenceQuestion : '.'),
    );
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
  function replay(message) {
    if (busy || !preferencesRef.current.enabled) return;
    setSpokenAnswerId(message.id);
    speakAnswer(message);
  }
  return (
    <div className="alya-page alya-live-page">
      <div className="alya-conversation-shell alya-live-shell">
        <AlyaPresentationStage
          messages={messages}
          selectedAnswerId={selectedAnswerId}
          onSelectAnswer={(id) => {
            stopVoice();
            setSelectedAnswerId(id);
          }}
          speechRef={speechRef}
          speaking={speaking}
          voicing={voicing}
          thinking={busy}
          spokenAnswerId={spokenAnswerId}
          reducedMotion={preferences.reducedMotion}
          voiceEnabled={preferences.enabled}
          onReplay={replay}
        />
        <div className="alya-answer-space">
          <div className="alya-view-panels">
            <section
              className="alya-chat-panel"
              id="alya-chat-view"
              aria-label="Conversation with Alya"
            >
              <header className="alya-chat-heading">
                <div>
                  <h2>Conversation.</h2>
                </div>
                <button
                  className="alya-new-chat"
                  disabled={!config || historyBusy || learningBusy || supportBusy}
                  onClick={newChat}
                >
                  <Icon name="chat" size={14} />
                  New chat
                </button>
              </header>
              {!config && !connectionError && (
                <p className="alya-connect-pending" role="status">
                  Getting Alya ready…
                </p>
              )}
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
                      <span>{historyBusy ? 'Loading conversation…' : 'Saved conversations'}</span>
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
                        Reopen a saved chat to continue.{' '}
                        {guestId
                          ? 'This guest workspace expires after 24 hours without activity.'
                          : 'Chats expire after 30 days without activity.'}
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
              {historyError && (
                <div className="alya-inline-error" role="alert">
                  <p>{historyError}</p>
                  <button onClick={() => setHistoryError('')}>Dismiss</button>
                </div>
              )}
              {supportError && (
                <div className="alya-inline-error" role="alert">
                  <p>{supportError}</p>
                  <button onClick={() => setSupportError('')}>Dismiss</button>
                </div>
              )}
              <div
                className="alya-chat-log"
                ref={chatLog}
                role="log"
                tabIndex={0}
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
                    onHumanHelp={humanHelp}
                    onOpenSupport={() => navigate('/support')}
                    disabled={busy || historyBusy || learningBusy || supportBusy}
                    memoryEnabled={config?.conversationMemory}
                    formatsEnabled={config?.answerFormatsAvailable !== false}
                    guestWorkspace={!!guestId}
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
            </section>
          </div>
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
                placeholder="Ask about your company or onboarding…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
                  <p>Heart is Alya’s English voice. Everyone hears the same voice.</p>
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
                  Reduce movement
                </label>
                <p>
                  Speed applies to the next answer. Reduced movement calms animations while visuals
                  and Alya’s mouth continue to follow her voice.
                </p>
              </div>
            )}
            <p className="alya-chat-caption">
              Keep passwords and private employee details out of chat.
              {guestId ? (
                <> Support requests and feedback update your onboarding summary.</>
              ) : (
                config?.conversationMemory && (
                  <> Saved to this browser session on the server for up to 30 days.</>
                )
              )}
            </p>
          </div>
        </div>
      </div>
      <div className="alya-page-footnote">
        <span>
          <Icon name="shield" size={14} />
          {guestId
            ? (config?.employeeName || 'Employee') + ' · your onboarding space'
            : 'Company guidance · answers are not HR approval'}
        </span>
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
