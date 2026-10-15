import React from 'react';

// Original vector artwork; no stock image or avatar model dependency.
export default function DecorativeWebsiteIllustration({ variant = 'gateway' }) {
  return (
    <div className={'uv-mission-scene ' + variant} aria-hidden="true">
      <div className="uv-scene-label">
        <span>U / 01</span> YOUR ENTRY POINT
      </div>
      <svg viewBox="0 0 600 560" fill="none">
        <defs>
          <linearGradient
            id="chrome"
            x1="180"
            y1="95"
            x2="416"
            y2="425"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f7fafd" />
            <stop offset=".16" stopColor="#99aebe" />
            <stop offset=".28" stopColor="#f7fafd" />
            <stop offset=".42" stopColor="#3c5677" />
            <stop offset=".62" stopColor="#ccebef" />
            <stop offset=".8" stopColor="#7d94aa" />
            <stop offset="1" stopColor="#f7fafd" />
          </linearGradient>
          <linearGradient
            id="portal-light"
            x1="236"
            y1="176"
            x2="369"
            y2="422"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#b8e5eb" />
            <stop offset=".48" stopColor="#99aebe" />
            <stop offset="1" stopColor="#2d4365" />
          </linearGradient>
          <radialGradient id="core">
            <stop stopColor="#b8e5eb" stopOpacity=".75" />
            <stop offset="1" stopColor="#7d94aa" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id="floor"
            x1="300"
            y1="405"
            x2="300"
            y2="540"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#536c88" />
            <stop offset="1" stopColor="#2d4365" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="haze">
            <feGaussianBlur stdDeviation="25" />
          </filter>
        </defs>
        <ellipse cx="302" cy="300" rx="169" ry="166" fill="url(#core)" filter="url(#haze)" />
        <path
          d="m93 439 207-73 207 73-207 86z"
          fill="url(#floor)"
          stroke="#99bccc"
          strokeOpacity=".5"
        />
        <path d="m93 439 207 87 207-87v17l-207 86-207-86z" fill="#b8e5eb" stroke="#99bccc" />
        <g stroke="#99bccc" strokeOpacity=".3">
          <path d="m155 417 208 90m-146-111 208 91m-178-102 208 91m-268 27 208-75m-150 99 208-76m-149 101 208-75" />
        </g>
        <path
          d="M206 419V201c0-75 44-119 101-119s101 44 101 119v218l-25 10V201c0-59-33-94-76-94s-76 35-76 94v228z"
          fill="url(#chrome)"
          stroke="#99bccc"
          strokeOpacity=".6"
        />
        <path
          d="M231 428V201c0-59 33-94 76-94s76 35 76 94v227"
          stroke="#99bccc"
          strokeWidth="8"
          filter="url(#glow)"
        />
        <path d="M234 427V201c0-57 31-91 73-91s73 34 73 91v226" stroke="#99bccc" strokeWidth="2" />
        <path
          d="M242 424V204c0-51 27-82 65-82s65 31 65 82v220l-65 23z"
          fill="url(#portal-light)"
          fillOpacity=".4"
        />
        <path
          d="m243 425 64 21 65-21m-119-21 54 18 54-18m-101-20 47 15 47-15m-87-20 40 13 40-13m-75-20 35 12 35-12"
          stroke="#99bccc"
          strokeOpacity=".35"
        />
        <path
          d="M106 290c43-74 374-83 396-11 32 103-299 183-361 117"
          stroke="#99bccc"
          strokeOpacity=".45"
          strokeDasharray="4 8"
        />
        <g transform="translate(86 219)">
          <path d="m0 15 35-20 35 20-35 20z" fill="#b8e5eb" />
          <path d="m0 15 35 20v41L0 55z" fill="#b8e5eb" />
          <path d="m35 35 35-20v40L35 76z" fill="#b8e5eb" />
          <path d="m0 15 35 20 35-20m-35 20v41" stroke="#99bccc" strokeOpacity=".8" />
        </g>
        <g transform="translate(449 149) rotate(18)">
          <path d="m0 0 27-15L54 0 27 15z" fill="#b8e5eb" />
          <path d="M0 0v31l27 16V15z" fill="#b8e5eb" />
          <path d="m27 15 27-15v31L27 47z" fill="#b8e5eb" />
        </g>
        <g stroke="#99bccc">
          <path d="M478 355v18m-9-9h18" />
          <circle cx="170" cy="152" r="3" fill="#b8e5eb" />
        </g>
        <g stroke="#99bccc" strokeOpacity=".55">
          <path d="M289 242h13m9 0h13m-17-18v13m0 9v13" />
          <path d="M64 118h33m-33 0v33m459 271v33h-33" />
        </g>
        <text x="468" y="402" fill="#b8e5eb" fontSize="9" fontFamily="monospace">
          NEXT / YOU
        </text>
      </svg>
      <div className="uv-scene-caption">
        <span className="uv-live-dot" /> A NEW WORLD AWAITS
      </div>
    </div>
  );
}
