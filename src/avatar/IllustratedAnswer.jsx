import React, { useId, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import AnswerIllustrations from './AnswerIllustrations';

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

export default function IllustratedAnswer({ guide }) {
  const [active, setActive] = useState(0),
    [mode, setMode] = useState('visual');
  const regionId = useId(),
    pictures = useRef([]),
    item = guide.items[active],
    steps = guide.kind === 'steps';
  const count = guide.items.length,
    multiple = count > 1,
    noun = steps ? 'Step' : 'Part';
  function select(index) {
    setActive(index);
    const picture = pictures.current[index],
      strip = picture?.closest('.av-picture-list');
    if (picture && strip) {
      const left = picture.offsetLeft - strip.offsetLeft;
      if (
        left < strip.scrollLeft ||
        left + picture.offsetWidth > strip.scrollLeft + strip.clientWidth
      )
        strip.scrollTo({ left: Math.max(0, left - 20), behavior: 'auto' });
    }
  }
  return (
    <div className="av-explanation">
      <div className="av-controls">
        <p>
          {guide.grounded
            ? mode === 'visual'
              ? 'Choose a picture. Read the guidance beside it.'
              : 'All parts of the original answer.'
            : 'Alya’s reply is shown below.'}
        </p>
        {guide.grounded && (
          <div role="group" aria-label="Visual answer view">
            <button aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}>
              <Icon name="sun" size={16} />
              Visual view
            </button>
            <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
              <Icon name="book" size={16} />
              All details
            </button>
          </div>
        )}
      </div>
      {!guide.grounded ? (
        <div className="av-reply">
          <Icon name="chat" size={30} />
          <div>
            <h3>Alya’s reply</h3>
            <p>{guide.text}</p>
          </div>
        </div>
      ) : mode === 'visual' ? (
        <div className="av-learning-board">
          <div className="av-picture-space">
            <ol
              className={'av-picture-list ' + (steps ? 'sequence' : 'subjects')}
              style={{ '--av-count': count }}
              aria-label={steps ? 'Illustrated answer steps' : 'Illustrated answer subjects'}
            >
              {guide.items.map((part, index) => (
                <li key={index}>
                  <button
                    ref={(element) => {
                      pictures.current[index] = element;
                    }}
                    className={active === index ? 'selected' : ''}
                    aria-label={noun + ' ' + (index + 1) + ': ' + part.title}
                    aria-pressed={active === index}
                    aria-controls={regionId}
                    onClick={() => select(index)}
                  >
                    <span className="av-picture-number" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <AnswerIllustrations part={part} />
                    <span className="av-picture-title">{part.title}</span>
                    <span className="av-picture-selection">
                      {active === index ? 'Selected' : 'View this part'}
                      <Icon name={active === index ? 'down' : 'arrow'} size={13} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="av-picture-caption">
              <span>
                <i aria-hidden="true" />
                {guide.example ? 'Example illustration' : 'Illustrated guidance'}
              </span>
              <small>{multiple ? count + ' parts · choose where to start' : 'One part'}</small>
            </div>
          </div>
          <div className="av-reading" id={regionId}>
            <div className="av-reading-content" aria-live="polite" aria-atomic="true">
              <span className="av-reading-position">
                {noun} {active + 1}
                {multiple ? ' of ' + count : ''}
                {guide.example ? ' · Worked example' : ''}
              </span>
              <h3>{item.title}</h3>
              <p>
                <AnswerWords text={item.plain} />
              </p>
              {!!item.times?.length && (
                <div className="av-time-labels" aria-label="Times mentioned in this answer">
                  {item.times.map((time) => (
                    <span key={time}>
                      <Icon name="clock" size={15} />
                      {time}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {item.plain !== item.body && (
              <details className="av-original">
                <summary>
                  Original wording
                  <Icon name="down" size={13} />
                </summary>
                <p>{item.body}</p>
              </details>
            )}
            {multiple && (
              <div className="av-navigation">
                <button
                  disabled={active === 0}
                  aria-label={'Previous ' + noun.toLowerCase()}
                  onClick={() => select(active - 1)}
                >
                  <Icon name="arrow" size={16} />
                  Back
                </button>
                <button
                  disabled={active === count - 1}
                  aria-label={'Next ' + noun.toLowerCase()}
                  onClick={() => select(active + 1)}
                >
                  Next {noun.toLowerCase()}
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ol className="av-all-details">
          {guide.items.map((part, index) => (
            <li key={index}>
              <div className="av-detail-picture">
                <AnswerIllustrations part={part} small />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div>
                <span>
                  {noun} {index + 1}
                  {guide.example ? ' · Worked example' : ''}
                </span>
                <h3>{part.title}</h3>
                <p>{part.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <footer className="av-source-footer">
        <span>
          <Icon name={guide.grounded ? 'book' : 'info'} size={14} />
          {guide.grounded
            ? 'Based on your linked company documents'
            : 'No linked company source for this reply'}
        </span>
        <details>
          <summary>
            Full answer
            <Icon name="down" size={13} />
          </summary>
          <p>{guide.text}</p>
        </details>
      </footer>
    </div>
  );
}
