import React from 'react';

// Original SVG illustrations: no generated policy screenshots, stock people,
// or decorative charts with invented values. All instructions are in HTML.
const ink = '#2d4365',
  paper = '#f7fafd',
  plum = '#6e93ae',
  pink = '#256a91',
  mint = '#b8dfe3';
function Person({ x = 0, y = 0, shirt = plum }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-27 74q2-36 27-36t27 36" fill={shirt} />
      <path d="M-8 35v10q8 7 16 0V35" fill="#d5a687" />
      <ellipse cy="18" rx="18" ry="21" fill="#e7bd9c" />
      <path d="M-18 18q-8-34 19-33 26 2 17 34l-5-19q-16 14-29 10Z" fill={ink} />
      <path d="M-7 19h1m11 0h1M-4 28q4 3 8 0" stroke={ink} strokeWidth="2" fill="none" />
    </g>
  );
}
function Paper({ x = 0, y = 0, rotate = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect width="92" height="116" rx="5" fill={paper} stroke={ink} strokeWidth="2" />
      <path d="M17 21h40M17 32h58" stroke={ink} strokeWidth="3" />
      <path
        d="m16 51 4 4 7-8m-11 25 4 4 7-8m-11 25 4 4 7-8"
        stroke="#546947"
        strokeWidth="3"
        fill="none"
      />
      <path d="M35 52h39M35 73h31M35 94h39" stroke={plum} strokeWidth="3" />
    </g>
  );
}
function Garment({ kind, ripped }) {
  if (kind === 'jeans')
    return (
      <g>
        <path d="m-33 0 66 0-7 94h-24l-2-61-2 61h-24Z" fill={plum} stroke={ink} strokeWidth="2" />
        <path
          d="M-32 9h64M0 10v20m-25-19q2 18 12 18m38-18q-2 18-12 18"
          stroke={paper}
          strokeWidth="2"
        />
        {ripped && <path d="m-27 48 18 2m-19 5 18 2m4 15 18 2" stroke={paper} strokeWidth="3" />}
      </g>
    );
  if (kind === 'shorts')
    return (
      <g>
        <path
          d="m-35 0 70 0-5 54h-24L0 22l-6 32h-24Z"
          fill="#8dafbc"
          stroke={ink}
          strokeWidth="2"
        />
        <path d="M-33 10h66M0 10v14m-29 24h20m18 0h20" stroke={paper} strokeWidth="2" />
      </g>
    );
  if (kind === 'slippers')
    return (
      <g transform="translate(0 16)">
        <path
          d="M-33 0q-15 1-15 23v35q0 17 17 16t18-16V22Q-13 0-33 0Zm48 0Q0 1 0 23v35q0 17 17 16t18-16V22Q35 0 15 0Z"
          fill={mint}
          stroke={ink}
          strokeWidth="2"
        />
        <path d="M-46 29q14-12 29 0M3 29q14-12 29 0" stroke={ink} strokeWidth="5" />
      </g>
    );
  return (
    <g>
      <path
        d="m-24 0 12-8 12 8 12-8 12 8 24 24-19 20-8-10v59h-42V34l-8 10-19-20Z"
        fill={kind === 'collared' ? plum : paper}
        stroke={ink}
        strokeWidth="2"
      />
      {kind === 'collared' ? (
        <>
          <path d="m-12-8 12 8 12-8-3 24L0 8l-9 8Z" fill={paper} stroke={ink} strokeWidth="2" />
          <path d="M0 11v15" stroke={ink} strokeWidth="2" />
        </>
      ) : (
        <path d="M-12-8q12 18 24 0" stroke={ink} strokeWidth="2" />
      )}
    </g>
  );
}
export default function AnswerIllustrations({ part, small = false }) {
  const scene = part.scene;
  const sourceTime = part.times?.[0]?.match(/(\d{1,2})(?:[.:](\d{2}))?\s*([AP])\.?M\.?/i);
  const hourAngle = sourceTime
    ? (Number(sourceTime[1]) % 12) * 30 + Number(sourceTime[2] || 0) * 0.5
    : null;
  const minuteAngle = sourceTime ? Number(sourceTime[2] || 0) * 6 : null;
  return (
    <svg
      className="av-artwork"
      viewBox="0 0 320 260"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="162" cy="224" rx="106" ry="12" fill="#ded2c8" />
      {scene === 'document' && (
        <>
          <path d="M77 65h158v142H77Z" fill="#c9d9da" stroke={ink} strokeWidth="2" />
          <path d="M77 65v142h158" stroke={ink} strokeWidth="3" />
          <Paper x={103} y={46} rotate={-7} />
          <rect
            x="127"
            y="33"
            width="46"
            height="18"
            rx="6"
            fill={plum}
            stroke={ink}
            strokeWidth="2"
          />
          <g transform="translate(231 96) rotate(17)">
            <rect width="12" height="104" rx="3" fill={pink} stroke={ink} strokeWidth="2" />
            <path d="m0 104 6 16 6-16" fill={paper} stroke={ink} strokeWidth="2" />
            <path d="M1 18h10" stroke={ink} strokeWidth="2" />
          </g>
          <path
            d="M53 117h25m-13-28 18 12M205 30l8-16"
            stroke={plum}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect
            x="66"
            y="178"
            width="78"
            height="32"
            rx="3"
            fill={mint}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M80 190h40m-40 9h27" stroke={ink} strokeWidth="2" />
        </>
      )}
      {scene === 'conversation' && (
        <>
          <Person x={99} y={143} shirt={plum} />
          <Person x={229} y={143} shirt={mint} />
          <path
            d="M53 42h135q10 0 10 10v57q0 10-10 10h-51l-23 21v-21H53q-10 0-10-10V52q0-10 10-10Z"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          {part.tag ? (
            <text x="66" y="87" fill={ink} fontSize="22" fontFamily="sans-serif" fontWeight="600">
              {part.tag}
            </text>
          ) : (
            <>
              <path
                d="M64 64h87M64 78h109M64 92h64"
                stroke={plum}
                strokeWidth="4"
                strokeLinecap="round"
              />
            </>
          )}
          <path
            d="M185 96h82q10 0 10 10v39q0 10-10 10h-19v14l-19-14h-44q-10 0-10-10v-39q0-10 10-10Z"
            fill="#f5dba2"
            stroke={ink}
            strokeWidth="2"
          />
          <circle cx="199" cy="127" r="4" fill={ink} />
          <circle cx="225" cy="127" r="4" fill={ink} />
          <circle cx="251" cy="127" r="4" fill={ink} />
        </>
      )}
      {scene === 'people' && (
        <>
          <rect
            x="58"
            y="55"
            width="205"
            height="159"
            rx="8"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M58 87h205" stroke={ink} strokeWidth="2" />
          <circle cx="74" cy="71" r="3" fill={pink} />
          <circle cx="87" cy="71" r="3" fill={mint} />
          <Person x={112} y={108} shirt={plum} />
          <path
            d="M155 119h75m-75 14h55m-55 14h68"
            stroke={plum}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M155 167h66" stroke={ink} strokeWidth="3" />
          <path
            d="M218 40h50q10 0 10 10v29q0 10-10 10h-20l-17 16V89h-13q-10 0-10-10V50q0-10 10-10Z"
            fill={mint}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M239 53v25m-10-12h20" stroke={ink} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {scene === 'time' && (
        <>
          <path d="M74 55h163v160H74Z" fill={paper} stroke={ink} strokeWidth="2" />
          <path d="M74 92h163" stroke={ink} strokeWidth="2" />
          <rect x="74" y="55" width="163" height="36" fill={plum} />
          <path d="M110 39v32m91-32v32" stroke={ink} strokeWidth="5" strokeLinecap="round" />
          <path d="M95 114h119m-119 26h89m-89 26h105m-105 26h75" stroke="#aac3ca" strokeWidth="7" />
          <circle cx="232" cy="175" r="49" fill={mint} stroke={ink} strokeWidth="2" />
          <circle cx="232" cy="175" r="38" stroke={ink} strokeWidth="2" />
          <path
            d="M232 143v5m32 27h-5m-27 32v-5m-32-27h5"
            stroke={ink}
            strokeWidth="3"
            strokeLinecap="round"
          />
          {sourceTime && (
            <>
              <path
                d="M232 175v-19"
                stroke={ink}
                strokeWidth="3"
                strokeLinecap="round"
                transform={`rotate(${hourAngle} 232 175)`}
              />
              <path
                d="M232 175v-29"
                stroke={ink}
                strokeWidth="2"
                strokeLinecap="round"
                transform={`rotate(${minuteAngle} 232 175)`}
              />
            </>
          )}
        </>
      )}
      {scene === 'clothing' && part.clothes?.length > 0 ? (
        <>
          <path
            d="M35 219V49h250v170M24 219h24m225 0h23"
            stroke={ink}
            strokeWidth="4"
            strokeLinecap="round"
          />
          {part.clothes.map((kind, i) => {
            const x =
              part.clothes.length === 1
                ? 160
                : part.clothes.length === 2
                  ? 95 + i * 130
                  : 72 + i * 88;
            if (kind === 'slippers')
              return (
                <g key={kind} transform={`translate(${x} 140) scale(.85)`}>
                  <Garment kind={kind} />
                </g>
              );
            return (
              <g key={kind} transform={`translate(${x} 80)`}>
                <path
                  d="M0-17q0-9 7-9t7 7q0 5-14 13V7m0 0-34 16h68L0 7"
                  stroke={ink}
                  strokeWidth="2"
                />
                <g transform={`translate(0 32) scale(${part.clothes.length > 2 ? 0.78 : 1})`}>
                  <Garment kind={kind} ripped={part.ripped} />
                </g>
              </g>
            );
          })}
        </>
      ) : (
        scene === 'clothing' && (
          <>
            <path
              d="M57 213V41h209v172M45 213h36m171 0h29"
              stroke={ink}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M162 63q0-11 9-11 8 0 8 8 0 6-8 11v12m0 0-59 30h119l-60-30"
              stroke={ink}
              strokeWidth="2"
            />
            <path
              d="m120 112 30-16 21 15 21-15 30 16 19 47-27 11-9-21v65h-70v-65l-9 21-26-11Z"
              fill={plum}
              stroke={ink}
              strokeWidth="2"
            />
            <path
              d="m150 97 21 54 21-54m-21 54v63m-29-40h16m26 0h16"
              stroke={paper}
              strokeWidth="3"
            />
            <path
              d="M77 67q0-9 7-9 8 0 8 8 0 6-8 10v12m0 0-28 15h56L84 88"
              stroke={ink}
              strokeWidth="2"
            />
          </>
        )
      )}
      {scene === 'computer' && (
        <>
          <path
            d="M70 59h184q9 0 9 9v124H61V68q0-9 9-9Z"
            fill={plum}
            stroke={ink}
            strokeWidth="2"
          />
          <rect x="74" y="73" width="175" height="104" rx="3" fill={paper} />
          <path d="M74 96h175" stroke={ink} strokeWidth="2" />
          <circle cx="86" cy="85" r="3" fill={pink} />
          <circle cx="99" cy="85" r="3" fill={mint} />
          <rect x="91" y="112" width="60" height="45" rx="4" fill="#e4e9df" />
          <path d="m99 122 22 15 22-15m-44 26 14-10m29 10-13-10" stroke={ink} strokeWidth="2" />
          <path
            d="M166 121h62m-62 15h48m-48 15h61"
            stroke={plum}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="m61 192-22 20q0 7 10 7h222q10 0 10-7l-18-20Z"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M139 201h41" stroke={ink} strokeWidth="3" />
        </>
      )}
      {scene === 'company' && (
        <>
          <rect
            x="42"
            y="65"
            width="83"
            height="139"
            rx="12"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <rect x="51" y="81" width="65" height="100" rx="4" fill="#d9e3df" />
          <path
            d="m66 119 18-10 18 10v21l-18 10-18-10Zm0 0 18 10 18-10m-18 10v21"
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M74 73h20m-16 119h13" stroke={ink} strokeWidth="3" strokeLinecap="round" />
          <path d="M152 98q7-31 58-31t57 31" stroke={ink} strokeWidth="9" />
          <path
            d="M142 104q0-15 16-15h110q16 0 16 15v47q0 16-16 16h-27l-11-11h-32l-11 11h-30q-15 0-15-16Z"
            fill={plum}
            stroke={ink}
            strokeWidth="2"
          />
          <path
            d="M158 111h52v31h-52Zm66 0h44v31h-44Z"
            fill="#cbdcad"
            stroke={ink}
            strokeWidth="2"
          />
          <path d="m157 111 25 15 28-15m14 0 22 15 22-15" stroke={ink} strokeWidth="2" />
          <path
            d="M177 191h82q9 0 14 13l8 13q3 12-9 11l-27-17h-40l-24 17q-14 1-11-12l-1-12q1-13 8-13Z"
            fill="#f2d28b"
            stroke={ink}
            strokeWidth="2"
          />
          <path d="M191 197v16m-8-8h16" stroke={ink} strokeWidth="3" />
          <circle cx="249" cy="203" r="3" fill={ink} />
          <circle cx="259" cy="212" r="3" fill={ink} />
        </>
      )}
      {scene === 'meeting' && (
        <>
          <rect
            x="73"
            y="42"
            width="179"
            height="103"
            rx="3"
            fill={paper}
            stroke={ink}
            strokeWidth="2"
          />
          <path
            d="M90 64h63m-63 17h112m-112 17h92"
            stroke={plum}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <Person x={68} y={140} shirt={plum} />
          <Person x={251} y={140} shirt={mint} />
          <Person x={156} y={112} shirt={pink} />
          <path d="m74 182 181 0 35 24H39Z" fill="#cab8a5" stroke={ink} strokeWidth="2" />
          <path d="M65 206v22m192-22v22" stroke={ink} strokeWidth="4" />
          <path d="m127 170 58 0 10 23h-76Z" fill={paper} stroke={ink} strokeWidth="2" />
        </>
      )}
      {!small && (
        <path
          d="m38 42 5 0m-2-3v6M282 58h6m-3-3v6"
          stroke={plum}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
