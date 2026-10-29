import { useState } from "react";
import { api } from "../../api";
import { dateRange, daysBetween, monthName, todayIso } from "../../lib/dates";
import { Link, navigate } from "../../router";
import { useSession } from "../../session";
import { CompanyShell } from "../../shell";
import type { Admin, Member, ShowSummary, TheaterView } from "../../types";
import { Avatar, ErrorView, Loading, useToast } from "../../ui";
import { useAsync } from "../../useAsync";
import "./company.css";
import { ArchiveDialog, isStageManager } from "./setup-parts";

// ---- Show facts, computed from the summary -------------------------------------------------------

export type ShowState = "rehearsal" | "setup" | "planned" | "closed";

export const STATE_LABEL: Record<ShowState, string> = {
  rehearsal: "In rehearsal",
  setup: "Setting up",
  planned: "Planned",
  closed: "Closed",
};

/** Far enough out, with no nights set, that a show is only an idea on the calendar. */
const PLANNED_DAYS = 60;

export function showState(s: ShowSummary, today = todayIso()): ShowState {
  const show = s.show;
  if (today > show.endDate) return "closed";
  if (today >= show.startDate) return "rehearsal";
  if (!show.slots.length && daysBetween(today, show.startDate) > PLANNED_DAYS) return "planned";
  return "setup";
}

const SEASONS = ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer", "Fall", "Fall", "Fall", "Winter"];

/** "Opens Dec 4, 2026" / "Dec 18–20, 2026" / "Spring 2027" / "Closed Apr 2026" */
export function whenLine(s: ShowSummary, state = showState(s)): string {
  const show = s.show;
  const opening = show.openingDate ?? show.startDate;
  if (state === "closed") return `Closed ${monthName(show.endDate).slice(0, 3)} ${show.endDate.slice(0, 4)}`;
  if (state === "planned") return `${SEASONS[Number(opening.slice(5, 7)) - 1]} ${opening.slice(0, 4)}`;
  if (state === "rehearsal") return `Opens ${dateRange(opening, opening)}`;
  return dateRange(opening, show.endDate);
}

const SHORT_TITLE: Record<string, string> = {
  "stage manager": "SM",
  "assistant stage manager": "ASM",
  "assistant sm": "ASM",
};

function staffName(m: Member): string {
  return m.name || m.email || "Invited";
}

/** "Jordan Reyes, director · Priya Nair, SM" */
export function staffLine(staff: Member[]): string {
  // Invites without a name yet would show as bare email addresses; leave them out of the line.
  staff = staff.filter((m) => m.name || m.status === "joined");
  if (!staff.length) return "No staff yet";
  const rank = (m: Member) => (/^director$/i.test(m.title ?? "") ? 0 : isStageManager(m.title) ? 1 : 2);
  const sorted = [...staff].sort((a, b) => rank(a) - rank(b));
  const shown = sorted.slice(0, 3).map((m) => {
    const t = (m.title ?? "").trim();
    const title = SHORT_TITLE[t.toLowerCase()] ?? t.toLowerCase();
    return title ? `${staffName(m)}, ${title}` : staffName(m);
  });
  return shown.join(" · ") + (sorted.length > 3 ? ` · ${sorted.length - 3} more` : "");
}

export function peopleLine(s: ShowSummary): string {
  const crew = s.crewCount ? `${s.crewCount} crew` : "";
  if (!s.castCount) return crew ? `No cast yet · ${crew}` : "No cast yet";
  return [`${s.castCount} cast`, crew].filter(Boolean).join(" · ");
}

interface Todo {
  key: string;
  text: string;
  action: string;
  run: () => void | Promise<void>;
}

// ---- Page ---------------------------------------------------------------------------------------

export function CompanyHome(props: { theaterId: string }) {
  const { data, error, reload, setData } = useAsync(() => api.theater(props.theaterId), [props.theaterId]);
  if (error)
    return (
      <CompanyShell>
        <ErrorView message={error} />
      </CompanyShell>
    );
  if (!data)
    return (
      <CompanyShell>
        <Loading />
      </CompanyShell>
    );
  return <Home view={data} reload={async () => void (await reload())} setView={setData} />;
}

