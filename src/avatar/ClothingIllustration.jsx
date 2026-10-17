import React, { useId } from 'react';

export const garmentLabels = {
  outfit: 'Shirt + trousers',
  collared: 'Smart shirt',
  blouse: 'Neat blouse',
  shirt: 'T-shirt',
  jeans: 'Jeans',
  trousers: 'Tailored trousers',
  skirt: 'Suitable skirt',
  shorts: 'Shorts',
  slippers: 'Slippers',
  sleepwear: 'Sleepwear',
  beachwear: 'Beachwear',
  blazer: 'Blazer',
  dress: 'Office dress',
  shoes: 'Closed-toe shoes',
};

function Garment({ kind, ripped, colors }) {
  const { fabric, dark, light, seam } = colors;
  if (kind === 'outfit')
    return (
      <g>
        <g transform="translate(-13 -34) scale(.8)">
          <Garment kind="collared" colors={colors} />
        </g>
        <g transform="translate(19 48) scale(.64)">
          <Garment kind="trousers" colors={colors} />
        </g>
      </g>
    );
  if (['jeans', 'trousers', 'shorts'].includes(kind))
    return (
      <g strokeLinejoin="round">
        <path
          d={
            kind === 'shorts'
              ? 'M-35-53H35L32 17H8L0-9-8 17H-32Z'
              : 'M-33-53H33L29 61H7L0-12-7 61H-29Z'
          }
          fill={kind === 'jeans' ? '#557c9d' : dark}
          stroke={seam}
          strokeWidth="1.4"
        />
        <path
          d="M-32-41H32M0-41V-12M-25-40Q-24-23-13-24M25-40Q24-23 13-24"
          fill="none"
          stroke={light}
          strokeOpacity=".5"
          strokeWidth="1.2"
        />
        <path d="M-15-20L-18 55M15-20L18 55" stroke={light} strokeOpacity=".22" />
        <path d="M-26-51V-42M-12-51V-42M12-51V-42M26-51V-42" stroke={seam} strokeWidth="2.5" />
        <circle cy="-47" r="1.6" fill="#d0b586" />
        {ripped && (
          <path d="M-26 4L-10 6M-25 10L-11 12M10 25L25 27" stroke={light} strokeWidth="3" />
        )}
      </g>
    );
  if (kind === 'skirt')
    return (
      <g>
        <path d="M-24-51H24L43 51Q0 65-43 51Z" fill={fabric} stroke={seam} strokeWidth="1.4" />
        <path
          d="M-24-40H24M-13-39L-26 52M13-39L26 52M0-39V56"
          fill="none"
          stroke={seam}
          strokeOpacity=".4"
        />
        <path d="M-21-36L-31 48M9-35L19 51" stroke={light} strokeOpacity=".5" strokeWidth="5" />
      </g>
    );
  if (kind === 'slippers' || kind === 'shoes')
    return (
      <g fill={kind === 'shoes' ? dark : fabric} stroke={seam} strokeWidth="1.5">
        <g transform="rotate(-14 -23 0)">
          <rect x="-41" y="-48" width="32" height="98" rx="16" />
          <path
            d={
              kind === 'shoes' ? 'M-40-6Q-25-29-10-6L-11 28Q-25 39-39 28Z' : 'M-39-10L-25-30-11-10'
            }
            fill={kind === 'shoes' ? light : 'none'}
            strokeWidth="4"
          />
        </g>
        <g transform="rotate(14 23 0)">
          <rect x="9" y="-48" width="32" height="98" rx="16" />
          <path
            d={kind === 'shoes' ? 'M10-6Q25-29 40-6L39 28Q25 39 11 28Z' : 'M11-10L25-30 39-10'}
            fill={kind === 'shoes' ? light : 'none'}
            strokeWidth="4"
          />
        </g>
      </g>
    );
  if (kind === 'beachwear' || kind === 'dress')
    return (
      <g>
        <path
          d={
            kind === 'dress'
              ? 'M-20-56L-7-61Q0-50 7-61L20-56 32-34 21-23 16-29 13-4 40 54Q0 66-40 54L-13-4-16-29-21-23-32-34Z'
              : 'M-25-51L-9-56 0-28 9-56 25-51 17-14 26 42 10 54 0 32-10 54-26 42-17-14Z'
          }
          fill={fabric}
          stroke={seam}
          strokeWidth="1.5"
        />
        <path
          d="M-14-5Q0 1 14-5M-15 4H15M-5 13L-18 50M5 13L18 50"
          fill="none"
          stroke={light}
          strokeOpacity=".6"
          strokeWidth="2"
        />
      </g>
    );
  if (kind === 'sleepwear')
    return (
      <g>
        <g transform="translate(23 35) scale(.65)">
          <path
            d="M-33-53H33L29 61H7L0-12-7 61H-29Z"
            fill="#91b7c2"
            stroke={seam}
            strokeWidth="1.5"
          />
          <path
            d="M-22-40V52M-12-40V33M12-40V33M22-40V52"
            stroke={light}
            strokeWidth="3"
            strokeOpacity=".7"
          />
          <path d="M-32-42H32M-28 52H-8M8 52H28" stroke={seam} strokeOpacity=".5" />
        </g>
        <g transform="translate(-12 -27) scale(.8)">
          <path
            d="M-17-49L-8-55H8L17-49 34-37 47 32 32 38 19-8 23 47Q0 54-23 47L-19-8-32 38-47 32-34-37Z"
            fill="#b6d1d4"
            stroke={seam}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M-17-40V43M-8-34V44M8-34V44M17-40V43M-28-22L-37 29M28-22L37 29"
            stroke={light}
            strokeWidth="2.5"
            strokeOpacity=".65"
          />
          <path
            d="M-8-55L0-43 8-55 14-34 0-40-14-34ZM0-40V48M-44 28L-31 24M31 24L44 28"
            fill="none"
            stroke={seam}
            strokeWidth="1.2"
          />
          {[-24, -7, 10, 27].map((y) => (
            <circle key={y} cy={y} r="1.7" fill={light} stroke={seam} strokeWidth=".5" />
          ))}
        </g>
      </g>
    );
  const blazer = kind === 'blazer',
    blouse = kind === 'blouse';
  return (
    <g strokeLinejoin="round">
      <path
        d={
          blazer
            ? 'M-18-51L-8-57H8L18-51 40-35 49 43 30 47 20-8 25 54H-25L-20-8-30 47-49 43-40-35Z'
            : 'M-20-48L-10-57Q0-49 10-57L20-48 43-27 31-8 21-16 24 49Q0 55-24 49L-21-16-31-8-43-27Z'
        }
        fill={blazer ? dark : fabric}
        stroke={seam}
        strokeWidth="1.5"
      />
      <path
        d="M-19-45L-16 43M19-45L16 43"
        fill="none"
        stroke={light}
        strokeOpacity=".3"
        strokeWidth="3"
      />
      {kind === 'shirt' ? (
        <path d="M-10-56Q0-32 10-56" fill="none" stroke={seam} strokeWidth="2" />
      ) : (
        <>
          <path
            d={
              blazer
                ? 'M-8-57L0-12 8-57 19-34 9-28 15-21 0 8-15-21-9-28-19-34Z'
                : 'M-10-57L0-45 10-57 15-34 0-41-15-34Z'
            }
            fill={light}
            stroke={seam}
            strokeWidth="1"
          />
          <path d="M0-39V47" stroke={seam} strokeOpacity=".5" />
          {[-20, -4, 12, 28].map((y) => (
            <circle key={y} cx={blazer ? 6 : 0} cy={y} r="1.6" fill={blazer ? '#d0b586' : seam} />
          ))}
          {!blouse && (
            <path d="M8-23H18V-10Q13-6 8-10Z" fill="none" stroke={seam} strokeOpacity=".4" />
          )}
        </>
      )}
      <path d="M-23 43Q0 49 23 43" fill="none" stroke={seam} strokeOpacity=".25" />
    </g>
  );
}

