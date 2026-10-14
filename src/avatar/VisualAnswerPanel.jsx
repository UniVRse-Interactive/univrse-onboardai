import React, { useId } from 'react';
import Icon from '../portal/Icon';
import IllustratedAnswer from './IllustratedAnswer';
import AnswerIllustrations from './AnswerIllustrations';
import { visualAnswer } from './visual-answer-content.mjs';
import './visual-answer.css';

export default function VisualAnswerPanel({ messages, selectedId, onSelect, workspaceRef, busy }) {
  const answers = messages.filter((m) => m.role === 'assistant' && !m.intro && !m.error);
  const selected = answers.find((m) => m.id === selectedId) || answers.at(-1);
  const guide = visualAnswer(selected);
  const pickerId = useId();
  return (
    <section
      className="alya-visual-workspace"
      ref={workspaceRef}
      tabIndex={-1}
      aria-labelledby="alya-visual-workspace-title"
      aria-busy={busy}
    >
      <header>
        <div>
          <span className="av-section-label">VISUAL ANSWER</span>
          <h2 id="alya-visual-workspace-title">Your visual guide.</h2>
        </div>
        {!!answers.length && (
          <div className="av-answer-picker">
            <label htmlFor={pickerId}>Choose an answer</label>
            <select
              id={pickerId}
              disabled={busy}
              value={selected?.id || ''}
              onChange={(e) => onSelect(e.target.value)}
            >
              {answers.map((m, index) => (
                <option key={m.id} value={m.id}>
                  {index + 1}.{' '}
                  {(m.referenceQuestion || 'Alya’s answer').length > 75
                    ? (m.referenceQuestion || 'Alya’s answer').slice(0, 72) + '…'
                    : m.referenceQuestion || 'Alya’s answer'}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>
      {busy ? (
        <div className="alya-visual-empty" role="status">
          <Icon name="spark" size={30} />
          <div>
            <h3>Alya is preparing your answer…</h3>
            <p>Your visual panel will update when the answer arrives.</p>
          </div>
        </div>
      ) : guide ? (
        <>
          <div className="av-question">
            <Icon name="chat" size={17} />
            <p>{selected.referenceQuestion || 'Company guidance'}</p>
          </div>
          <IllustratedAnswer key={selected.id} guide={guide} />
        </>
      ) : (
        <div className="alya-visual-empty">
          <AnswerIllustrations part={{ scene: 'document' }} />
          <div>
            <h3>See the answer, step by step.</h3>
            <p>Ask a company or onboarding question. Its visual guide will appear here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
