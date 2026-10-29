import { useEffect, useState } from "react";

/** Below 768px director pages switch to their phone layout (handoff spec). */
export const PHONE_QUERY = "(max-width: 767px)";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export const useIsPhone = () => useMedia(PHONE_QUERY);
