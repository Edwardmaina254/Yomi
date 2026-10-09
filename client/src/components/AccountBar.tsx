"use client";

import { useEffect, useState } from "react";
import { LogOut, RefreshCw, Cloud, Check, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import GoogleAuthButton, { GoogleMark, GoogleSpinner } from "./GoogleAuthButton";

/* Google puts the display name in a few different keys depending on whether the
   profile is fresh or came from an existing account. */
function nameOf(user: { user_metadata?: Record<string, unknown>; email?: string } | null) {
  const m = (user?.user_metadata || {}) as Record<string, unknown>;
  const pick = (m.full_name || m.name) as string | undefined;
  if (pick && pick.trim()) return pick.trim();
  const email = user?.email || "";
  return email ? email.split("@")[0] : "Reader";
}

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "Y";
}

/* ------------------------------------------------------------------ */
/* Nav button — lives in the navbar, next to the light/dark toggle.     */
/*   "bar"  = pill in the mobile topbar (mark + "Sign in" / avatar)      */
/*   "rail" = square icon in the desktop rail                             */
/* Signed out it starts Google sign-in. Signed in it opens a dropdown    */
/* that owns every bit of account + sync state.                           */
/* ------------------------------------------------------------------ */
export function AccountButton({ variant = "rail" }: { variant?: "rail" | "bar" }) {
  const { user, loading, signIn, signOut, syncData, busy, synced, error, clearError } = useAuth();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const bar = variant === "bar";

  /* Escape closes the dropdown — a keyboard reader should never be stuck in it. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncData();
    } finally {
      setSyncing(false);
    }
  };

  /* Loading — reserve the exact footprint so nothing shifts when the session lands */
  if (loading) {
    return bar ? (
      <span className="yomi-acct-btn is-load" aria-hidden />
    ) : (
      <span className="yomi-acct-btn is-load sq" aria-hidden />
    );
  }

  /* Signed out — one click hands off to Google */
  if (!user) {
    return (
      <button
        type="button"
        className={`yomi-acct-btn ${bar ? "" : "sq"}`}
        onClick={() => {
          clearError();
          void signIn();
        }}
        disabled={busy}
        aria-busy={busy}
        title={error || "Sign in with Google"}
        aria-label="Sign in with Google"
      >
        {busy ? <GoogleSpinner /> : <GoogleMark size={bar ? 17 : 16} />}
        {bar && <span>{busy ? "Redirecting…" : "Sign in"}</span>}
      </button>
    );
  }

  const name = nameOf(user);
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  const face = avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatar} alt="" className="yomi-acct-avatar" referrerPolicy="no-referrer" />
  ) : (
    <span className="yomi-acct-initial">{initialOf(name)}</span>
  );

  return (
    <div className="yomi-acct-pop-wrap">
      <button
        type="button"
        className={`yomi-acct-btn ${bar ? "" : "sq"} yomi-acct-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={user.email || name}
        aria-label="Account"
        aria-expanded={open}
      >
        {face}
        {bar && <span className="yomi-acct-btn-name">{name}</span>}
      </button>

      {open && (
        <>
          <div className="yomi-acct-scrim" onClick={() => setOpen(false)} />
          <div className={`yomi-acct-pop ${bar ? "drop" : ""}`} role="menu">
            <div className="yomi-acct-pop-id">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="yomi-acct-avatar lg" referrerPolicy="no-referrer" />
              ) : (
                <span className="yomi-acct-initial lg">{initialOf(name)}</span>
              )}
              <div className="yomi-acct-pop-meta">
                <b>{name}</b>
                {user.email && <span>{user.email}</span>}
              </div>
            </div>

            {/* All sync state lives in here — nothing else in the app shows it */}
            <div className="yomi-acct-sync">
              <span className={`yomi-acct-pill ${synced ? "ok" : "wait"}`}>
                {synced ? <Check size={11} /> : <Cloud size={11} />}
                {synced ? "Synced" : "Local only"}
              </span>
              <button className="yomi-acct-syncbtn" onClick={() => void runSync()} disabled={syncing}>
                <RefreshCw size={12} className={syncing ? "yomi-spin" : undefined} />
                {syncing ? "Syncing" : "Sync now"}
              </button>
            </div>

            {error && (
              <p className="yomi-acct-pop-error" role="status">
                <AlertCircle size={12} />
                {error}
              </p>
            )}

            <button
              className="yomi-acct-pop-item"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              disabled={busy}
            >
              <LogOut size={15} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel — the sync story lives in the library                         */
/* ------------------------------------------------------------------ */
export function AccountBar() {
  const { user, loading, busy, synced, error, signOut, syncData, configured } = useAuth();
  const [syncing, setSyncing] = useState(false);

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncData();
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="yomi-acct-bar" aria-busy="true">
        <div className="yomi-acct-bar-icon" />
        <div className="yomi-acct-bar-text">
          <b>Checking your account…</b>
          <span>Looking for a saved session on this device.</span>
        </div>
      </div>
    );
  }

  /* ── Signed in ── */
  if (user) {
    const name = nameOf(user);
    const avatar = user.user_metadata?.avatar_url as string | undefined;

    return (
      <div className="yomi-acct-bar is-in">
        <div className="yomi-acct-bar-icon" style={{ padding: 0, border: 0, background: "none" }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="yomi-acct-avatar xl" referrerPolicy="no-referrer" />
          ) : (
            <span className="yomi-acct-initial xl">{initialOf(name)}</span>
          )}
        </div>

        <div className="yomi-acct-bar-text">
          <b>{name}</b>
          <span>{user.email || "Signed in"}</span>
        </div>

        {synced ? (
          <span className="yomi-acct-pill ok">
            <Check size={12} /> Synced
          </span>
        ) : (
          <span className="yomi-acct-pill wait">
            <Cloud size={12} /> Local only
          </span>
        )}

        <div className="yomi-acct-bar-actions">
          <button className="yomi-btn yomi-btn-ghost yomi-acct-mini" onClick={() => void runSync()} disabled={syncing} title="Merge local and cloud shelf now">
            <RefreshCw size={15} className={syncing ? "yomi-spin" : undefined} />
            {syncing ? "Syncing" : "Sync now"}
          </button>
          <button className="yomi-btn yomi-btn-ghost yomi-acct-mini" onClick={() => void signOut()} disabled={busy}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>

        {error && (
          <p className="yomi-acct-bar-error" role="status">
            <AlertCircle size={13} />
            {error}
          </p>
        )}
      </div>
    );
  }

  /* ── Signed out ── */
  return (
    <div className="yomi-acct-bar is-out">
      <div className="yomi-acct-bar-icon">
        <Cloud size={19} />
      </div>

      <div className="yomi-acct-bar-text">
        <b>Take your shelf with you</b>
        <span>
          Sign in to sync your library and reading progress across every device.
          Nothing leaves this browser until you do.
        </span>
      </div>

      <div className="yomi-acct-bar-actions">
        <GoogleAuthButton />
        {!configured && (
          <p className="yomi-auth-note">
            <AlertCircle size={13} />
            Supabase env vars missing — add them to <code>client/.env.local</code> to enable sign-in.
          </p>
        )}
      </div>
    </div>
  );
}
