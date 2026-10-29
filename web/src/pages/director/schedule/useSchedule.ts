import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../api";
import { addDays, weekStart } from "../../../lib/dates";
import type { Member, Scene, ScheduleView, Show, Suggestions } from "../../../types";
import { fillOf, isDark, mainCall } from "./model";

/** The API's default week is the one holding the server's today, which may differ from the browser's. */
async function defaultWeek(showId: string): Promise<string | undefined> {
  try {
    return (await api.schedule(showId)).start;
  } catch {
    return undefined;
  }
}

/** First and last weeks worth looking at: first rehearsal to closing. */
export function weekBounds(show: Show): [string, string] {
  return [weekStart(show.startDate), weekStart(show.endDate)];
}

/** The night that most needs scenes: the rehearsal night with the most time left. */
function defaultFocus(view: ScheduleView): string | undefined {
  let best: { date: string; free: number } | undefined;
  for (const day of view.days) {
    if (isDark(day)) continue;
    const call = mainCall(day);
    if (call?.cancelled) continue;
    const fill = fillOf(call, day);
    if (!fill) continue;
    if (!best || fill.free > best.free) best = { date: day.date, free: fill.free };
  }
  return best?.date ?? view.days.find((d) => !isDark(d))?.date;
}

export function useSchedule(show: Show, toast: (m: string) => void) {
  const showId = show.showId;
  const [week, setWeek] = useState<string>();
  const [view, setView] = useState<ScheduleView>();
  const [error, setError] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>();
  const [members, setMembers] = useState<Member[]>([]);
  const [focus, setFocus] = useState<string>();
  const [suggestions, setSuggestions] = useState<Suggestions>();
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);

  // Pick the starting week once: today's week, or the first rehearsal week if the show hasn't started.
  useEffect(() => {
    let live = true;
    void defaultWeek(showId).then((start) => {
      if (!live) return;
      const [first, last] = weekBounds(show);
      const w = start ?? first;
      setWeek(w < first ? first : w > last ? last : w);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  useEffect(() => {
    api
      .breakdown(showId)
      .then((bd) => setScenes([...bd.scenes].sort((a, b) => a.order - b.order)))
      .catch((e: Error) => setError(e.message));
    api
      .members(showId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [showId]);

  const loadWeek = useCallback(
    async (w: string) => {
      const seq = ++loadSeq.current;
      try {
        const v = await api.schedule(showId, w, addDays(w, 6));
        if (seq !== loadSeq.current) return;
        setView(v);
        setError(undefined);
        setFocus((f) => (f && v.days.some((d) => d.date === f) ? f : defaultFocus(v)));
      } catch (e) {
        if (seq === loadSeq.current) setError((e as Error).message);
      }
    },
    [showId],
  );

  useEffect(() => {
    if (week) void loadWeek(week);
  }, [week, loadWeek]);

  // Rank scenes for the focused night whenever the week changes.
  useEffect(() => {
    if (!focus || !view || show.status === "archived") {
      setSuggestions(undefined);
      return;
    }
    let live = true;
    api
      .suggestions(showId, focus, view.start, view.end)
      .then((s) => live && setSuggestions(s))
      .catch(() => live && setSuggestions(undefined));
    return () => {
      live = false;
    };
  }, [showId, focus, view, show.status]);

  /** Runs a change, then reloads the week. Errors become a toast. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, done?: string) => {
      if (!week) return false;
      setBusy(true);
      try {
        await fn();
        await loadWeek(week);
        if (done) toast(done);
        return true;
      } catch (e) {
        toast((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [week, loadWeek, toast],
  );

  const sceneMap = useMemo(() => new Map((scenes ?? []).map((s) => [s.sceneId, s])), [scenes]);

  return {
    week,
    setWeek,
    view,
    error,
    scenes,
    sceneMap,
    members,
    focus,
    setFocus,
    suggestions: suggestions && suggestions.date === focus ? suggestions : undefined,
    busy,
    mutate,
    reload: () => week && loadWeek(week),
  };
}

export type ScheduleData = ReturnType<typeof useSchedule>;