function Home(props: { view: TheaterView; reload: () => Promise<void>; setView: (v: TheaterView) => void }) {
  const { me } = useSession();
  const { view } = props;
  const theaterId = view.theater.theaterId;
  const [toast, showToast] = useToast();
  const [archiving, setArchiving] = useState<ShowSummary>();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string>();

  const today = todayIso();
  // Upcoming and running shows first, by start date; closed ones after.
  const active = view.shows
    .filter((s) => s.show.status === "active")
    .sort((a, b) => Number(a.show.endDate < today) - Number(b.show.endDate < today) || a.show.startDate.localeCompare(b.show.startDate));
  const archived = view.shows.filter((s) => s.show.status === "archived");

  const todos = (s: ShowSummary): Todo[] => {
    const show = s.show;
    const state = showState(s, today);
    if (state === "closed") return [];
    const out: Todo[] = [];
    if (s.waitingCount > 0)
      out.push({
        key: "remind",
        text: `${s.waitingCount} ${s.waitingCount === 1 ? "person has" : "people have"} no conflicts in yet`,
        action: "Remind them",
        run: async () => {
          const r = await api.remind(show.showId);
          const parts = [
            r.conflictReminders ? `${r.conflictReminders} ${r.conflictReminders === 1 ? "reminder" : "reminders"} sent` : "",
            r.invitesResent ? `${r.invitesResent} ${r.invitesResent === 1 ? "invite" : "invites"} resent` : "",
          ].filter(Boolean);
          showToast(parts.length ? parts.join(", ") + "." : "Nobody to remind.");
        },
      });
    if (!show.slots.length)
      out.push({ key: "slots", text: "Finish setup: rehearsal nights", action: "Finish setup", run: () => navigate(`/shows/${show.showId}/settings`) });
    if (!s.staff.some((m) => isStageManager(m.title)))
      out.push({ key: "sm", text: "Invite a stage manager", action: "Invite", run: () => navigate(`/c/${theaterId}/staff?invite=${show.showId}`) });
    if (show.techStart) {
      const n = daysBetween(today, show.techStart);
      if (n >= 0 && n <= 31)
        out.push({
          key: "tech",
          text: n === 0 ? "Tech week starts today" : n === 1 ? "Tech week starts tomorrow" : `Tech week starts in ${n} days`,
          action: "Check dates",
          run: () => navigate(`/shows/${show.showId}/settings`),
        });
    }
    return out;
  };

  const runTodo = async (s: ShowSummary, t: Todo) => {
    setBusy(`${s.show.showId}:${t.key}`);
    try {
      await t.run();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const restore = async (s: ShowSummary) => {
    setBusy(`restore:${s.show.showId}`);
    try {
      await api.restoreShow(s.show.showId);
      await props.reload();
      showToast(`${s.show.name} is back in your shows.`);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const needs = active.map((s) => ({ s, items: todos(s) })).filter((n) => n.items.length);

  return (
    <CompanyShell context={view.theater.name}>
      <main className="co-page co-home">
        <div className="co-col">
          <div className="co-head">
            <h1>{view.theater.name}</h1>
            <Link to={`/c/${theaterId}/new-show`} className="btn btn-primary">
              + New show
            </Link>
          </div>

          {active.length === 0 && archived.length === 0 ? (
            <div className="empty co-empty">
              <span className="title-sm" style={{ color: "var(--ink)" }}>
                No shows yet
              </span>
              <span>Add your first show to set its dates and rehearsal nights and invite your staff.</span>
              <Link to={`/c/${theaterId}/new-show`} className="btn btn-primary">
                + New show
              </Link>
            </div>
          ) : (
            <>
              <span className="caps">Needs you</span>
              {needs.length === 0 && <span className="co-nothing">Nothing needs you right now.</span>}
              {needs.map(({ s, items }) => {
                const state = showState(s, today);
                return (
                  <section key={s.show.showId} className="co-need" aria-label={s.show.name}>
                    <div className="co-need-head">
                      <span className="grow stack-sm" style={{ gap: 0 }}>
                        <Link to={`/shows/${s.show.showId}`} className="co-need-title">
                          {s.show.name}
                        </Link>
                        <span className="co-need-meta">
                          {whenLine(s, state)} · {staffLine(s.staff)}
                        </span>
                      </span>
                      <span className={`co-tag co-tag-${state}`}>{STATE_LABEL[state]}</span>
                      <Link to={`/shows/${s.show.showId}`} className="btn">
                        Open
                      </Link>
                    </div>
                    {items.map((t, i) => (
                      <div key={t.key} className={i === 0 ? "co-todo co-todo-first" : "co-todo"}>
                        <span className="co-todo-text">{t.text}</span>
                        <button
                          type="button"
                          className="text-action"
                          disabled={busy === `${s.show.showId}:${t.key}`}
                          onClick={() => void runTodo(s, t)}
                        >
                          {busy === `${s.show.showId}:${t.key}` ? "Sending..." : t.action}
                        </button>
                      </div>
                    ))}
                  </section>
                );
              })}

              {active.length > 0 && <span className="caps co-section-label">All shows</span>}
              <div className="co-grid">
                {active.map((s) => {
                  const state = showState(s, today);
                  const warn = todos(s)[0]?.text;
                  return (
                    <article key={s.show.showId} className="co-card">
                      <Link to={`/shows/${s.show.showId}`}>
                        <div className="co-card-top">
                          <span className={`co-tag co-tag-${state}`}>{STATE_LABEL[state]}</span>
                          <span className="co-card-title">{s.show.name}</span>
                          <span className="co-card-when">{whenLine(s, state)}</span>
                        </div>
                        <div className="co-card-body">
                          <span>{staffLine(s.staff)}</span>
                          <span>{peopleLine(s)}</span>
                          {warn && <span className="co-card-warn">{warn}</span>}
                        </div>
                      </Link>
                      {state === "closed" && (
                        <div className="co-card-foot">
                          <span>Closed. Archive it to tidy up your home.</span>
                          <button type="button" className="btn" onClick={() => setArchiving(s)}>
                            Archive show
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {archived.length > 0 && (
                <div className="co-archived">
                  <button type="button" className="co-archived-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
                    <span className="caps">Archived · {archived.length}</span>
                    <span className="text-action">{showArchived ? "Hide" : "Show"}</span>
                  </button>
                  {showArchived &&
                    archived.map((s) => (
                      <div key={s.show.showId} className="co-archived-row">
                        <span className="stack-sm" style={{ gap: 0 }}>
                          <span className="name">{s.show.name}</span>
                          <span className="meta">
                            {whenLine(s, "closed")} · {peopleLine(s)}
                            {s.show.archivedAt && ` · archived ${monthName(s.show.archivedAt.slice(0, 10)).slice(0, 3)} ${s.show.archivedAt.slice(0, 4)}`}
                          </span>
                        </span>
                        <Link to={`/shows/${s.show.showId}`}>View (read-only)</Link>
                        <button type="button" className="btn" disabled={busy === `restore:${s.show.showId}`} onClick={() => void restore(s)}>
                          {busy === `restore:${s.show.showId}` ? "Restoring..." : "Restore"}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        <aside>
          <AdminsPanel admins={view.admins} meId={me.user.userId} theaterId={theaterId} />
        </aside>
      </main>
      {archiving && (
        <ArchiveDialog
          showName={archiving.show.name}
          onCancel={() => setArchiving(undefined)}
          onConfirm={async () => {
            const show = await api.archiveShow(archiving.show.showId);
            props.setView({ ...view, shows: view.shows.map((s) => (s.show.showId === show.showId ? { ...s, show } : s)) });
            setArchiving(undefined);
            setShowArchived(true);
            showToast(`${show.name} archived.`);
          }}
        />
      )}
      {toast}
    </CompanyShell>
  );
}

function AdminsPanel(props: { admins: Admin[]; meId: string; theaterId: string }) {
  return (
    <section className="co-panel" aria-label="Company admins">
      <h2 className="co-panel-title">Company admins</h2>
      <span className="co-panel-sub">See every show, add shows, manage admins.</span>
      {[...props.admins].sort((a, b) => Number(b.userId === props.meId) - Number(a.userId === props.meId)).map((a) => (
        <div key={a.userId} className="co-person">
          <Avatar name={a.name} email={a.email} />
          <span className="co-person-text">
            <span className="co-person-name">{a.name || a.email}</span>
            <span className="co-person-sub">{[a.title || "Company admin", a.userId === props.meId ? "you" : ""].filter(Boolean).join(" · ")}</span>
          </span>
        </div>
      ))}
      <Link to={`/c/${props.theaterId}/staff`} className="btn btn-dashed">
        Manage staff and admins
      </Link>
    </section>
  );
}
