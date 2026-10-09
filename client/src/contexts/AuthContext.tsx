"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";


interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** True while a sign-in redirect or sign-out round-trip is in flight. */
  busy: boolean;
  /** Human-readable auth failure, cleared on the next attempt. */
  error: string;
  /** False when the Supabase env vars are missing — the button disables instead of throwing. */
  configured: boolean;
  /** True once the local↔cloud library merge has completed at least once for this session. */
  synced: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncData: () => Promise<void>;
  pushData: () => Promise<void>;
  clearAllData: () => Promise<void>;
  clearError: () => void;
}

const RETURN_KEY = "yomi.authReturn";

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  busy: false,
  error: "",
  configured: false,
  synced: false,
  signIn: async () => {},
  signOut: async () => {},
  syncData: async () => {},
  pushData: async () => {},
  clearAllData: async () => {},
  clearError: () => {},
});

/* Supabase is configured when both public env vars are present. Without them
   `createClient("")` throws on any auth call, so we detect it up front and let
   the UI explain the problem instead of failing on click. */
function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith("http") &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/* Turn Supabase/OAuth failures into something a reader can act on. */
function friendlyAuthError(err: unknown): string {
  const raw =
    typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const m = raw.toLowerCase();
  if (m.includes("popup") && m.includes("closed")) return "The sign-in window closed before finishing. Try again.";
  if (m.includes("cancelled") || m.includes("canceled")) return "Sign-in was cancelled.";
  if (m.includes("network") || m.includes("fetch")) return "Couldn't reach the sign-in service. Check your connection.";
  if (m.includes("redirect") || m.includes("url")) return "This redirect URL isn't allowed yet — add your site URL in Supabase → Auth → URL Configuration.";
  if (m.includes("provider") || m.includes("google")) return "Google sign-in isn't enabled or verified in your Supabase project yet.";
  if (m.includes("saml") || m.includes("sso")) return "This account must use SSO instead of Google.";
  if (m.includes("email") && m.includes("exist")) return "That email is already registered to another account.";
  if (m.includes("rate") || m.includes("many")) return "Too many attempts. Wait a moment and try again.";
  return raw || "Sign-in failed. Please try again.";
}

/* Supabase hands the session back in the URL fragment (implicit) or as ?code=
   (PKCE). Detecting either means we are on the OAuth return trip, which is the
   only time we honour the stored return path — a normal visit never bounces. */
