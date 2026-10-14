import React from 'react';
const paths = {
  home: 'M3 10 9-7 9 7v10h-6v-6H9v6H3Z',
  checklist: 'M9 5h12M9 12h12M9 19h12M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2',
  planet:
    'M16 5a8 8 0 1 1-11 11M7 4a8 8 0 0 1 13 9M3 16c-3-3 2-7 8-10s12-4 12-1-4 7-11 10-10 3-9 1Z',
  book: 'M12 5v15M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  spark: 'm12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  calendar: 'M3 5h18v16H3ZM3 10h18M8 2v6M16 2v6M7 14h2M13 14h2M7 18h2',
  shirt: 'm8 3 4 3 4-3 6 4-3 5-3-2v11H8V10l-3 2-3-5Z',
  laptop: 'M4 3h16v13H4ZM1 21l3-5h16l3 5Z',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-5',
  heart: 'M20 4a5 5 0 0 0-8 2 5 5 0 0 0-8-2C-3 10 12 21 12 21S27 10 20 4Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  smile: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01',
  chat: 'M21 11a8 8 0 0 1-8 8H4l-2 3V11a9 9 0 0 1 19 0Z',
  receipt:
    'M4 2l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2v20l-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2ZM8 8h8M8 12h8M8 16h4',
  help: 'M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  bookmark: 'M6 3h12v18l-6-4-6 4Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  copy: 'M9 9h12v12H9ZM15 5V3H3v12h2',
  user: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  volume: 'm11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
  mute: 'm11 5-6 4H2v6h3l6 4ZM16 9l6 6m0-6-6 6',
  stop: 'M5 5h14v14H5Z',
};
export default function Icon({ name, size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
