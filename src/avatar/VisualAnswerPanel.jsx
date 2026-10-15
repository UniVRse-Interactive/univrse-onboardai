import React, { useId } from 'react';
import Icon from '../portal/Icon';
import IllustratedAnswer from './IllustratedAnswer';
import AnswerIllustrations from './AnswerIllustrations';
import { visualAnswer } from './visual-answer-content.mjs';
import './visual-answer.css';

export default function VisualAnswerPanel({
  messages,
  selectedId,
  onSelect,
  busy,
  hidden = false,
}) {
  const answers = messages.filter((m) => m.role === 'assistant' && !m.intro && !m.error);
  const selected = answers.find((m) => m.id === selectedId) || answers.at(-1);
  const guide = visualAnswer(selected);
  const pickerId = useId();
  return (
    <section
      className="alya-visual-workspace"
      role="tabpanel"
      id="alya-visual-view"
      aria-labelledby="alya-tab-visual"
      aria-busy={busy}
      hidden={hidden}
    >
      <header>
        <div className="av-panel-title">
          <span className="av-section-label">THE CLEARER PICTURE</span>
          <h2 id="alya-visual-workspace-title">Your visual guide.</h2>
        </div>
        {!!answers.length && (
          <div className="av-answer-picker">
            <label htmlFor={pickerId}>Answer</label>
            <select
              id={pickerId}
              disabled={busy}
              value={selected?.id || ''}
              onChange={(e) => onSelect(e.target.value)}
            >
              {answers.map((m, index) => (
                <option key={m.id} value={m.id}>
                  {index + 1}.{' '}
                  {(m.referenceQuestion || 'Alya’s answer').length > 65
                    ? (m.referenceQuestion || 'Alya’s answer').slice(0, 62) + '…'
                    : m.referenceQuestion || 'Alya’s answer'}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>
      {busy ? (
        <div className="alya-visual-empty" role="status">
          <AnswerIllustrations part={{ scene: 'document' }} />
          <span className="av-paper-label">ONE MOMENT</span>
          <h3>Finding the clearer picture.</h3>
          <p>Your guide will appear here with Alya’s answer.</p>
        </div>
      ) : guide ? (
        <IllustratedAnswer
          key={selected.id}
          guide={guide}
          question={selected.referenceQuestion || 'Alya’s answer'}
        />
      ) : (
        <div className="alya-visual-empty">
          <AnswerIllustrations part={{ scene: 'document' }} />
          <span className="av-paper-label">FROM QUESTION TO CLARITY</span>
          <h3>A little easier to picture.</h3>
          <p>
            Ask Alya a company or onboarding question. Its illustrated explanation appears here
            automatically.
          </p>
          <div className="av-empty-key">
            <Icon name="chat" size={17} /> Ask <span aria-hidden="true">→</span>
            <Icon name="book" size={17} /> See <span aria-hidden="true">→</span>
            <Icon name="arrow" size={17} /> Explore
          </div>
        </div>
      )}
    </section>
  );
}
