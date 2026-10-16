import React, { useId, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import AnswerIllustrations from './AnswerIllustrations';
import useVisualTextPages from './use-visual-text-pages';
import { visualPageAt } from './visual-text-pagination.mjs';

function AnswerWords({ text }) {
  const important =
    /^(?:not allowed|not permitted|not required|prohibited|only|unless|except|before approval|after approval|weekdays)$/i;
  return text
    .split(
      /(\b(?:not allowed|not permitted|not required|prohibited|only|unless|except|before approval|after approval|weekdays)\b)/gi,
    )
    .map((word, i) =>
      important.test(word) ? (
        <strong className="av-important-word" key={i}>
          {word}
        </strong>
      ) : (
        word
      ),
    );
}

// Reading controls change presentation only; they never mark work as completed.
export default function IllustratedAnswer({ guide, question }) {
  const [position, setPosition] = useState({ part: 0, character: 0 });
  const regionId = useId(),
    dialogId = useId(),
    fullAnswer = useRef(null);
  const active = position.part,
    item = guide.items[active],
    count = guide.items.length;
  const steps = guide.kind === 'steps',
    noun = steps ? 'Step' : 'Part';
  const { viewport, measure, pages } = useVisualTextPages(guide.grounded ? item.plain : guide.text);
  const page = visualPageAt(pages, position.character);
  const first = active === 0 && page === 0;
  const last = active === count - 1 && page === pages.length - 1;
  function choosePart(part) {
    setPosition({ part, character: 0 });
  }
  function turnPage(direction) {
    const next = page + direction;
    if (next >= 0 && next < pages.length) {
      setPosition({ part: active, character: pages[next].start });
    } else if (active + direction >= 0 && active + direction < count) {
      setPosition({
        part: active + direction,
        character: direction < 0 ? Number.MAX_SAFE_INTEGER : 0,
      });
    }
  }
  return (
    <div className="av-explanation">
      <div className="av-question" title={question}>
        <Icon name="chat" size={15} />
        <p>{question}</p>
      </div>
      {guide.grounded && count > 1 && (
        <div className="av-chapters">
          {count > 4 ? (
            <label className="av-part-picker">
              Explore the answer
              <select
                aria-label="Visual answer part"
                value={active}
                onChange={(e) => choosePart(Number(e.target.value))}
              >
                {guide.items.map((part, index) => (
                  <option key={index} value={index}>
                    {noun} {index + 1}: {part.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <ol
              className={steps ? 'av-chapter-list sequence' : 'av-chapter-list'}
              style={{ '--chapter-columns': count }}
              aria-label={steps ? 'Illustrated answer steps' : 'Illustrated answer subjects'}
            >
              {guide.items.map((part, index) => (
                <li key={index}>
                  <button
                    className={active === index ? 'selected' : ''}
                    aria-label={noun + ' ' + (index + 1) + ': ' + part.title}
                    aria-pressed={active === index}
                    aria-controls={regionId}
                    onClick={() => choosePart(index)}
                    title={part.title}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <Icon name={part.icon} size={16} />
                    <span className="av-chapter-name">{part.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="av-infographic" id={regionId}>
        <figure className="av-illustration">
          <span className="av-plate-index" aria-hidden="true">
            {String(active + 1).padStart(2, '0')}
          </span>
          <AnswerIllustrations part={guide.grounded ? item : { scene: 'conversation' }} />
          <figcaption>
            {!guide.grounded
              ? 'A NOTE FROM ALYA'
              : guide.example
                ? 'EXAMPLE ILLUSTRATION'
                : steps
                  ? 'ONE STEP AT A TIME'
                  : 'THE IDEA, ILLUSTRATED'}
          </figcaption>
        </figure>
        <section className="av-reading" aria-label="Selected visual explanation" tabIndex={0}>
          <div className="av-reading-heading">
            <span className="av-reading-position">
              {guide.grounded ? noun + ' ' + (active + 1) + ' of ' + count : 'Alya’s reply'}
              {pages.length > 1 ? ' · Page ' + (page + 1) + ' of ' + pages.length : ''}
              {guide.example ? ' · Example' : ''}
            </span>
            <h3 title={guide.grounded ? item.title : undefined}>
              {guide.grounded ? item.title : 'Here’s the answer.'}
            </h3>
            {!!item.times?.length && guide.grounded && (
              <div className="av-time-labels" aria-label="Times mentioned in this answer">
                {item.times.map((time) => (
                  <span key={time}>
                    <Icon name="clock" size={16} />
                    {time}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="av-text-viewport" ref={viewport}>
            <p className="av-page-copy" aria-live="polite" aria-atomic="true">
              <AnswerWords text={pages[page].text} />
            </p>
            <p className="av-page-copy av-page-measure" ref={measure} aria-hidden="true" />
          </div>
          <span className="av-page-note">
            {pages.length > 1 ? 'Read every page in this part.' : ' '}
          </span>
        </section>
      </div>
      <nav className="av-navigation" aria-label="Visual explanation navigation">
        <button disabled={first} aria-label="Previous page" onClick={() => turnPage(-1)}>
          <Icon name="arrow" size={16} />
          Back
        </button>
        <span>
          {active + 1} / {count}
          <small>
            {pages.length > 1 ? 'Page ' + (page + 1) + ' of ' + pages.length : 'At your pace'}
          </small>
        </span>
        <button disabled={last} aria-label="Next page" onClick={() => turnPage(1)}>
          Next
          <Icon name="arrow" size={16} />
        </button>
      </nav>
      <footer className="av-source-footer">
        <span>
          <Icon name={guide.grounded ? 'book' : 'info'} size={14} />
          {guide.grounded ? 'From your company documents' : 'No linked company source'}
        </span>
        <button onClick={() => fullAnswer.current?.showModal()}>
          Full answer
          <Icon name="book" size={14} />
        </button>
      </footer>
      <dialog className="av-answer-dialog" ref={fullAnswer} aria-labelledby={dialogId}>
        <header>
          <div>
            <span className="av-paper-label">ORIGINAL ANSWER</span>
            <h2 id={dialogId}>The full picture.</h2>
          </div>
          <button
            autoFocus
            aria-label="Close full answer"
            onClick={() => fullAnswer.current?.close()}
          >
            <Icon name="close" size={22} />
          </button>
        </header>
        <p className="av-dialog-question">{question}</p>
        <div className="av-dialog-text" tabIndex={0}>
          {guide.text}
        </div>
        <p className="av-dialog-source">
          {guide.grounded
            ? 'Based on the linked company passages shown in chat.'
            : 'This reply has no linked company source.'}
        </p>
      </dialog>
    </div>
  );
}
