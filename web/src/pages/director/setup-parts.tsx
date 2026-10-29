// Pieces shared by the setup wizard and show settings: the show plan (dates, nights, skips),
// weekday chips, rehearsal times, the month calendar, the playbill card, and the archive dialog.
import { useEffect, useMemo, useState } from "react";
import { addDays, dateRange, dayOfMonth, monthName, parseDate, shortDate, todayIso } from "../../lib/dates";
import type { RehearsalSlot, Show } from "../../types";
import { Dialog, FormError } from "../../ui";
import "./company.css";

// ---- The plan -----------------------------------------------------------------------------------

/** Times for one weekday. Keys of SlotMap are API weekdays: 0 = Monday ... 6 = Sunday. */
export interface SlotTime {
  start: string;
  end: string;
}
export type SlotMap = Partial<Record<number, SlotTime>>;

export interface ShowPlan {
  name: string;
  venue: string;
  address: string;
  timezone: string;
  startDate: string;
  openingDate: string;
  endDate: string;
  techStart: string;
  /** False until someone edits tech start; until then it follows opening night. */
  techTouched: boolean;
  slots: SlotMap;
  skipped: string[];
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  if (!all.length) all = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London"];
  return all.includes(current) ? all : [current, ...all];
}

export const DEFAULT_TIMES: Record<"weeknights" | "saturdays" | "sundays", SlotTime> = {
  weeknights: { start: "19:00", end: "21:30" },
  saturdays: { start: "10:00", end: "13:00" },
  sundays: { start: "13:00", end: "17:00" },
};

export function defaultTime(weekday: number): SlotTime {
  return weekday === 5 ? DEFAULT_TIMES.saturdays : weekday === 6 ? DEFAULT_TIMES.sundays : DEFAULT_TIMES.weeknights;
}

export function emptyPlan(): ShowPlan {
  return {
    name: "",
    venue: "",
    address: "",
    timezone: browserTimezone(),
    startDate: "",
    openingDate: "",
    endDate: "",
    techStart: "",
    techTouched: false,
    slots: Object.fromEntries([0, 1, 2, 3].map((d) => [d, { ...DEFAULT_TIMES.weeknights }])),
    skipped: [],
  };
}

export function planFromShow(show: Show): ShowPlan {
  return {
    name: show.name,
    venue: show.venue ?? "",
    address: show.address ?? "",
    timezone: show.timezone,
    startDate: show.startDate,
    openingDate: show.openingDate ?? "",
    endDate: show.endDate,
    techStart: show.techStart ?? "",
    techTouched: true,
    slots: Object.fromEntries(show.slots.map((s) => [s.weekday, { start: s.start, end: s.end }])),
    skipped: [...show.skippedDates],
  };
}

export function slotList(slots: SlotMap): RehearsalSlot[] {
  return Object.entries(slots)
    .filter((e): e is [string, SlotTime] => !!e[1])
    .map(([d, t]) => ({ weekday: Number(d), start: t.start, end: t.end }))
    .sort((a, b) => a.weekday - b.weekday);
}

/** API weekday (0 = Monday) of a YYYY-MM-DD date. */
const apiWeekday = (iso: string) => (parseDate(iso).getUTCDay() + 6) % 7;

/** Tech week starts this many days before opening unless someone picks a date. */
export const TECH_LEAD_DAYS = 5;

export function defaultTech(plan: Pick<ShowPlan, "openingDate" | "startDate">): string {
  if (!plan.openingDate) return "";
  const tech = addDays(plan.openingDate, -TECH_LEAD_DAYS);
  return plan.startDate && tech < plan.startDate ? plan.startDate : tech;
}

/** The last day ordinary rehearsals can fall on: the day before tech, opening, or closing. */
function rehearsalEnd(plan: ShowPlan): string {
  if (plan.techStart) return addDays(plan.techStart, -1);
  if (plan.openingDate) return addDays(plan.openingDate, -1);
  return plan.endDate;
}

export type DayKind = "rehearsal" | "skipped" | "tech" | "opening" | "show" | "plain";

