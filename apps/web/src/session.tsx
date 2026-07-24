import { JkPlatformClient } from "@jk/contracts-rest";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Session context. In this first slice the console authenticates with the
 * API's local dev header (x-dev-user-id) plus the active tenant id, matching
 * apps/api/src/auth.ts. An OIDC bearer session slots in behind the same
 * interface later. The session is persisted to localStorage so a reload keeps
 * the operator signed in.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";
const STORAGE_KEY = "jk.session.v1";

export interface Session {
  userId: string;
  tenantId: string;
  displayName?: string;
  platformAdmin: boolean;
}

interface SessionContextValue {
  session: Session | null;
  client: JkPlatformClient | null;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function loadStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export interface SessionProviderProps {
  children: ReactNode;
  /** Test seam: build the client (defaults to a dev-auth JkPlatformClient). */
  clientFactory?: (session: Session) => JkPlatformClient;
  /** Test seam: start from a known session instead of localStorage. */
  initialSession?: Session | null;
}

function defaultClient(session: Session): JkPlatformClient {
  return new JkPlatformClient({
    baseUrl: API_BASE_URL,
    tenantId: session.tenantId,
    auth: {
      mode: "dev",
      devUserId: session.userId,
      platformAdmin: session.platformAdmin,
      displayName: session.displayName,
    },
  });
}

export function SessionProvider({ children, clientFactory, initialSession }: SessionProviderProps): JSX.Element {
  const [session, setSession] = useState<Session | null>(() =>
    initialSession !== undefined ? initialSession : loadStored(),
  );

  const build = clientFactory ?? defaultClient;
  const client = useMemo(() => (session ? build(session) : null), [session, build]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      client,
      signIn: (next) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
      },
    }),
    [session, client],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}

/** The authenticated client, or throws — for use inside guarded routes. */
export function useClient(): JkPlatformClient {
  const { client } = useSession();
  if (!client) throw new Error("No authenticated client; render inside a RequireSession route");
  return client;
}
