import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
  size?: number;
  stroke?: string;
  fill?: string;
  sw?: number;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function Icon({ size = 16, stroke = 'currentColor', fill = 'none', sw = 1.5, style, className, children }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  home: <><path d="M3 12l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  chart: <><path d="M3 20h18" /><path d="M6 16V9" /><path d="M11 16V5" /><path d="M16 16v-6" /><path d="M21 16v-3" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 18l9 5 9-5" /></>,
  bolt: <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>,
  spark: <><path d="M12 2v6" /><path d="M12 16v6" /><path d="M2 12h6" /><path d="M16 12h6" /><path d="M5 5l4 4" /><path d="M15 15l4 4" /><path d="M19 5l-4 4" /><path d="M9 15l-4 4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  bell: <><path d="M6 8a6 6 0 1112 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" /><path d="M10 21a2 2 0 004 0" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  sort: <><path d="M8 3v18" /><path d="M4 7l4-4 4 4" /><path d="M16 21V3" /><path d="M20 17l-4 4-4-4" /></>,
  chev: <path d="M6 9l6 6 6-6" />,
  filter: <><path d="M3 5h18" /><path d="M6 12h12" /><path d="M10 19h4" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  x: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  send: <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>,
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flame: <path d="M12 3c2 4 6 5 6 10a6 6 0 11-12 0c0-3 2-4 3-7 1 2 3 2 3 5 0-3 0-5 0-8z" />,
  refresh: <><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v5h-5" /></>,
  external: <><path d="M14 3h7v7" /><path d="M10 14L21 3" /><path d="M21 14v7H3V3h7" /></>,
} as const;

export type IconName = keyof typeof Icons;
