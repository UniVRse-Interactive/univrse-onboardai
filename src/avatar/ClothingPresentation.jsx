import React from 'react';
import ClothingIllustration, { garmentLabels } from './ClothingIllustration';
import AutomaticCaption from './AutomaticCaption';

export default function ClothingScene({ scene, visible, index, caption }) {
  const midpoint = Math.ceil(scene.garments.length / 2);
  const groups =
    scene.garments.length > 1
      ? [scene.garments.slice(0, midpoint), scene.garments.slice(midpoint)]
      : [scene.garments];
  return (
    <div
      className={'automatic-scene' + (visible ? ' is-current' : '')}
      aria-hidden={!visible}
      data-scene={index}
    >
      <div className={'automatic-scene-title' + (scene.avoid ? ' is-avoid' : '')}>
        <span className="automatic-eyebrow">
          {scene.avoid
            ? 'KEEP IT WORK APPROPRIATE'
            : scene.conditional
              ? 'FOLLOW YOUR DRESS CODE'
              : 'YOUR OFFICE WARDROBE'}
        </span>
        <h2>
          {scene.avoid && (
            <span className="automatic-avoid-mark" aria-hidden="true">
              ╱
            </span>
          )}
          {scene.label}
        </h2>
      </div>
      {groups.map((garments, group) => (
        <figure key={group} className={'automatic-cue ' + (group ? 'from-right' : 'from-left')}>
          <div className="automatic-floating-art">
            <div className="automatic-art">
              <ClothingIllustration scene={{ ...scene, garments }} />
            </div>
          </div>
          <figcaption>{garments.map((kind) => garmentLabels[kind]).join(' / ')}</figcaption>
          <span className="automatic-cue-rule" />
        </figure>
      ))}
      <AutomaticCaption text={scene.body} {...caption} />
    </div>
  );
}