export function dayKind(plan: ShowPlan, iso: string): DayKind {
  if (!plan.startDate || iso < plan.startDate || (plan.endDate && iso > plan.endDate)) return "plain";
  if (plan.openingDate && iso === plan.openingDate) return "opening";
  if (plan.openingDate && iso > plan.openingDate) return "show";
  if (plan.techStart && iso >= plan.techStart) return "tech";
  if (iso > rehearsalEnd(plan) || !plan.slots[apiWeekday(iso)]) return "plain";
  return plan.skipped.includes(iso) ? "skipped" : "rehearsal";
}

/** Every date between first rehearsal and tech that falls on a rehearsal night. */
export function rehearsalNights(plan: ShowPlan): { date: string; skipped: boolean }[] {
  if (!plan.startDate) return [];
  const end = rehearsalEnd(plan);
  const out: { date: string; skipped: boolean }[] = [];
  for (let d = plan.startDate; d <= end && out.length < 400; d = addDays(d, 1)) {
    if (plan.slots[apiWeekday(d)]) out.push({ date: d, skipped: plan.skipped.includes(d) });
  }
  return out;
}

/** Skips that still land on a rehearsal night (the rest are kept in the form, not sent). */
export function liveSkips(plan: ShowPlan): string[] {
  return rehearsalNights(plan)
    .filter((n) => n.skipped)
    .map((n) => n.date);
}

/** "19 rehearsals, Nov 2–28 · tech Nov 29–Dec 3 · opens Fri, Dec 4" */
export function summaryLine(plan: ShowPlan): string {
  const parts: string[] = [];
  const nights = rehearsalNights(plan).filter((n) => !n.skipped);
  if (!slotList(plan.slots).length) parts.push("No rehearsal nights yet");
  else if (nights.length) {
    const first = nights[0]!.date;
    const last = nights[nights.length - 1]!.date;
    parts.push(`${nights.length} ${nights.length === 1 ? "rehearsal" : "rehearsals"}, ${dateRange(first, last, false)}`);
  } else parts.push("No rehearsals before tech");
  if (plan.techStart && plan.openingDate && plan.techStart < plan.openingDate)
    parts.push(`tech ${dateRange(plan.techStart, addDays(plan.openingDate, -1), false)}`);
  else if (plan.techStart) parts.push(`tech starts ${shortDate(plan.techStart)}`);
  if (plan.openingDate) parts.push(`opens ${shortDate(plan.openingDate)}`);
  return parts.join(" · ");
}

/** Checks the dates in order. Returns a sentence to show, or undefined when it's fine. */
export function checkPlanDates(plan: ShowPlan, opts: { needOpening?: boolean } = {}): string | undefined {
  if (!plan.startDate) return "Add the date of your first rehearsal.";
  if (opts.needOpening && !plan.openingDate) return "Add opening night.";
  if (!plan.endDate) return "Add the closing date.";
  if (plan.endDate < plan.startDate) return "Closing has to be on or after the first rehearsal.";
  if (plan.openingDate && plan.openingDate < plan.startDate) return "Opening night has to be on or after the first rehearsal.";
  if (plan.openingDate && plan.openingDate > plan.endDate) return "Opening night has to be on or before closing.";
  if (plan.techStart) {
    if (plan.techStart < plan.startDate) return "Tech week can't start before the first rehearsal.";
    if (plan.techStart > plan.endDate) return "Tech week has to start before closing.";
    if (plan.openingDate && plan.techStart > plan.openingDate) return "Tech week has to start on or before opening night.";
  }
  return undefined;
}

export function checkSlots(plan: ShowPlan): string | undefined {
  for (const s of slotList(plan.slots)) {
    if (!s.start || !s.end) return "Every rehearsal night needs a start and end time.";
    if (s.end <= s.start) return "Rehearsals have to end after they start.";
  }
  return undefined;
}

// ---- Staff roles --------------------------------------------------------------------------------

export const STAFF_ROLES = [
  "Director",
  "Stage manager",
  "Assistant director",
  "Assistant SM",
  "Technical director",
  "Music director",
  "Choreographer",
] as const;

