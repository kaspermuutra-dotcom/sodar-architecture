"use client";

import { Fragment, useId } from "react";

/**
 * Hand-rolled word/line splitter for GSAP staggers (the brief's fallback for
 * SplitText). Splits plain text into per-word <span>s, grouped by explicit
 * lines you pass as an array. Each word span carries `data-split-word` and each
 * line wrapper `data-split-line` so a GSAP timeline can target either.
 *
 * Line breaking is caller-controlled (pass string[]), not measured — good
 * enough for headlines. TODO(phase-2): optional measured line-splitting for
 * long body copy if the design needs it.
 */
export function SplitText({
  lines,
  className,
  wordClassName,
  lineClassName,
}: {
  lines: string[];
  className?: string;
  wordClassName?: string;
  lineClassName?: string;
}) {
  const id = useId();
  return (
    <span className={className} aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span
          key={`${id}-${li}`}
          data-split-line
          className={`block overflow-hidden ${lineClassName ?? ""}`}
        >
          {line.split(/\s+/).filter(Boolean).map((word, wi) => (
            <Fragment key={`${id}-${li}-${wi}`}>
              <span
                data-split-word
                className={`inline-block will-change-transform ${wordClassName ?? ""}`}
                aria-hidden
              >
                {word}
              </span>{" "}
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  );
}
