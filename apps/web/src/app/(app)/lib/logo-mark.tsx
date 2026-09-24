import { useId } from "react";

/**
 * The station's mark without its tile: the striped sun on the horizon, the tuning needle through it.
 * The same drawing as brand/mark-small.svg (the favicon), sized by the wordmark's CSS.
 */
export function LogoMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe0a3" />
          <stop offset=".55" stopColor="#ff8a8e" />
          <stop offset="1" stopColor="#c763a8" />
        </linearGradient>
        <mask id={`${id}slats`}>
          <rect width="64" height="64" fill="#fff" />
          <rect y="30" width="64" height="3" fill="#000" />
          <rect y="36.5" width="64" height="4" fill="#000" />
          <rect y="44" width="64" height="20" fill="#000" />
        </mask>
      </defs>
      <circle cx="32" cy="31" r="19" fill={`url(#${id}sun)`} mask={`url(#${id}slats)`} />
      <path d="M6 44H58" stroke="#ff9cc6" strokeWidth="3" strokeLinecap="round" />
      <path d="M41 9V44" stroke="#91e8dc" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