export function departmentFor(title: string): string {
  return title === "Stage manager" || title === "Assistant SM" ? "Stage management" : "Production";
}

/** True for a stage manager title, not an assistant. */
export function isStageManager(title: string | null | undefined): boolean {
  const t = (title ?? "").trim().toLowerCase();
  return t === "sm" || (t.includes("stage manager") && !t.includes("assistant") && !t.includes("asst"));
}

const ROLE_WORD: Record<string, string> = { "Assistant SM": "assistant stage manager" };

/** The plain sentence under the invite form. */
export function roleSentence(title: string, showName: string): string {
  const role = ROLE_WORD[title] ?? title.toLowerCase();
  return `As ${role} on ${showName} they can build the schedule, post to the callboard and manage people for this show only. Other shows stay hidden.`;
}

export const ADMIN_SENTENCE = "As a company admin they can see and run every show, add shows, and manage staff and admins.";

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// ---- Form pieces --------------------------------------------------------------------------------

const CHIP_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Sun .. Sat as API weekdays
const CHIP_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAY = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

export function DayChips(props: { slots: SlotMap; onChange: (slots: SlotMap) => void; disabled?: boolean }) {
  const weeknightTime = [0, 1, 2, 3, 4].map((d) => props.slots[d]).find(Boolean);
  const toggle = (d: number) => {
    const next = { ...props.slots };
    if (next[d]) delete next[d];
    else next[d] = { ...(d < 5 && weeknightTime ? weeknightTime : defaultTime(d)) };
    props.onChange(next);
  };
  return (
    <div className="stack-sm">
      <span className="co-label">Rehearsal nights</span>
      <div className="chips">
        {CHIP_ORDER.map((d) => (
          <button
            key={d}
            type="button"
            className="co-day"
            aria-pressed={!!props.slots[d]}
            disabled={props.disabled}
            onClick={() => toggle(d)}
          >
            {CHIP_LABEL[d]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TimeGroup {
  label: string;
  days: number[];
}

/** Weeknights share one time unless they already differ; Saturdays and Sundays get their own. */
function timeGroups(slots: SlotMap): TimeGroup[] {
  const weeknights = [0, 1, 2, 3, 4].filter((d) => slots[d]);
  const same = weeknights.every((d) => slots[d]!.start === slots[weeknights[0]!]!.start && slots[d]!.end === slots[weeknights[0]!]!.end);
  const groups: TimeGroup[] = [];
  if (weeknights.length && same) groups.push({ label: weeknights.length === 1 ? LONG_DAY[weeknights[0]!]! : "Weeknights", days: weeknights });
  else weeknights.forEach((d) => groups.push({ label: LONG_DAY[d]!, days: [d] }));
  if (slots[5]) groups.push({ label: "Saturdays", days: [5] });
  if (slots[6]) groups.push({ label: "Sundays", days: [6] });
  return groups;
}

export function TimeFields(props: { slots: SlotMap; onChange: (slots: SlotMap) => void; disabled?: boolean }) {
  const groups = timeGroups(props.slots);
  if (!groups.length) return null;
  const set = (g: TimeGroup, key: "start" | "end", value: string) => {
    const next = { ...props.slots };
    for (const d of g.days) next[d] = { ...next[d]!, [key]: value };
    props.onChange(next);
  };
  return (
    <div className="co-times">
      {groups.map((g) => {
        const t = props.slots[g.days[0]!]!;
        return (
          <fieldset key={g.label} className="co-time" disabled={props.disabled}>
            <legend className="co-label">{g.label}</legend>
            <div className="co-time-row">
              <input type="time" aria-label={`${g.label} start`} value={t.start} onChange={(e) => set(g, "start", e.target.value)} />
              <span className="muted">to</span>
              <input type="time" aria-label={`${g.label} end`} value={t.end} onChange={(e) => set(g, "end", e.target.value)} />
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Text and date fields, bound to one key of the plan. */
export function PlanInput(props: {
  plan: ShowPlan;
  field: "name" | "venue" | "address" | "startDate" | "openingDate" | "endDate" | "techStart";
  label: string;
  hint?: string;
  type?: "text" | "date";
  placeholder?: string;
  onChange: (plan: ShowPlan) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { plan, field } = props;
  const update = (value: string) => {
    const next: ShowPlan = { ...plan, [field]: value };
    if (field === "techStart") next.techTouched = !!value;
    if ((field === "openingDate" || field === "startDate") && !plan.techTouched) next.techStart = defaultTech(next);
    props.onChange(next);
  };
  return (
    <label className="field">
      {props.label}
      {props.hint && <span className="hint">{props.hint}</span>}
      <input
        type={props.type ?? "text"}
        value={plan[field]}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoFocus={props.autoFocus}
        maxLength={props.type === "date" ? undefined : field === "name" ? 120 : 200}
        onChange={(e) => update(e.target.value)}
      />
    </label>
  );
}

export function TimezoneSelect(props: { plan: ShowPlan; onChange: (plan: ShowPlan) => void; disabled?: boolean }) {
  const zones = useMemo(() => timezones(props.plan.timezone), [props.plan.timezone]);
  return (
    <label className="field">
      Time zone
      <select value={props.plan.timezone} disabled={props.disabled} onChange={(e) => props.onChange({ ...props.plan, timezone: e.target.value })}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Step 2 of the wizard; the "Show and venue" section of settings. */
export function ShowFields(props: { plan: ShowPlan; onChange: (plan: ShowPlan) => void; disabled?: boolean; autoFocus?: boolean }) {
  const p = { plan: props.plan, onChange: props.onChange, disabled: props.disabled };
  return (
    <div className="stack">
      <PlanInput {...p} field="name" label="Show title" placeholder="A Midsummer Night's Dream" autoFocus={props.autoFocus} />
      <div className="form-grid">
        <PlanInput {...p} field="venue" label="Where you rehearse" placeholder="Fellowship Hall" />
        <PlanInput {...p} field="address" label="Address" placeholder="210 Elm St" />
      </div>
      <TimezoneSelect {...p} />
    </div>
  );
}

export function DateFields(props: { plan: ShowPlan; onChange: (plan: ShowPlan) => void; disabled?: boolean; withTech?: boolean }) {
  const p = { plan: props.plan, onChange: props.onChange, disabled: props.disabled, type: "date" as const };
  return (
    <div className="co-dates">
      <PlanInput {...p} field="startDate" label="First rehearsal" />
      {props.withTech && <PlanInput {...p} field="techStart" label="Tech week starts" />}
      <PlanInput {...p} field="openingDate" label="Opening night" />
      <PlanInput {...p} field="endDate" label="Closing" />
    </div>
  );
}

/** Step 3 of the wizard; the rehearsal section of settings. Calendar goes in the preview. */
export function RehearsalFields(props: { plan: ShowPlan; onChange: (plan: ShowPlan) => void; disabled?: boolean }) {
  const { plan, onChange } = props;
  const setSlots = (slots: SlotMap) => onChange({ ...plan, slots });
  return (
    <div className="stack">
      <DayChips slots={plan.slots} onChange={setSlots} disabled={props.disabled} />
      <TimeFields slots={plan.slots} onChange={setSlots} disabled={props.disabled} />
    </div>
  );
}

// ---- Preview ------------------------------------------------------------------------------------

export function PlaybillCard(props: { company: string; show: string; venue?: string }) {
  return (
    <div className="co-playbill">
      <span className="caps">{props.company || "Your company"}</span>
      <span className="co-playbill-title">{props.show || "Your show"}</span>
      {props.venue && <span className="co-playbill-venue">{props.venue}</span>}
    </div>
  );
}

const WD_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function monthsOf(plan: ShowPlan): string[] {
  const from = plan.startDate || todayIso();
  const to = plan.openingDate || plan.endDate || from;
  const out: string[] = [];
  let m = `${from.slice(0, 7)}-01`;
  const last = `${(to < from ? from : to).slice(0, 7)}-01`;
  while (m <= last && out.length < 24) {
    out.push(m);
    const d = parseDate(m);
    d.setUTCMonth(d.getUTCMonth() + 1);
    m = d.toISOString().slice(0, 10);
  }
  return out;
}

/** Seven columns, S to S. Rehearsal days plum, skipped outlined and struck, tech dark. Tap to skip. */
export function MonthCalendar(props: { plan: ShowPlan; onChange?: (plan: ShowPlan) => void; disabled?: boolean; hideSummary?: boolean }) {
  const summary = props.plan.startDate && !props.hideSummary ? summaryLine(props.plan) : "";
  const { plan } = props;
  const months = monthsOf(plan);
  const [index, setIndex] = useState(0);
  // Jump back to the first month when the first rehearsal moves.
  useEffect(() => setIndex(0), [plan.startDate]);
  const month = months[Math.min(index, months.length - 1)]!;
  const lead = parseDate(month).getUTCDay();
  const days: string[] = [];
  for (let d = month; d.slice(0, 7) === month.slice(0, 7); d = addDays(d, 1)) days.push(d);
  const editable = !!props.onChange && !props.disabled;
  const toggle = (iso: string) => {
    if (!editable) return;
    const skipped = plan.skipped.includes(iso) ? plan.skipped.filter((d) => d !== iso) : [...plan.skipped, iso].sort();
    props.onChange!({ ...plan, skipped });
  };
  const skips = liveSkips(plan);
  const skipLine = skips.length
    ? `Skipping ${skips.map((d) => `${monthName(d).slice(0, 3)} ${dayOfMonth(d)}`).join(", ")}.`
    : "No skipped dates.";
  return (
    <div className="co-cal">
      <div className="co-cal-head">
        <span className="co-cal-title">
          {monthName(month)}
          {month.slice(0, 4) !== todayIso().slice(0, 4) && ` ${month.slice(0, 4)}`}
          {summary && ` · ${summary}`}
        </span>
        {months.length > 1 && (
          <span className="co-cal-nav">
            <button type="button" aria-label="Previous month" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              ‹
            </button>
            <button type="button" aria-label="Next month" disabled={index >= months.length - 1} onClick={() => setIndex(index + 1)}>
              ›
            </button>
          </span>
        )}
      </div>
      <div className="co-cal-grid" role="grid" aria-label={`${monthName(month)} rehearsals`}>
        {WD_LETTERS.map((w, i) => (
          <span key={i} className="co-cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {days.map((iso) => {
          const kind = dayKind(plan, iso);
          const canTap = editable && (kind === "rehearsal" || kind === "skipped");
          const label = `${monthName(iso)} ${dayOfMonth(iso)}${
            kind === "rehearsal" ? ", rehearsal" : kind === "skipped" ? ", skipped" : kind === "tech" ? ", tech" : kind === "opening" ? ", opening night" : kind === "show" ? ", performance" : ""
          }`;
          return (
            <button
              key={iso}
              type="button"
              className={`co-cal-day co-cal-${kind}`}
              aria-label={label}
              aria-pressed={kind === "rehearsal" || kind === "skipped" ? kind === "skipped" : undefined}
              disabled={!canTap}
              onClick={() => toggle(iso)}
            >
              {dayOfMonth(iso)}
            </button>
          );
        })}
      </div>
      <span className="co-cal-note">
        {editable ? "Tap a rehearsal date to skip it. " : ""}Dark = tech week. Opening is outlined. {skipLine}
      </span>
    </div>
  );
}

// ---- Archive ------------------------------------------------------------------------------------

export function ArchiveDialog(props: { showName: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await props.onConfirm();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Archive ${props.showName}?`} onClose={props.onCancel}>
      <ul className="co-consequences">
        <li>It moves to Archived at the bottom of company home. Nothing can be edited: conflicts, invites and announcements close.</li>
        <li>Reminders and notices stop, and its calls leave everyone's calendar feed.</li>
        <li>Everyone who was in the show can still view its schedule and cast list. It's kept forever, and staff can restore it any time.</li>
      </ul>
      <FormError error={error} />
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
          {busy ? "Archiving..." : "Archive show"}
        </button>
      </div>
    </Dialog>
  );
}
