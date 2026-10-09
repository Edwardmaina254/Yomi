"use client";

import { useAuth } from "@/contexts/AuthContext";

/* Google's identity mark, required on any OAuth consent surface. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function GoogleSpinner() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.22" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

interface Props {
  /** "full" = prominent panel button. "compact" = inline / rail-adjacent. */
  variant?: "full" | "compact";
  label?: string;
  className?: string;
  /** Hide the error line — the rail has no room for it. */
  hideError?: boolean;
}

/**
 * Google sign-in trigger. Handles the redirect handshake, busy state (double
 * submit is impossible because the button locks while the browser leaves), and
 * surfaces real OAuth failures instead of silently doing nothing.
 */
export default function GoogleAuthButton({
  variant = "full",
  label = "Continue with Google",
  className = "",
  hideError = false,
}: Props) {
  const { signIn, busy, error, configured, clearError } = useAuth();

  const compact = variant === "compact";
  const blocked = busy || !configured;

  return (
    <div className={compact ? "yomi-auth-inline" : "yomi-auth-stack"}>
      <button
        type="button"
        className={`yomi-gbtn ${compact ? "yomi-gbtn-compact" : "yomi-gbtn-full"} ${className}`.trim()}
        onClick={() => {
          clearError();
          void signIn();
        }}
        disabled={blocked}
        aria-busy={busy}
      >
        {busy ? <GoogleSpinner /> : <GoogleMark size={compact ? 16 : 18} />}
        <span>{busy ? "Redirecting…" : label}</span>
      </button>

      {!hideError && error && (
        <p className="yomi-auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
