import React, { useEffect, useState } from 'react';
import Icon from '../portal/Icon';
import ClothingScene from './ClothingPresentation';
import OnboardingIllustration from './OnboardingIllustration';
import AutomaticCaption from './AutomaticCaption';
import { presentationSceneAt } from './answer-presentation.mjs';

function OnboardingScene({ scene, visible, index, character }) {
  return (
    <div
      className={'automatic-scene' + (visible ? ' is-current' : '')}
      aria-hidden={!visible}
      data-scene={index}
    >
      <div className="automatic-scene-title">
        <span className="automatic-eyebrow">{scene.eyebrow}</span>
        <h2>{scene.label}</h2>
      </div>
      {scene.visuals.map((visual, side) => (
        <figure key={side} className={'automatic-cue ' + (side ? 'from-right' : 'from-left')}>
          <div className="automatic-floating-art">
            <div className="automatic-art">
              <OnboardingIllustration visual={visual} />
            </div>
          </div>
          <figcaption>{visual.label}</figcaption>
          <span className="automatic-cue-rule" />
        </figure>
      ))}
      <AutomaticCaption text={scene.body} character={character} />
    </div>
  );
}

export default function AutomaticPresentation({
  presentation,
  speechRef,
  active,
  reducedMotion,
  onReplay,
  voiceEnabled,
}) {
  const [position, setPosition] = useState({ index: -1, character: 0 });
  const current = position.index;
  useEffect(() => {
    if (!active) {
      setPosition({ index: -1, character: 0 });
      return;
    }
    let frame;
    function follow() {
      const character = speechRef.current?.getProgress();
      if (character != null)
        setPosition((previous) => {
          const next = presentationSceneAt(presentation, character);
          return previous.index === next && previous.character === character
            ? previous
            : { index: next, character };
        });
      frame = requestAnimationFrame(follow);
    }
    follow();
    return () => cancelAnimationFrame(frame);
  }, [presentation, speechRef, active]);
  const visibleScenes = presentation.scenes.filter((scene) => scene.visible);
  return (
    <section
      className={'automatic-presentation' + (reducedMotion ? ' is-calm' : '')}
      aria-label="Automatic onboarding presentation"
      data-presentation-kind={presentation.kind}
    >
      {presentation.scenes.map((scene, index) => {
        if (!scene.visible) return null;
        const Scene = scene.garments?.length ? ClothingScene : OnboardingScene;
        return (
          <Scene
            key={index}
            scene={scene}
            index={index}
            visible={active && current === index}
            character={current === index ? Math.max(0, position.character - scene.start) : 0}
          />
        );
      })}
      {active && current >= 0 && (
        <div className="automatic-sequence" aria-hidden="true">
          <span className="automatic-voice-dot" />
          <span>ALYA EXPLAINS</span>
          <div>
            {visibleScenes.map((scene, index) => (
              <i
                key={index}
                className={presentation.scenes.indexOf(scene) <= current ? 'has-played' : ''}
              />
            ))}
          </div>
          <span>
            {visibleScenes.indexOf(presentation.scenes[current]) + 1} / {visibleScenes.length}
          </span>
        </div>
      )}
      {!active && (
        <div className="automatic-replay">
          <span>
            {voiceEnabled ? 'Your onboarding, explained by Alya.' : 'Your guidance is in chat.'}
          </span>
          {voiceEnabled && (
            <button type="button" onClick={onReplay}>
              <Icon name="volume" size={14} /> Listen again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
