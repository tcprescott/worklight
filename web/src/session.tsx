import { createContext, useContext, type ReactNode } from "react";
import { api } from "./api";
import type { Me } from "./types";
import { useAsync } from "./useAsync";

interface Session {
  me: Me;
  reload: () => Promise<void>;
}

const SessionContext = createContext<Session | undefined>(undefined);

/** Loads /api/me once for the signed-in person; pages read it with useSession(). */
export function SessionProvider(props: { children: (state: { loading: boolean; error?: string }) => ReactNode }) {
  const { data, error, loading, reload } = useAsync(() => api.me(), []);
  if (!data) return <>{props.children({ loading, error })}</>;
  return (
    <SessionContext.Provider value={{ me: data, reload: async () => void (await reload()) }}>
      {props.children({ loading: false })}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

export function isAdminOf(me: Me, theaterId: string): boolean {
  return me.theaters.some((t) => t.theater.theaterId === theaterId);
}
