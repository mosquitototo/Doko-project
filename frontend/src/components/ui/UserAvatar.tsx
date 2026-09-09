import { useState } from "react";

type Props = {
  src?: string | null;
  name?: string | null;
  size?: "small" | "sidebar";
};

export default function UserAvatar({ src, name, size = "small" }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && src !== failedSrc);
  const label = name || "Unassigned";

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={`inline-flex shrink-0 overflow-hidden rounded-full border bg-background ${showImage ? "border-border" : "border-black"} ${size === "sidebar" ? "h-10 w-10 lg:h-11 lg:w-11" : "h-7 w-7"}`}
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : !name ? (
        <svg aria-hidden="true" viewBox="0 0 28 28" className="h-full w-full" fill="none">
          <path d="M9 9L19 19M19 9L9 19" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
    </span>
  );
}
