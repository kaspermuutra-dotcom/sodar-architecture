/**
 * Sodar mark — two mirrored, rounded "hook" blocks forming an S.
 * Drawn once as the top half and rotated 180° for the bottom half so both
 * halves are guaranteed identical. Fill inherits `currentColor`.
 */
export function SodarMark({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <defs>
        <path
          id="sodar-half"
          d="M42 13 H52 A6 6 0 0 1 58 19 V34 A6 6 0 0 1 52 40 L43 40 C36 40 36 46 42 48 L50 51 A4.6 4.6 0 0 1 48 59.6 L36 55 C29 52.5 28 47 28 42 V27 A14 14 0 0 1 42 13 Z"
        />
      </defs>
      <use href="#sodar-half" />
      <use href="#sodar-half" transform="rotate(180 50 50)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`wordmark ${className}`}>Sodar</span>;
}
