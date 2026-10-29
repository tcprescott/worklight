import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api";
import type { Breakdown, Member } from "../../../types";
import { appearanceSet, key } from "./model";

/** The show's breakdown plus its members, with an optimistic toggle for the scenes x characters grid. */
export function useBreakdown(showId: string, onError: (message: string) => void) {
  const [bd, setBd] = useState<Breakdown>();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([api.breakdown(showId), api.members(showId)]);
      setBd(b);
      setMembers(m);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [showId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const on = useMemo(() => (bd ? appearanceSet(bd) : new Set<string>()), [bd]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);

  const toggle = useCallback(
    (sceneId: string, charId: string) => {
      if (!bd) return;
      const next = !on.has(key(sceneId, charId));
      const apply = (value: boolean) =>
        setBd((cur) =>
          cur && {
            ...cur,
            appearances: value
              ? [...cur.appearances.filter((a) => !(a.sceneId === sceneId && a.charId === charId)), { showId, sceneId, charId }]
              : cur.appearances.filter((a) => !(a.sceneId === sceneId && a.charId === charId)),
          },
        );
      apply(next);
      api.setAppearance(showId, sceneId, charId, next).catch((e: Error) => {
        apply(!next);
        onError(`Couldn't save that change. ${e.message}`);
      });
    },
    [bd, on, showId, onError],
  );

  return { bd, setBd, members, memberMap, on, error, reload, toggle };
}

export type BreakdownState = ReturnType<typeof useBreakdown>;
