"use client";

import { useRef } from "react";

/**
 * Muted, looping, inline video layered over a still. The still is always
 * rendered underneath, so a missing or unsupported file degrades to the image
 * instead of a black box. Videos are Higgsfield-generated (see MEDIA_PLAN.md).
 */
export function LoopVideo({ src, poster, className = "", imgClassName = "" }: { src: string; poster: string; className?: string; imgClassName?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div className={`absolute inset-0 ${className}`}>
      <img src={poster} alt="" className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`} />
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}
