"use client";

import { ArrowLeft } from "lucide-react";
import { useNav } from "@/contexts/NavContext";

type Props = {
  /** Where to land when this screen has no in-app history behind it. */
  fallback?: string;
  title?: string;
  style?: React.CSSProperties;
};

/**
 * The site's only back affordance. It always has a destination: the screen the
 * user actually came from when there is one, otherwise `fallback`. Without
 * that guarantee a deep-linked or refreshed page hands `router.back()` nothing
 * to do and the browser drops the visitor out of the app entirely.
 */
export default function BackButton({ fallback = "/", title, style }: Props) {
  const { goBack, canGoBack, label } = useNav();
  const hint = title ?? (canGoBack ? `Back to ${label}` : `Go to ${label}`);
  return (
    <button
      className="yomi-iconbtn"
      onClick={() => goBack(fallback)}
      title={hint}
      aria-label={hint}
      style={style}
    >
      <ArrowLeft size={20} />
    </button>
  );
}