function isAuthCallback() {
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  return (
    hash.includes("access_token") ||
    hash.includes("refresh_token") ||
    hash.includes("error_description") ||
    search.includes("code=") ||
    search.includes("error_description")
  );
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [synced, setSynced] = useState(false);
  const [configured] = useState(() => isSupabaseConfigured());

  /* Mirrors `user` so `syncData` can read the current user without depending on
     it. Depending on `user` would recreate the callback on every session object
     refresh, which re-runs the auth effect below, which syncs again — an
     endless write loop. The ref keeps `syncData` stable for the app's lifetime. */
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const syncData = useCallback(async (currentUser?: User | null) => {
    const activeUser = currentUser === undefined ? userRef.current : currentUser;
    if (!activeUser) return;

    try {
      // 1. Get local data
      const localLibRaw = localStorage.getItem("yomi.lib");
      const localContRaw = localStorage.getItem("yomi.continue");
      
      const localLib: any[] = localLibRaw ? JSON.parse(localLibRaw) : [];
      const localCont: any[] = localContRaw ? JSON.parse(localContRaw) : [];

      // 2. Fetch cloud data
      const { data: cloudData, error } = await supabase
        .from("user_sync_data")
        .select("library_data, continue_data")
        .eq("user_id", activeUser.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error("Error fetching cloud data:", error.message);
        return;
      }

      const cloudLib: any[] = cloudData?.library_data || [];
      const cloudCont: any[] = cloudData?.continue_data || [];

      // 3. Merge Library (dedupe by ID)
      const mergedLibMap = new Map<string, any>();
      cloudLib.forEach(item => mergedLibMap.set(item.id, item));
      localLib.forEach(item => mergedLibMap.set(item.id, item)); // local overwrites cloud if conflict (assuming recent)
      const mergedLib = Array.from(mergedLibMap.values());

      // 4. Merge Continue Reading (dedupe by mangaId or id)
      const mergedContMap = new Map<string, any>();
      cloudCont.forEach(item => mergedContMap.set(item.mangaId || item.id, item));
      localCont.forEach(item => {
        const key = item.mangaId || item.id;
        mergedContMap.set(key, item);
      });
      const mergedCont = Array.from(mergedContMap.values());

      // 5. Save merged data back to local
      localStorage.setItem("yomi.lib", JSON.stringify(mergedLib));
      localStorage.setItem("yomi.continue", JSON.stringify(mergedCont));

      // 6. Push merged data back to cloud
      const { error: pushError } = await supabase.rpc('sync_user_data', {
        p_user_id: activeUser.id,
        p_library_data: mergedLib,
        p_continue_data: mergedCont
      });

      /* The local merge above already succeeded and is written to localStorage,
         so a failed push is a degraded state, not a data loss. Report it instead
         of claiming a clean sync. */
      if (pushError) {
        console.error("Error pushing sync data:", pushError.message);
        setSynced(false);
        setError("Signed in, but your shelf couldn't be backed up to the cloud. It's safe on this device — try Sync now again.");
        return;
      }

      setSynced(true);

      // Dispatch events so UI components know to re-render
      window.dispatchEvent(new Event("storage"));

    } catch (e) {
      console.error("Failed to sync data", e);
      setSynced(false);
      setError("Couldn't merge your shelf just now. Your local data is untouched.");
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user) syncData(session.user);
      setLoading(false);

      // Returning from Google: send the reader back to the page they left.
      if (isAuthCallback()) {
        const back = localStorage.getItem(RETURN_KEY);
        localStorage.removeItem(RETURN_KEY);
        if (back && back !== window.location.pathname) {
          router.replace(back);
        }
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) syncData(session.user);
      if (event === 'SIGNED_OUT') setSynced(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [configured, router, syncData]);

  const signIn = async () => {
    if (!configured) {
      setError("Supabase isn't configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to client/.env.local");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Remember where to come back to. redirectTo already carries the path,
      // but the allow-list may only contain the bare origin — the stored path is
      // what makes the return reliable either way.
      const here = window.location.pathname + window.location.search;
      try { localStorage.setItem(RETURN_KEY, here); } catch {}

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${here}`,
          queryParams: { prompt: "select_account" },
        },
      });

      if (oauthError) throw oauthError;

      /* On success the browser is already navigating to Google's consent page,
         so we deliberately keep `busy` true to prevent a double submit. If the
         navigation is blocked the promise resolves and we recover here. */
      setTimeout(() => setBusy(false), 1200);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!configured) return;
    setBusy(true);
    setError("");
    try {
      const { error: outError } = await supabase.auth.signOut();
      if (outError) throw outError;
      setUser(null);
      setSynced(false);
      /* Keep yomi.lib / yomi.continue locally so the shelf survives sign-out and
         re-merges into the next account that signs in. */
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };


  const pushData = useCallback(async (currentUser?: User | null) => {
    const activeUser = currentUser === undefined ? userRef.current : currentUser;
    if (!activeUser) return;

    try {
      const localLibRaw = localStorage.getItem("yomi.lib");
      const localContRaw = localStorage.getItem("yomi.continue");
      
      const localLib = localLibRaw ? JSON.parse(localLibRaw) : [];
      const localCont = localContRaw ? JSON.parse(localContRaw) : [];

      const { error: pushError } = await supabase.rpc('sync_user_data', {
        p_user_id: activeUser.id,
        p_library_data: localLib,
        p_continue_data: localCont
      });

      if (pushError) {
        console.error("Error pushing sync data:", pushError.message);
      }
    } catch (err) {
      console.error("pushData failed:", err);
    }
  }, []);

  const clearAllData = async () => {
    // 1. Wipe local storage
    localStorage.removeItem("yomi.lib");
    localStorage.removeItem("yomi.continue");
    
    // 2. Wipe cloud data if logged in
    if (user) {
      await supabase.rpc('sync_user_data', {
        p_user_id: user.id,
        p_library_data: [],
        p_continue_data: []
      });
    }
    setSynced(false);

    // 3. Force UI re-render across all tabs
    window.dispatchEvent(new Event("storage"));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        busy,
        error,
        configured,
        synced,
        signIn,
        signOut,
        syncData,
        pushData,
        clearAllData,
        clearError: () => setError(""),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
