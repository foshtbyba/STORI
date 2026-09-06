type P = { className?: string; size?: number; color?: string; width?: number };

const base = (d: string) =>
  function Icon({ size = 18, color = 'currentColor', width = 1.7 }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
        strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
        <path d={d} />
      </svg>
    );
  };

export const IconPeak = base('M2.5 20h19L14 5l-3.4 6.5L8.4 8z');
export const IconChart = base('M4 20V9M10 20V4M16 20v-7M2 20h20');
export const IconCalendar = base('M3 5h18v16H3zM3 10h18M8 3v4M16 3v4');
export const IconBox = base('M21 8l-9-4.5L3 8l9 4.5zM3 8v8l9 4.5L21 16V8');
export const IconWallet = base('M3 6h18v13H3zM3 10.5h18');
export const IconLink = base('M9.5 14.5l5-5M8.2 11.4l-2 2a3.3 3.3 0 004.7 4.7l2-2M15.8 12.6l2-2a3.3 3.3 0 00-4.7-4.7l-2 2');
export const IconRocket = base('M5 15c-1 2.5-1 4-1 4s1.5 0 4-1M9 13l-3 3M8.5 15.5C7 14 6.5 11.5 8 8.5 10 4.5 14 3.5 20 4c.5 6-.5 10-4.5 12-3 1.5-5.5 1-7-.5zM14.5 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z');
export const IconSearch = base('M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.2 15.2L20 20');
export const IconTag = base('M3 12.5V4h8.5L21 13.5 12.5 22 3 12.5z');
export const IconUsers = base('M3 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6M17 11.5a3 3 0 100-6');
export const IconRoute = base('M8.4 8.2C13 11 11 13 15.8 15.6');
export const IconList = base('M4 6h16M4 12h16M4 18h10');
export const IconWarn = base('M12 3l9 16H3zM12 9v5M12 16.5v.5');
export const IconDown = base('M12 3v13M7 11l5 5 5-5M4 20h16');
export const IconPlus = base('M12 5v14M5 12h14');
export const IconPin = base('M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z');
export const IconFlag = base('M6 20V5l11 3.5L6 12');
export const IconCheck = base('M6 12l4 4 8-8');
export const IconLogout = base('M14 20H5V4h9M18 12H9M15 8l4 4-4 4');
export const IconSource = base('M4 4h16v16H4z');

export function IconCircle({ size = 18, color = 'currentColor' }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5h8.5" />
    </svg>
  );
}

export function IconUser({ size = 18, color = 'currentColor' }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} aria-hidden>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M17 11.5a3 3 0 100-6" />
    </svg>
  );
}
