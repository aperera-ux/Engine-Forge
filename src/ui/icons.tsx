const PATHS = {
  block: 'M4 7h16v10H4zM8 7V4h8v3M7 17v3M17 17v3M9 11h6',
  cam: 'M12 4a5 5 0 0 1 5 5c0 4-5 11-5 11S7 13 7 9a5 5 0 0 1 5-5zM12 9.5h.01',
  turbo: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12l5-5M12 12l-5 5M12 12l5 5M12 12l-5-5',
  exhaust: 'M3 15h8a4 4 0 0 0 4-4V6M3 19h10a6 6 0 0 0 6-6V6M15 6h4',
  fuel: 'M5 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14M4 20h12M8 8h4M15 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3',
  materials: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  chevronLeft: 'M14 6l-6 6 6 6',
  chevronRight: 'M10 6l6 6-6 6',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  share: 'M8 12l8-5M8 12l8 5M6 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5',
  close: 'M6 6l12 12M18 6L6 18',
  dyno: 'M3 17a9 9 0 0 1 18 0M12 17l4-6M7 17h.01M17 17h.01',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5h.01',
  critical: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9 9l6 6M15 9l-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
