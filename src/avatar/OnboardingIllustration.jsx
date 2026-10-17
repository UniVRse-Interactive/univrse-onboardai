import React from 'react';
import AnswerIllustrations from './AnswerIllustrations';

const ink = '#344c61',
  paper = '#fff9ed',
  mint = '#bad2cf',
  navy = '#526d85';

// These graphics illustrate the subject, never a task's completion or approval.
// Dates, entitlement amounts and addresses are deliberately not invented.
export default function OnboardingIllustration({ visual }) {
  const { kind } = visual;
  if (['computer', 'document', 'people', 'meeting', 'conversation'].includes(kind))
    return <AnswerIllustrations part={{ scene: kind }} small />;
  const time = visual.times?.[0]?.match(/(\d{1,2})(?:[.:](\d{2}))?\s*([ap])?/i);
  return (
    <svg
      className="onboarding-artwork"
      viewBox="0 0 260 260"
      fill="none"
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="130" cy="130" r="104" fill="#f9f3df" opacity=".3" />
      <ellipse cx="130" cy="229" rx="70" ry="7" fill={ink} opacity=".07" />
      {kind === 'time' && (
        <>
          <circle cx="130" cy="127" r="84" fill={paper} stroke={ink} strokeWidth="2" />
          <circle cx="130" cy="127" r="73" stroke={mint} strokeWidth="5" />
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d="M130 62V68"
              stroke={ink}
              strokeWidth="2"
              transform={`rotate(${i * 30} 130 127)`}
            />
          ))}
          {time && (
            <>
              <path
                d="M130 127V88"
                stroke={ink}
                strokeWidth="5"
                transform={`rotate(${(Number(time[1]) % 12) * 30 + Number(time[2] || 0) * 0.5} 130 127)`}
              />
              <path
                d="M130 127V71"
                stroke={navy}
                strokeWidth="3"
                transform={`rotate(${Number(time[2] || 0) * 6} 130 127)`}
              />
              <circle cx="130" cy="127" r="5" fill={ink} />
            </>
          )}
          {!time && (
            <path
              d="M105 123Q105 100 130 100Q154 100 154 118Q154 129 131 140V150M131 163V165"
              stroke={navy}
              strokeWidth="4"
            />
          )}
        </>
      )}
      {kind === 'leave' && (
        <>
          <path d="M51 62H209V210H51Z" fill={paper} stroke={ink} strokeWidth="2" />
          <path d="M51 62H209V99H51Z" fill={navy} />
          <path d="M87 48V77M173 48V77" stroke={ink} strokeWidth="6" />
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={72 + col * 32}
                y={119 + row * 26}
                width="17"
                height="13"
                rx="3"
                fill={mint}
                opacity={row === 1 && col === 2 ? 1 : 0.45}
              />
            )),
          )}
          <path
            d="M189 200Q207 158 230 145Q237 183 212 203Q201 209 189 200ZM190 203L222 160"
            fill={mint}
            stroke={ink}
            strokeWidth="1.5"
          />
        </>
      )}
      {kind === 'tasks' && (
        <>
          <rect
            x="65"
            y="51"
            width="131"
            height="165"
            rx="8"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <rect
            x="101"
            y="38"
            width="60"
            height="25"
            rx="7"
            fill={navy}
            stroke={ink}
            strokeWidth="2"
          />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x="84"
                y={84 + i * 36}
                width="17"
                height="17"
                rx="3"
                stroke={ink}
                strokeWidth="1.7"
              />
              <path
                d={`M114 ${92 + i * 36}H176M114 ${100 + i * 36}H157`}
                stroke={navy}
                strokeWidth="2"
              />
            </g>
          ))}
          <path
            d="M204 92L219 98 180 197 166 208 166 190Z"
            fill={mint}
            stroke={ink}
            strokeWidth="2"
          />
        </>
      )}
      {kind === 'arrival' && (
        <>
          <path
            d="M45 115L98 99 157 117 215 99V204L157 219 98 201 45 217Z"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M98 99V201M157 117V219" stroke={mint} strokeWidth="2" />
          <path
            d="M62 181L88 161 122 181 173 153 198 168"
            stroke={navy}
            strokeWidth="3"
            strokeDasharray="4 7"
          />
          <path
            d="M130 41C101 41 84 62 92 87C97 103 130 132 130 132C130 132 163 103 168 87C176 62 159 41 130 41Z"
            fill={mint}
            stroke={ink}
            strokeWidth="2"
          />
          <circle cx="130" cy="76" r="13" fill={paper} stroke={ink} strokeWidth="2" />
        </>
      )}
      {kind === 'security' && (
        <>
          <path
            d="M130 40L203 69V127C203 168 169 203 130 220C91 203 57 168 57 127V69Z"
            fill={mint}
            stroke={ink}
            strokeWidth="2"
          />
          <rect
            x="98"
            y="110"
            width="64"
            height="52"
            rx="8"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M110 110V92C110 64 150 64 150 92V110" stroke={navy} strokeWidth="7" />
          <circle cx="130" cy="131" r="5" fill={navy} />
          <path d="M130 134V143" stroke={navy} strokeWidth="4" />
        </>
      )}
      {kind === 'payroll' && (
        <>
          <path d="M70 46H174L195 69V210H70Z" fill={paper} stroke={ink} strokeWidth="2" />
          <path
            d="M174 46V69H195M91 91H171M91 105H153M91 124H167M91 143H146"
            stroke={navy}
            strokeWidth="2"
          />
          <path d="M91 165H171V187H91Z" fill={mint} />
          <g stroke={ink} strokeWidth="1.5">
            <ellipse cx="191" cy="199" rx="27" ry="9" fill={mint} />
            <path d="M164 184V199C164 211 218 211 218 199V184" fill={mint} />
            <ellipse cx="191" cy="184" rx="27" ry="9" fill={paper} />
          </g>
        </>
      )}
      {kind === 'approval' && (
        <>
          <path
            d="M81 49H179M81 211H179M91 52C91 103 112 108 130 129C148 108 169 103 169 52M91 208C91 157 112 151 130 129C148 151 169 157 169 208"
            stroke={ink}
            strokeWidth="4"
          />
          <path
            d="M105 77H155Q155 95 130 115Q105 95 105 77ZM103 193Q112 168 130 153Q148 168 157 193Z"
            fill={mint}
          />
        </>
      )}
      {kind === 'company' && (
        <>
          <path
            d="M65 216V57H164V216M164 101H205V216M48 216H219"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={82 + col * 24}
                y={77 + row * 27}
                width="12"
                height="13"
                rx="2"
                fill={mint}
              />
            )),
          )}
          <path
            d="M103 216V186H127V216M181 123H191M181 146H191M181 169H191"
            stroke={navy}
            strokeWidth="3"
          />
        </>
      )}
    </svg>
  );
}
