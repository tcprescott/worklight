import { useEffect, useMemo, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { dayOfMonth, monthName, timeRange, WEEKDAY_NAMES, weekdayIndex, weekStart } from "../../lib/dates";
import { useSession } from "../../session";
import { ActorShell, AccountMenu } from "../../shell";
import type { DateAnswer, MyConflicts as Conflicts, ShowDay, WeeklyConflict } from "../../types";
import { DateMark, ErrorView, Loading, Progress, useToast } from "../../ui";
import { useAsync } from "../../useAsync";
import { deadlineLabel, KIND_LABEL, lateDefault, useDirector } from "./actorLib";
import "./actor.css";

interface Answer {
  level: DateAnswer;
  arrive?: string | null;
  leave?: string | null;
}
type Choice = "in" | "soft" | "hard";

const CHOICES: { id: Choice; label: string; level: DateAnswer }[] = [
  { id: "in", label: "I'm in", level: "free" },
  { id: "soft", label: "Rather not", level: "soft" },
  { id: "hard", label: "Can't", level: "hard" },
];
const choiceOf = (level: DateAnswer): Choice => (level === "free" || level === "partial" ? "in" : level);
const USUAL_TEXT: Record<WeeklyConflict["level"], string> = { hard: "can't", soft: "rather not", partial: "part of it" };

export function MyConflicts(props: ShowPageProps) {
  const { data, error, reload } = useAsync(() => Promise.all([api.myDays(), api.myConflicts()]), []);
  const show = props.view.show;
  return (
    <ActorShell showId={show.showId} current="conflicts" archived={show.status === "archived"}>
      {error ? (
        <ErrorView message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : (
        <ConflictList {...props} days={data[0]} conflicts={data[1]} />
      )}
    </ActorShell>
  );
}

function ConflictList(props: ShowPageProps & { days: ShowDay[]; conflicts: Conflicts }) {
  const { me, reload: reloadMe } = useSession();
  const show = props.view.show;
  const director = useDirector(show.showId);
  const [toast, showToast] = useToast();

  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(props.conflicts.dates.map((d) => [d.date, { level: d.level, arrive: d.arrive, leave: d.leave }])),
  );
  const weekly = useMemo(() => new Map(props.conflicts.weekly.map((w) => [w.weekday, w])), [props.conflicts.weekly]);
  const [partOpen, setPartOpen] = useState<Set<string>>(new Set());
  const [timeError, setTimeError] = useState<Record<string, string>>({});
  const activeShows = me.shows.filter((s) => s.show.status === "active");
  const [sent, setSent] = useState(() => activeShows.length > 0 && activeShows.every((s) => !!s.conflictsSubmittedAt));
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const timers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);

  const submitted = useMemo(
    () => new Set(me.shows.filter((s) => s.conflictsSubmittedAt).map((s) => s.show.showId)),
    [me.shows],
  );
  const showNames = useMemo(() => new Map(me.shows.map((s) => [s.show.showId, s.show.name])), [me.shows]);
  const days = props.days;

  const effective = (day: ShowDay): (Answer & { usual: boolean; assumed?: boolean }) | undefined => {
    const a = answers[day.date];
    if (a) return { ...a, usual: false };
    const w = weekly.get(weekdayIndex(day.date));
    if (w) return { level: w.level, arrive: w.arrive, leave: w.leave, usual: true };
    // Once conflicts are sent, a night left alone means "I'm in".
    return submitted.has(day.showId) ? { level: "free", usual: true, assumed: true } : undefined;
  };
  const answered = days.filter((d) => effective(d)).length;
  const blank = days.length - answered;

  /** Optimistic save: shows the new answer now, puts the old one back if the API says no. */
  async function save(date: string, next: Answer | null) {
    const prev = answers[date];
    setAnswers((cur) => {
      const copy = { ...cur };
      if (next) copy[date] = next;
      else delete copy[date];
      return copy;
    });
    try {
      if (next) await api.putDate(date, { level: next.level, arrive: next.arrive ?? null, leave: next.leave ?? null });
      else await api.deleteDate(date);
      setDirty(true);
      setSent(false);
    } catch (err) {
      setAnswers((cur) => {
        const copy = { ...cur };
        if (prev) copy[date] = prev;
        else delete copy[date];
        return copy;
      });
      showToast(`Couldn't save that: ${(err as Error).message}`);
    }
  }

  function pick(day: ShowDay, choice: (typeof CHOICES)[number]) {
    const cur = answers[day.date];
    setPartOpen((s) => (s.has(day.date) ? new Set([...s].filter((d) => d !== day.date)) : s));
    // Tapping your own answer again clears it (back to your usual week, or blank).
    if (cur && cur.level === choice.level) return void save(day.date, null);
    void save(day.date, { level: choice.level });
  }

  function togglePart(day: ShowDay, current?: Answer) {
    if (current?.level === "partial" && !("usual" in current && current.usual)) {
      setPartOpen((s) => new Set([...s].filter((d) => d !== day.date)));
      return void save(day.date, { level: "free" });
    }
    setPartOpen((s) => new Set(s).add(day.date));
    void save(day.date, {
      level: "partial",
      arrive: current?.level === "partial" ? current.arrive : lateDefault(day.start),
      leave: current?.level === "partial" ? current.leave : null,
    });
  }

  function setTime(day: ShowDay, field: "arrive" | "leave", value: string) {
    const cur = answers[day.date] ?? { level: "partial" as const };
    const next: Answer = { ...cur, level: "partial", [field]: value || null };
    setAnswers((a) => ({ ...a, [day.date]: next }));
    window.clearTimeout(timers.current[day.date]);
    let problem = "";
    if (!next.arrive && !next.leave) problem = "Add when you can arrive or when you have to leave.";
    else if (next.arrive && next.leave && next.leave <= next.arrive) problem = "Leaving has to be after arriving.";
    setTimeError((e) => ({ ...e, [day.date]: problem }));
    if (problem) return;
    timers.current[day.date] = window.setTimeout(() => {
      api
        .putDate(day.date, { level: "partial", arrive: next.arrive ?? null, leave: next.leave ?? null })
        .then(() => {
          setDirty(true);
          setSent(false);
        })
        .catch((err: Error) => showToast(`Couldn't save that: ${err.message}`));
    }, 500);
  }

  async function send() {
    setSending(true);
    try {
      await api.saveConflicts({ weekly: [], dates: [], clearDates: [], replaceWeekly: false, submitTo: "all" });
      setSent(true);
      setDirty(false);
      await reloadMe();
    } catch (err) {
      showToast(`Couldn't send: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  const deadline = show.conflictDeadline;
  const sendTo = director.known ? `Send to ${director.name}` : "Send my answers";
  const sentLabel = director.known ? `Sent to ${director.name}` : "Sent";
  let lastWeek = "";

  return (
    <>
      <header className="actor-head">
        <div className="actor-topline">
          <span className="kicker">Your conflicts</span>
          <AccountMenu showId={show.showId} isStaff={props.view.role === "staff"} />
        </div>
        <h1>Can you make these?</h1>
        <p className="lede">
          {deadline && `${director.Name} needs answers by ${deadlineLabel(deadline)}. `}
          {days.length ? `You've answered ${answered} of ${days.length}.` : ""}
        </p>
        <p className="small" style={{ color: "var(--muted-2)", lineHeight: 1.4 }}>
          Your answers go to every show you're in.
        </p>
        {days.length > 0 && <Progress parts={[{ value: answered }]} total={days.length} label="Answered" />}
      </header>

      <div className="actor-body">
        {!days.length && (
          <div className="actor-empty" style={{ marginTop: 12 }}>
            <strong>No dates to answer yet</strong>
            {show.status === "archived"
              ? "This show is archived."
              : "Your shows haven't set their rehearsal days. They'll show up here when they do."}
          </div>
        )}
        {days.map((day) => {
          const wk = weekStart(day.date);
          const weekLabel = wk !== lastWeek ? `Week of ${monthName(wk)} ${dayOfMonth(wk)}` : "";
          lastWeek = wk;
          const eff = effective(day);
          const choice = eff ? choiceOf(eff.level) : undefined;
          const isPartial = eff?.level === "partial";
          const showTimes = (isPartial && !eff.usual) || (partOpen.has(day.date) && answers[day.date]?.level === "partial");
          const kind = KIND_LABEL[day.kind];
          return (
            <div key={`${day.showId}-${day.date}`} className="stack-sm" style={{ gap: 8 }}>
              {weekLabel && <div className="caps actor-week">{weekLabel}</div>}
              <div className={eff ? "actor-date" : "actor-date blank"}>
                <div className="actor-date-top">
                  <DateMark date={day.date} />
                  <div className="actor-date-info">
                    <strong>{day.start && day.end ? timeRange(day.start, day.end) : "Times to come"}</strong>
                    <span className="what">{day.kind === "rehearsal" ? "Schedule coming soon" : kind}</span>
                    <span className="actor-show-caps">{showNames.get(day.showId) ?? ""}</span>
                  </div>
                </div>
                {day.noConflicts && (
                  <div className="actor-warn">
                    <strong>{kind}: no conflicts allowed.</strong> If you can't make it, say so here and talk to{" "}
                    {director.name}.
                  </div>
                )}
                <div className="actor-choices" role="group" aria-label={`Can you make ${day.date}?`}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`actor-choice ${c.id}${eff?.usual ? " usual" : ""}`}
                      aria-pressed={choice === c.id}
                      onClick={() => pick(day, c)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {showTimes && (
                  <div className="actor-times">
                    <label className="actor-time">
                      Arrive
                      <input type="time" value={answers[day.date]?.arrive ?? ""} onChange={(e) => setTime(day, "arrive", e.target.value)} />
                    </label>
                    <label className="actor-time">
                      Leave
                      <input type="time" value={answers[day.date]?.leave ?? ""} onChange={(e) => setTime(day, "leave", e.target.value)} />
                    </label>
                  </div>
                )}
                {timeError[day.date] && showTimes && <span className="actor-inline-error">{timeError[day.date]}</span>}
                <div className="actor-date-foot">
                  <button type="button" className="link-btn" onClick={() => togglePart(day, showTimes ? answers[day.date] : eff)}>
                    {showTimes ? "I can stay the whole time" : "Only part of it?"}
                  </button>
                  {eff?.usual && !eff.assumed && (
                    <span className="actor-usual">
                      Usually {USUAL_TEXT[eff.level as WeeklyConflict["level"]]} on {WEEKDAY_NAMES[weekdayIndex(day.date)]}s
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {days.length > 0 && (
        <div className="actor-footer">
          <button type="button" className="btn btn-primary btn-lg" disabled={sending || (sent && !dirty)} onClick={() => void send()}>
            {sending ? "Sending..." : sent && !dirty ? sentLabel : blank ? `Send (${blank} still blank)` : sendTo}
          </button>
        </div>
      )}
      {toast}
    </>
  );
}
