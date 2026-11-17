import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { conflictStatus, STATUS_LABEL, STATUS_TAG } from "../../lib/people";
import { useIsPhone } from "../../lib/useMedia";
import { useSession } from "../../session";
import { StaffShell } from "../../shell";
import type { Breakdown, Member, MemberConflicts } from "../../types";
import { Avatar, ErrorView, Icon, Loading, Sheet, useToast } from "../../ui";
import { Confirm, errorText } from "./breakdown/Confirm";
import { InviteDialog } from "./people/InviteDialog";
import { dueText, groups as groupPeople, people as toPeople, readiness, type Person } from "./people/model";
import { PersonDetail } from "./people/PersonDetail";
import { EditMemberDialog, PartsDialog } from "./people/PersonDialogs";
import "./staff-pages.css";

interface Data {
  members: Member[];
  conflicts: MemberConflicts[];
  bd?: Breakdown;
}

type Open = { kind: "invite" } | { kind: "parts"; userId: string } | { kind: "edit"; userId: string } | { kind: "remove"; userId: string };
type Filter = "all" | "waiting" | "cast" | "crew";

function remindMessage(r: { invitesResent: number; conflictReminders: number }): string {
  const parts = [];
  if (r.invitesResent) parts.push(`resent ${r.invitesResent} invite${r.invitesResent === 1 ? "" : "s"}`);
  if (r.conflictReminders) parts.push(`sent ${r.conflictReminders} conflict reminder${r.conflictReminders === 1 ? "" : "s"}`);
  if (!parts.length) return "Nobody needed a reminder";
  const s = parts.join(" and ");
  return s[0]!.toUpperCase() + s.slice(1);
}