// Inline vector art stays crisp on every screen, has a transparent background,
// and needs no external asset request or image service.
export default function ClothingIllustration({ scene }) {
  const id = useId().replace(/:/g, '');
  const count = scene.garments.length;
  const colors = {
    fabric: `url(#${id}-fabric)`,
    dark: `url(#${id}-navy)`,
    light: '#fff9ed',
    seam: '#344c61',
  };
  return (
    <svg className="clothing-art" viewBox="0 0 260 260" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-fabric`} x1="0" x2="1" y2="1">
          <stop stopColor="#fffaf0" />
          <stop offset=".5" stopColor="#e3d5be" />
          <stop offset="1" stopColor="#b4c9c7" />
        </linearGradient>
        <linearGradient id={`${id}-navy`} x1="0" x2="1" y2=".8">
          <stop stopColor="#536b83" />
          <stop offset="1" stopColor="#243b54" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor={scene.avoid ? '#e8b7a7' : '#f9f2db'} stopOpacity=".75" />
          <stop offset="1" stopColor="#edf2ed" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="130" cy="130" r="124" fill={`url(#${id}-halo)`} />
      <ellipse cx="130" cy="233" rx="64" ry="6" fill="#29455d" opacity=".08" />
      {scene.garments.map((kind, index) => {
        const x = count === 1 ? 130 : 72 + (index % 2) * 116;
        const y = count > 2 ? 69 + Math.floor(index / 2) * 119 : 124;
        const scale = count > 2 ? 0.86 : count === 1 ? 1.55 : 1.12;
        return (
          <g key={kind} transform={`translate(${x} ${y}) scale(${scale})`}>
            <Garment kind={kind} ripped={scene.ripped} colors={colors} />
          </g>
        );
      })}
      {scene.avoid && (
        <g transform="translate(215 36)" fill="none" stroke="#995848" strokeWidth="2.8">
          <circle r="17" fill="#fff1e7" />
          <path d="M-11 11L11-11" />
        </g>
      )}
    </svg>
  );
}
