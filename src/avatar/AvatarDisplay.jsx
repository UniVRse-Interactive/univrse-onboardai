import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';

export default function AvatarDisplay({ speechRef, speaking, thinking, reducedMotion = false }) {
  const motion = useRef(reducedMotion);
  motion.current = reducedMotion;
  const container = useRef(null),
    [phase, setPhase] = useState('loading'),
    [description, setDescription] = useState('Loading your original avatar…'),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let controller;
    setPhase('loading');
    setDescription('Loading your original avatar…');
    import('./avatar-renderer')
      .then(({ createAvatarScene }) => {
        if (abort.signal.aborted) return;
        return createAvatarScene(container.current, {
          signal: abort.signal,
          getSpeechFrame: (now) => speechRef.current?.getFrame(now),
          getReducedMotion: () => motion.current,
          onPhase: (state, text) => {
            if (!abort.signal.aborted) {
              setPhase(state);
              setDescription(text);
            }
          },
        });
      })
      .then((value) => {
        controller = value;
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && !abort.signal.aborted) {
          setPhase('unavailable');
          setDescription(error.message);
        }
      });
    return () => {
      abort.abort();
      controller?.dispose();
    };
  }, [attempt, speechRef]);
  return (
    <section
      className={'alya-avatar-stage ' + (speaking ? 'speaking' : '')}
      aria-label="Alya avatar"
    >
      <div className="alya-office" aria-hidden="true">
        <div className="alya-office-window" />
        <div className="alya-office-frame frame-one" />
        <div className="alya-office-frame frame-two" />
        <div className="alya-office-shelf" />
        <div className="alya-office-plant" />
      </div>
      {phase !== 'ready' && (
        <img
          className="alya-avatar-poster"
          src="/avatars/alya/poster.png"
          alt="Your original Alya avatar in a navy suit"
        />
      )}
      <div className="alya-canvas" ref={container} style={{ opacity: phase === 'ready' ? 1 : 0 }} />
      <div className="alya-stage-top">
        <span className="alya-stage-brand">UNIVRSE / ONBOARDAI</span>
        <span className="alya-original-label">YOUR ORIGINAL AVATAR</span>
      </div>
      {phase !== 'ready' && (
        <div className="alya-model-state" role="status">
          {phase === 'loading' ? (
            <>
              <span className="alya-loader" />
              {description}
            </>
          ) : (
            <>
              <Icon name="info" size={16} />
              <span>{description}</span>
              <button onClick={() => setAttempt(attempt + 1)}>Retry 3D</button>
            </>
          )}
        </div>
      )}
      <div className="alya-stage-bottom">
        <div className="alya-avatar-name">
          <span className="uv-small-dot mint" />
          <div>
            <strong>Alya</strong>
            <small>Your onboarding companion</small>
          </div>
        </div>
        <div className={'alya-presence ' + (speaking ? 'speaking' : '')} role="status">
          {speaking ? (
            <>
              <span className="alya-wave">
                <i />
                <i />
                <i />
                <i />
              </span>
              Speaking
            </>
          ) : thinking ? (
            <>
              <span className="alya-thinking-dot" />
              Finding your answer
            </>
          ) : (
            <>
              <Icon name="chat" size={15} />
              Ready for your question
            </>
          )}
        </div>
      </div>
    </section>
  );
}
