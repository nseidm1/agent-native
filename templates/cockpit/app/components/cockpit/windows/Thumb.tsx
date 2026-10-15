import { useState } from "react";

/** The region-relative path the server names (app-thumb/<app>/<sha12>.jpg) under this app's base (/cards/). */
export const thumbSrc = (p: string) => import.meta.env.BASE_URL.replace(/\/?$/, "/") + p;

/** The staging picture: fades in once loaded, so a slow picture never flashes a broken box. */
export function Thumb({ src, alt = "" }: { src: string; alt?: string }) {
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <img
      className={"ap-pv-img" + (shown ? " on" : "")}
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      decoding="async"
      draggable={false}
      ref={(n) => {
        if (n && n.complete && n.naturalWidth && !shown) setShown(true);
      }}
      onLoad={() => setShown(true)}
      onError={() => setGone(true)}
    />
  );
}