export function People(props: ShowPageProps) {
  const { show } = props.view;
  const showId = show.showId;
  const phone = useIsPhone();
  const readOnly = show.status === "archived";
  const { me } = useSession();
  const myId = me.user.userId;
  const [toast, showToast] = useToast();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [sheetFor, setSheetFor] = useState<string>();
  const [open, setOpen] = useState<Open>();
  const [reminding, setReminding] = useState<string>(); // "all" or a userId
  const [reminded, setReminded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const reload = useCallback(async () => {
    try {
      const [members, conflicts, bd] = await Promise.all([
        api.members(showId),
        api.showConflicts(showId),
        api.breakdown(showId).catch(() => undefined),
      ]);
      setData({ members, conflicts, bd });
      setError(undefined);
    } catch (e) {
      setError(errorText(e));
    }
  }, [showId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const onSaved = useCallback(
    async (message: string) => {
      await reload();
      setReminded(false);
      showToast(message);
    },
    [reload, showToast],
  );

  const list = useMemo(() => (data ? toPeople(data.members, data.bd) : []), [data]);
  const allGroups = useMemo(() => groupPeople(list), [list]);
  const departments = useMemo(
    () => [...new Set(data?.members.map((m) => m.department?.trim()).filter((d): d is string => !!d))].sort(),
    [data],
  );
  const conflictsBy = useMemo(() => new Map(data?.conflicts.map((c) => [c.userId, c])), [data]);

  if (error && !data)
    return (
      <StaffShell view={props.view} current="people">
        <ErrorView message={error} onRetry={() => void reload()} />
      </StaffShell>
    );
  if (!data)
    return (
      <StaffShell view={props.view} current="people">
        <Loading />
      </StaffShell>
    );

  const others = data.members.filter((m) => m.userId !== myId);
  const ready = readiness(others);
  const waiting = ready.total - ready.ready;
  const findPerson = (id?: string) => list.find((p) => p.member.userId === id);
  const firstPerson = allGroups[0]?.people[0];
  const sel = findPerson(selected) ?? firstPerson;

  const remindAll = async () => {
    setReminding("all");
    try {
      const r = await api.remind(showId);
      setReminded(true);
      showToast(remindMessage(r));
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setReminding(undefined);
    }
  };
  const remindOne = async (p: Person) => {
    setReminding(p.member.userId);
    try {
      const r = await api.remind(showId, [p.member.userId]);
      showToast(r.invitesResent ? `Invite resent to ${p.name}` : r.conflictReminders ? `Reminded ${p.name} about conflicts` : remindMessage(r));
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setReminding(undefined);
    }
  };

  const detail = (p: Person, phoneSheet: boolean) => (
    <PersonDetail
      person={p}
      conflicts={conflictsBy.get(p.member.userId)}
      isMe={p.member.userId === myId}
      readOnly={readOnly}
      phone={phoneSheet}
      reminding={reminding === p.member.userId}
      onChangePart={() => setOpen({ kind: "parts", userId: p.member.userId })}
      onRemind={() => void remindOne(p)}
      onEdit={() => setOpen({ kind: "edit", userId: p.member.userId })}
      onRemove={() => setOpen({ kind: "remove", userId: p.member.userId })}
      onClose={phoneSheet ? () => setSheetFor(undefined) : undefined}
    />
  );

  const due = readOnly ? "" : dueText(show.conflictDeadline);
  const detailLine = [
    ready.joined ? `${ready.joined} joined but not done` : "",
    ready.invited ? `${ready.invited} haven't opened the invite` : "",
    due,
  ]
    .filter(Boolean)
    .join(" · ");
  const remindLabel = reminded ? "Reminders sent" : `Remind the ${waiting} still waiting`;
  const readyCard =
    ready.total > 0 && waiting > 0 ? (
      <div className={phone ? "sp-ready sp-ready-phone" : "sp-ready"}>
        <div className="sp-ready-top">
          <span className="sp-ready-line">
            {ready.ready} of {ready.total} have their conflicts in
          </span>
          {!readOnly && !phone && (
            <button className="btn btn-outline sp-ready-btn" disabled={!!reminding || reminded} onClick={() => void remindAll()}>
              {reminding === "all" ? "Sending..." : remindLabel}
            </button>
          )}
        </div>
        <div className="sp-ready-bar" role="progressbar" aria-valuemin={0} aria-valuemax={ready.total} aria-valuenow={ready.ready} aria-label="Conflicts in">
          <span style={{ width: `${(100 * ready.ready) / ready.total}%` }} />
          <span className="soft" style={{ width: `${(100 * ready.joined) / ready.total}%` }} />
        </div>
        {detailLine && <span className="sp-ready-detail">{detailLine}</span>}
        {!readOnly && phone && (
          <button className="btn btn-primary btn-block" disabled={!!reminding || reminded} onClick={() => void remindAll()}>
            {reminding === "all" ? "Sending..." : remindLabel}
          </button>
        )}
      </div>
    ) : null;

  const nobody = others.length === 0;
  const emptyCard = nobody ? (
    <div className="sp-start">
      <h2 className="title-sm">Invite your cast and crew</h2>
      <p className="lede">
        Each person gets an email with a link that signs them in. They send their conflicts, and you can see who's ready here.
        {data.bd?.characters.length ? "" : " Add characters on the Breakdown page first if you want to cast people as you invite them."}
      </p>
      {!readOnly && (
        <div className="row">
          <button className="btn btn-primary" onClick={() => setOpen({ kind: "invite" })}>
            Invite people
          </button>
        </div>
      )}
    </div>
  ) : null;

  const keep = (p: Person) =>
    filter === "all" ||
    (filter === "waiting" && conflictStatus(p.member) !== "in") ||
    (filter === "cast" && p.member.role === "cast") ||
    (filter === "crew" && p.member.role !== "cast");
  const shownGroups = phone
    ? allGroups.map((g) => ({ ...g, people: g.people.filter(keep) })).filter((g) => g.people.length)
    : allGroups;

  const dialogs = (
    <>
      {open?.kind === "invite" && (
        <InviteDialog showId={showId} bd={data.bd} departments={departments} onClose={() => setOpen(undefined)} onSaved={onSaved} />
      )}
      {open?.kind === "parts" && findPerson(open.userId) && (
        <PartsDialog showId={showId} person={findPerson(open.userId)!} bd={data.bd} onClose={() => setOpen(undefined)} onSaved={onSaved} />
      )}
      {open?.kind === "edit" && findPerson(open.userId) && (
        <EditMemberDialog
          showId={showId}
          person={findPerson(open.userId)!}
          isMe={open.userId === myId}
          departments={departments}
          onClose={() => setOpen(undefined)}
          onSaved={onSaved}
        />
      )}
      {open?.kind === "remove" && findPerson(open.userId) && (
        <Confirm
          title={`Remove ${findPerson(open.userId)!.name}?`}
          confirmLabel="Remove from show"
          onClose={() => setOpen(undefined)}
          onConfirm={async () => {
            const p = findPerson(open.userId)!;
            await api.removeMember(showId, p.member.userId);
            setSheetFor(undefined);
            setSelected(undefined);
            await onSaved(`Removed ${p.name}`);
          }}
        >
          <p>
            They come off {show.name}
            {findPerson(open.userId)!.parts.length ? " and out of their parts" : ""}, and won't get calls or notices. Their own
            conflicts stay with them. You can invite them again later.
          </p>
        </Confirm>
      )}
    </>
  );

  if (phone) {
    const sheetPerson = findPerson(sheetFor);
    return (
      <StaffShell view={props.view} current="people">
        <main className="sp-phone">
          {readyCard}
          {emptyCard}
          {!nobody && (
            <div className="sp-act-chips" role="group" aria-label="Show">
              {(
                [
                  ["all", "Everyone"],
                  ["waiting", `Waiting · ${waiting}`],
                  ["cast", "Cast"],
                  ["crew", "Crew"],
                ] as [Filter, string][]
              ).map(([id, label]) => (
                <button key={id} className="sp-pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {shownGroups.map((g) => (
            <section key={g.title} className="stack-sm">
              <h2 className="caps sp-group-title-phone">{g.title}</h2>
              {g.people.map((p) => {
                const s = conflictStatus(p.member);
                return (
                  <button key={p.member.userId} className="sp-mperson" onClick={() => setSheetFor(p.member.userId)}>
                    <Avatar name={p.name} email={p.member.email} />
                    <span className="grow sp-mperson-text">
                      <span className="sp-mperson-name">{p.name}</span>
                      <span className="sp-mperson-part">{p.part}</span>
                    </span>
                    <span className={`${STATUS_TAG[s]} sp-tag-edge sp-tag-${s}`}>{STATUS_LABEL[s]}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {!shownGroups.length && !nobody && <p className="sp-muted-box">Nobody here.</p>}
          {!readOnly && !nobody && (
            <button className="btn btn-dashed sp-invite-dashed" onClick={() => setOpen({ kind: "invite" })}>
              <Icon name="plus" size={18} /> Invite people
            </button>
          )}
        </main>
        {sheetPerson && !open && (
          <Sheet title={undefined} onClose={() => setSheetFor(undefined)}>
            {detail(sheetPerson, true)}
          </Sheet>
        )}
        {dialogs}
        {toast}
      </StaffShell>
    );
  }

  return (
    <StaffShell view={props.view} current="people">
      <main className="page sp-people-page">
        <div className="sp-people-main">
          <div className="page-head">
            <div>
              <h1 className="title">The company</h1>
              <p className="lede">Click anyone to see their details and conflicts.</p>
            </div>
            {!readOnly && (
              <button className="btn btn-primary" onClick={() => setOpen({ kind: "invite" })}>
                Invite people
              </button>
            )}
          </div>
          {readyCard}
          {emptyCard}
          {shownGroups.map((g) => (
            <section key={g.title} className="sp-group">
              <h2 className="sp-group-title">{g.title}</h2>
              <div className="sp-people-grid">
                {g.people.map((p) => {
                  const s = conflictStatus(p.member);
                  const isSel = sel?.member.userId === p.member.userId;
                  return (
                    <button key={p.member.userId} className="sp-pcard" aria-pressed={isSel} onClick={() => setSelected(p.member.userId)}>
                      <Avatar name={p.name} email={p.member.email} size="md" />
                      <span className="sp-pcard-text">
                        <span className="sp-pcard-name">{p.name}</span>
                        <span className="sp-pcard-part">{p.part}</span>
                        <span className={STATUS_TAG[s]}>{STATUS_LABEL[s]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {sel && (
          <aside className="sp-person-panel" aria-live="polite" aria-label="Person details">
            {detail(sel, false)}
          </aside>
        )}
      </main>
      {dialogs}
      {toast}
    </StaffShell>
  );
}
