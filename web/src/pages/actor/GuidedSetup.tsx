import { useEffect, useMemo, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { dayOfMonth, longDate, monthName, time12, timeRange, todayIso, WEEKDAY_NAMES, weekdayIndex } from "../../lib/dates";
import { firstName } from "../../lib/people";
import { Link } from "../../router";
import { useSession } from "../../session";
import type { MyConflicts, SaveConflictsBody, ShowDay, WeeklyConflict } from "../../types";
import { ErrorView, FormError, Icon, Loading } from "../../ui";
import { useAsync } from "../../useAsync";
import { lateDefault, useDirector } from "./actorLib";
import "./actor.css";

type WeekChoice = "fine" | "late" | "never" | "keep";
interface WeekAnswer {
  choice: WeekChoice;
  arrive: string;
  /** The rule they already had, kept as is when it isn't one of the three choices (e.g. "rather not"). */
  orig?: WeeklyConflict;
}
type OneOffLevel = "hard" | "soft" | "late";
interface OneOff {
  date: string;
  level: OneOffLevel;
  arrive: string;
  leave?: string | null;
}

const LEVEL_LABEL: Record<OneOffLevel, string> = { hard: "Can't come", soft: "Rather not", late: "Late" };
const CYCLE: OneOffLevel[] = ["hard", "soft", "late"];
const monthDay = (iso: string) => `${monthName(iso)} ${dayOfMonth(iso)}`;

interface Weekday {
  weekday: number;
  time: string;
  start?: string | null;
}

export function GuidedSetup(props: ShowPageProps) {
  const show = props.view.show;
  const { data, error, reload } = useAsync(() => Promise.all([api.myDays(), api.myConflicts()]), []);
  const director = useDirector(show.showId);
  if (show.status === "archived") {
    return (
      <main className="actor-setup">
        <div className="actor-step">
          <h1 className="title-md">{show.name} is archived</h1>
          <p className="lede">There are no conflicts to send for it.</p>
          <Link to={`/shows/${show.showId}`} className="btn btn-lg">
            Back to the show
          </Link>
        </div>
      </main>
    );
  }
  if (error) return <ErrorView message={error} onRetry={() => void reload()} />;
  if (!data) return <Loading />;
  return <Wizard {...props} days={data[0]} conflicts={data[1]} directorName={director.known ? director.name : undefined} />;
}

function Wizard(props: ShowPageProps & { days: ShowDay[]; conflicts: MyConflicts; directorName?: string }) {
  const show = props.view.show;
  const { me, reload: reloadMe } = useSession();
  const today = todayIso();

  const weekdays: Weekday[] = useMemo(() => {
    const byDay = new Map<number, Set<string>>();
    const startOf = new Map<number, string | null | undefined>();
    for (const d of props.days) {
      if (d.kind !== "rehearsal") continue;
      const wd = weekdayIndex(d.date);
      if (!byDay.has(wd)) byDay.set(wd, new Set());
      if (d.start && d.end) byDay.get(wd)!.add(timeRange(d.start, d.end));
      if (!startOf.has(wd)) startOf.set(wd, d.start);
    }
    return [...byDay.keys()]
      .sort((a, b) => a - b)
      .map((wd) => ({ weekday: wd, time: [...byDay.get(wd)!].join(", "), start: startOf.get(wd) }));
  }, [props.days]);

  const rehearsals = props.days.filter((d) => d.kind === "rehearsal");
  const windowStart = rehearsals[0]?.date ?? props.days[0]?.date ?? show.startDate;
  const windowEnd = rehearsals.at(-1)?.date ?? props.days.at(-1)?.date ?? show.endDate;
  const startOfDate = (date: string) => props.days.find((d) => d.date === date)?.start;

  const [step, setStep] = useState(1);
  const [week, setWeek] = useState<Record<number, WeekAnswer>>(() => {
    const out: Record<number, WeekAnswer> = {};
    for (const w of props.conflicts.weekly) {
      if (w.level === "hard") out[w.weekday] = { choice: "never", arrive: "", orig: w };
      else if (w.level === "partial" && w.arrive && !w.leave) out[w.weekday] = { choice: "late", arrive: w.arrive, orig: w };
      else out[w.weekday] = { choice: "keep", arrive: w.arrive ?? "", orig: w };
    }
    return out;
  });
  const existingDates = useMemo(
    () => props.conflicts.dates.filter((d) => d.level !== "free" && d.date >= today),
    [props.conflicts.dates, today],
  );
  const [oneoffs, setOneoffs] = useState<OneOff[]>(() =>
    existingDates.map((d) => ({
      date: d.date,
      level: d.level === "partial" ? "late" : (d.level as "hard" | "soft"),
      arrive: d.arrive ?? lateDefault(startOfDate(d.date)),
      leave: d.leave,
    })),
  );
  const [newDate, setNewDate] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const answerFor = (wd: number): WeekAnswer => week[wd] ?? { choice: "fine", arrive: "" };
  const setWeekday = (wd: number, patch: Partial<WeekAnswer>) => setWeek({ ...week, [wd]: { ...answerFor(wd), ...patch } });

  function addDate() {
    if (!newDate) return;
    if (newDate < windowStart || newDate > windowEnd) {
      setError(`Pick a date between ${monthDay(windowStart)} and ${monthDay(windowEnd)}.`);
      return;
    }
    setError(undefined);
    const rest = oneoffs.filter((o) => o.date !== newDate);
    setOneoffs([...rest, { date: newDate, level: "hard" as const, arrive: lateDefault(startOfDate(newDate)) }].sort((a, b) => (a.date < b.date ? -1 : 1)));
    setNewDate("");
  }

  const director = props.directorName;
  const summary: { what: string; level: OneOffLevel; text: string }[] = [];
  for (const w of weekdays) {
    const a = answerFor(w.weekday);
    const every = `Every ${WEEKDAY_NAMES[w.weekday]}`;
    if (a.choice === "never") summary.push({ what: every, level: "hard", text: "Can't come" });
    if (a.choice === "late") summary.push({ what: every, level: "late", text: `Arrives ${time12(a.arrive)}` });
    if (a.choice === "keep" && a.orig) {
      const o = a.orig;
      if (o.level === "soft") summary.push({ what: every, level: "soft", text: "Rather not" });
      else if (o.level === "partial")
        summary.push({ what: every, level: "late", text: o.arrive ? `Arrives ${time12(o.arrive)}` : `Leaves ${time12(o.leave)}` });
    }
  }
  for (const o of oneoffs) {
    const text = o.level === "late" ? (o.arrive ? `Arrives ${time12(o.arrive)}` : `Leaves ${time12(o.leave)}`) : LEVEL_LABEL[o.level];
    summary.push({ what: longDate(o.date), level: o.level, text });
  }

  function validate(): string | undefined {
    for (const w of weekdays) {
      const a = answerFor(w.weekday);
      if (a.choice === "late" && !a.arrive) return `Add the time you can get there on ${WEEKDAY_NAMES[w.weekday]}s.`;
    }
    for (const o of oneoffs) {
      if (o.level === "late" && !o.arrive) return `Add the time you can get there on ${longDate(o.date)}.`;
      if (o.level === "late" && o.leave && o.arrive >= o.leave) return `On ${longDate(o.date)}, arriving has to be before leaving.`;
    }
    return undefined;
  }

  async function send() {
    const problem = validate();
    if (problem) return setError(problem);
    const weekly: SaveConflictsBody["weekly"] = [];
    const shown = new Set(weekdays.map((w) => w.weekday));
    for (let wd = 0; wd < 7; wd++) {
      const a = week[wd];
      if (!a) continue;
      const keep = (o: WeeklyConflict) => ({ weekday: wd, level: o.level, arrive: o.arrive, leave: o.leave, note: o.note });
      if (!shown.has(wd)) {
        if (a.orig) weekly.push(keep(a.orig)); // A day none of their shows rehearse: leave it alone.
      } else if (a.choice === "never") weekly.push({ weekday: wd, level: "hard" });
      else if (a.choice === "late") weekly.push({ weekday: wd, level: "partial", arrive: a.arrive });
      else if (a.choice === "keep" && a.orig) weekly.push(keep(a.orig));
    }
    const dates: SaveConflictsBody["dates"] = oneoffs.map((o) =>
      o.level === "late"
        ? { date: o.date, level: "partial", arrive: o.arrive, leave: o.leave ?? null }
        : { date: o.date, level: o.level },
    );
    const kept = new Set(oneoffs.map((o) => o.date));
    const clearDates = existingDates.map((d) => d.date).filter((d) => !kept.has(d));
    setSending(true);
    setError(undefined);
    try {
      await api.saveConflicts({ weekly, dates, clearDates, replaceWeekly: true, submitTo: "all" });
      await reloadMe();
      setStep(4);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const name = firstName(me.user.name);
  const sendLabel = director ? `Send to ${director}` : "Send my conflicts";

  if (step === 4) {
    return (
      <main className="actor-setup">
        <div className="actor-step">
          <div className="actor-center" style={{ paddingTop: 40 }}>
            <div className="actor-medallion actor-medallion-sm" aria-hidden="true">
              <Icon name="check" size={34} strokeWidth={2.5} />
            </div>
            <h1 className="title-md">{name ? `You're all set, ${name}` : "You're all set"}</h1>
            <p>
              {director ? `${director} has` : "Your director has"} your conflicts. Your calls show up here once the schedule is
              published.
            </p>
            <Link to={`/shows/${show.showId}`} className="btn btn-primary btn-lg">
              Go to my show
            </Link>
            <Link to={`/shows/${show.showId}/conflicts`} style={{ minHeight: 44, display: "flex", alignItems: "center", fontWeight: 600, fontSize: 14 }}>
              See every rehearsal date
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="actor-setup">
      <div className="actor-steps-top">
        <span className="kicker">{show.name}</span>
        <span className="actor-step-label">Step {step} of 3</span>
      </div>
      <div className="actor-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={step >= n ? "on" : undefined} />
        ))}
      </div>

      <div className="actor-step">
        {step === 1 && (
          <>
            <div className="actor-step-head">
              <h1>Any days you can never do?</h1>
              <p>
                {weekdays.length
                  ? "We rehearse these days. Tell us about your usual week, not one-offs."
                  : "Rehearsal days aren't set yet, so there's no usual week to ask about. You can still add one-off dates."}
              </p>
            </div>
            {weekdays.map((w) => {
              const a = answerFor(w.weekday);
              const choices: { id: WeekChoice; label: string; cls: string }[] = [
                { id: "fine", label: "Fine", cls: "in" },
                { id: "late", label: "Late", cls: "late" },
                { id: "never", label: "Never", cls: "hard" },
              ];
              return (
                <div key={w.weekday} className="actor-daycard" role="group" aria-label={`${WEEKDAY_NAMES[w.weekday]}s`}>
                  <div className="actor-daycard-top">
                    <strong>{WEEKDAY_NAMES[w.weekday]}s</strong>
                    <span>{w.time}</span>
                  </div>
                  <div className="actor-choices">
                    {choices.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`actor-choice ${c.cls}`}
                        aria-pressed={a.choice === c.id}
                        onClick={() =>
                          setWeekday(w.weekday, { choice: c.id, arrive: c.id === "late" && !a.arrive ? lateDefault(w.start) : a.arrive })
                        }
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {a.choice === "keep" && a.orig && (
                    <span className="actor-usual">
                      Right now:{" "}
                      {a.orig.level === "soft"
                        ? "rather not"
                        : a.orig.arrive
                          ? `late, arriving ${time12(a.orig.arrive)}`
                          : `leaving at ${time12(a.orig.leave)}`}
                      . Tap a choice to change it.
                    </span>
                  )}
                  {a.choice === "late" && (
                    <label className="actor-time">
                      I can get there by
                      <input type="time" value={a.arrive} onChange={(e) => setWeekday(w.weekday, { arrive: e.target.value })} />
                    </label>
                  )}
                </div>
              );
            })}
          </>
        )}

        {step === 2 && (
          <>
            <div className="actor-step-head">
              <h1>Any trips or one-off dates?</h1>
              <p>
                Weddings, work trips, a kid's recital. Rehearsals run {monthDay(windowStart)} to {monthDay(windowEnd)}.
              </p>
            </div>
            {oneoffs.map((o, i) => {
              const label = longDate(o.date);
              const update = (patch: Partial<OneOff>) => setOneoffs(oneoffs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={o.date} className="actor-oneoff">
                  <div className="actor-oneoff-row">
                    <span className="actor-oneoff-main">
                      <strong>{label}</strong>
                      <button
                        type="button"
                        className={`actor-level ${o.level}`}
                        aria-label={`${label}: ${LEVEL_LABEL[o.level]}. Tap to change.`}
                        onClick={() => {
                          const level = CYCLE[(CYCLE.indexOf(o.level) + 1) % CYCLE.length]!;
                          update({ level, arrive: o.arrive || lateDefault(startOfDate(o.date)) });
                        }}
                      >
                        {LEVEL_LABEL[o.level]}
                      </button>
                    </span>
                    <button
                      type="button"
                      className="actor-icon-btn"
                      aria-label={`Remove ${label}`}
                      onClick={() => setOneoffs(oneoffs.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                  {o.level === "late" && (
                    <label className="actor-time">
                      I can get there by
                      <input type="time" value={o.arrive} onChange={(e) => update({ arrive: e.target.value })} />
                    </label>
                  )}
                </div>
              );
            })}
            <div className="actor-add">
              <label className="field">
                Add a date
                <input
                  type="date"
                  min={windowStart < today ? today : windowStart}
                  max={windowEnd}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </label>
              <button type="button" className="btn btn-outline" onClick={addDate} disabled={!newDate}>
                Add
              </button>
            </div>
            <p className="small" style={{ color: "var(--muted-2)" }}>
              Tap the colored tag to switch between can't come, rather not, and late.
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <div className="actor-step-head">
              <h1>Here's what {director ?? "your director"} will see</h1>
              <p>You can change this any time from the Conflicts tab.</p>
            </div>
            <div className="actor-summary">
              {summary.map((r) => (
                <div key={r.what}>
                  <span>{r.what}</span>
                  <span className={`actor-level ${r.level}`}>{r.text}</span>
                </div>
              ))}
              {!summary.length && <p>No conflicts. You can make every rehearsal.</p>}
            </div>
          </>
        )}
        <FormError error={error} />
      </div>

      <div className="actor-footer">
        {step > 1 && (
          <button type="button" className="btn btn-lg" onClick={() => (setError(undefined), setStep(step - 1))}>
            Back
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={sending}
          onClick={() => {
            if (step < 3) {
              const problem = step === 1 || step === 2 ? validate() : undefined;
              if (problem) return setError(problem);
              setError(undefined);
              setStep(step + 1);
            } else void send();
          }}
        >
          {step === 1 ? "Next" : step === 2 ? (oneoffs.length ? "Next" : "No one-offs, next") : sending ? "Sending..." : sendLabel}
        </button>
      </div>
    </main>
  );
}
