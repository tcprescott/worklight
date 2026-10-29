import { useState } from "react";
import { api } from "../../api";
import { dateRange, todayIso } from "../../lib/dates";
import { Link, useLocation } from "../../router";
import { useSession } from "../../session";
import { CompanyShell } from "../../shell";
import type { Admin, Member, ShowSummary, TheaterView } from "../../types";
import { Avatar, Dialog, ErrorView, FormError, Loading, useToast } from "../../ui";
import { useAsync } from "../../useAsync";
import "./company.css";
import { ADMIN_SENTENCE, departmentFor, isStageManager, roleSentence, STAFF_ROLES, validEmail } from "./setup-parts";

const ADMIN = "admin";

export function Staff(props: { theaterId: string }) {
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
  return <StaffPage view={data} reload={async () => void (await reload())} setView={setData} />;
}

/** "Opens Dec 4" before opening, else the run "Dec 18–20". */
function whenShort(s: ShowSummary): string {
  const open = s.show.openingDate ?? s.show.startDate;
  return dateRange(open, s.show.endDate, false);
}

function StaffPage(props: { view: TheaterView; reload: () => Promise<void>; setView: (v: TheaterView) => void }) {
  const { me } = useSession();
  const { search } = useLocation();
  const { view } = props;
  const theaterId = view.theater.theaterId;
  const today = todayIso();
  const closed = (s: ShowSummary) => s.show.endDate < today;
  const active = view.shows
    .filter((s) => s.show.status === "active")
    .sort((a, b) => Number(closed(a)) - Number(closed(b)) || a.show.startDate.localeCompare(b.show.startDate));
  const [toast, showToast] = useToast();
  const [inviting, setInviting] = useState<string | undefined>(() => {
    const wanted = new URLSearchParams(search).get("invite");
    return wanted && active.some((s) => s.show.showId === wanted) ? wanted : undefined;
  });
  const [removing, setRemoving] = useState<Admin>();
  const [busy, setBusy] = useState<string>();

  const resend = async (s: ShowSummary, m: Member) => {
    setBusy(m.userId + s.show.showId);
    try {
      const r = await api.remind(s.show.showId, [m.userId]);
      showToast(r.invitesResent ? `Invite sent again to ${m.name || m.email}.` : "Nothing to resend.");
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  // A company always keeps one admin.
  const canRemove = view.admins.length > 1;

  return (
    <CompanyShell context={view.theater.name}>
      <main className="co-page">
        <div className="co-staff-head">
          <Link to={`/c/${theaterId}`} className="co-back">
            ← Company home
          </Link>
          <h1>Staff and admins</h1>
          <button type="button" className="btn btn-primary" onClick={() => setInviting(active.find((s) => !closed(s))?.show.showId ?? ADMIN)}>
            + Invite someone
          </button>
        </div>

        <div className="co-staff-grid">
          <section className="co-staff-card" aria-label="Company admins">
            <div className="co-staff-card-head">
              <h2>Company admins</h2>
            </div>
            <span className="desc">See every show, add shows, and manage staff. Usually board or artistic director.</span>
            {[...view.admins].sort((a, b) => Number(b.userId === me.user.userId) - Number(a.userId === me.user.userId)).map((a) => (
              <div key={a.userId} className="co-staff-person">
                <Avatar name={a.name} email={a.email} />
                <span className="co-person-text">
                  <span className="co-person-name">{a.name || a.email}</span>
                  <span className="co-person-sub">{[a.title || "Company admin", a.userId === me.user.userId ? "you" : ""].filter(Boolean).join(" · ")}</span>
                </span>
                {canRemove && (
                  <button type="button" className="btn" onClick={() => setRemoving(a)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-dashed" onClick={() => setInviting(ADMIN)}>
              + Add an admin
            </button>
          </section>

          {active.map((s) => (
            <section key={s.show.showId} className="co-staff-card" aria-label={s.show.name}>
              <div className="co-staff-card-head">
                <h2>{s.show.name}</h2>
                <span className="when">{closed(s) ? `Closed ${whenShort(s)}` : whenShort(s)}</span>
              </div>
              <span className="desc">Show staff run this show only.</span>
              {s.staff.map((m) => (
                <div key={m.userId} className="co-staff-person">
                  <Avatar name={m.name} email={m.email} />
                  <span className="co-person-text">
                    <span className="co-person-name">{m.name || m.email}</span>
                    <span className="co-person-sub">
                      {[m.title || "Staff", m.userId === me.user.userId ? "you" : "", m.status === "invited" ? "Invite sent" : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {m.status === "invited" && (
                    <button type="button" className="btn" disabled={busy === m.userId + s.show.showId} onClick={() => void resend(s, m)}>
                      {busy === m.userId + s.show.showId ? "Sending..." : "Resend"}
                    </button>
                  )}
                </div>
              ))}
              {!closed(s) && !s.staff.some((m) => isStageManager(m.title)) && <span className="co-warn">No stage manager yet</span>}
              <button type="button" className="btn btn-dashed" onClick={() => setInviting(s.show.showId)}>
                + Add to this show
              </button>
            </section>
          ))}
        </div>
        {active.length === 0 && (
          <p className="co-hint" style={{ marginTop: 16 }}>
            No active shows. <Link to={`/c/${theaterId}/new-show`}>Add a show</Link> to invite its staff.
          </p>
        )}
      </main>

      {inviting && (
        <InviteDialog
          view={view}
          initialWhere={inviting}
          onClose={() => setInviting(undefined)}
          onSent={async (message) => {
            setInviting(undefined);
            showToast(message);
            await props.reload();
          }}
          onAdmins={(admins) => props.setView({ ...view, admins })}
        />
      )}
      {removing && (
        <RemoveAdminDialog
          admin={removing}
          isMe={removing.userId === me.user.userId}
          onCancel={() => setRemoving(undefined)}
          onConfirm={async () => {
            const admins = await api.removeAdmin(theaterId, removing.userId);
            props.setView({ ...view, admins });
            setRemoving(undefined);
            showToast(`${removing.name || removing.email} is no longer an admin.`);
          }}
        />
      )}
      {toast}
    </CompanyShell>
  );
}

function InviteDialog(props: {
  view: TheaterView;
  initialWhere: string;
  onClose: () => void;
  onSent: (message: string) => Promise<void>;
  onAdmins: (admins: Admin[]) => void;
}) {
  // Closed shows only appear when someone chose "Add to this show" on one.
  const today = todayIso();
  const active = props.view.shows
    .filter((s) => s.show.status === "active" && (s.show.endDate >= today || s.show.showId === props.initialWhere))
    .sort((a, b) => a.show.startDate.localeCompare(b.show.startDate));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [where, setWhere] = useState(props.initialWhere);
  const [title, setTitle] = useState<string>(() => {
    const show = active.find((s) => s.show.showId === props.initialWhere);
    return show && show.staff.some((m) => isStageManager(m.title)) ? "Assistant director" : "Stage manager";
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isAdmin = where === ADMIN;
  const show = active.find((s) => s.show.showId === where);
  const ok = validEmail(email);

  const send = async () => {
    if (!ok) return setError("Add a valid email address.");
    setBusy(true);
    setError(undefined);
    try {
      const who = name.trim() || email.trim();
      if (isAdmin) {
        const admins = await api.addAdmin(props.view.theater.theaterId, { email: email.trim(), name: name.trim() || undefined });
        props.onAdmins(admins);
        await props.onSent(`${who} is now a company admin.`);
      } else {
        await api.invite(where, {
          email: email.trim(),
          name: name.trim() || null,
          role: "staff",
          title,
          department: departmentFor(title),
          characterIds: [],
        });
        await props.onSent(`Invite sent to ${who}.`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Invite someone" onClose={props.onClose}>
      <form
        className="stack"
        style={{ gap: 14 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void send();
        }}
      >
        <div className="form-grid">
          <label className="field">
            Email
            <input type="email" value={email} placeholder="name@example.com" autoFocus autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Name
            <input type="text" value={name} maxLength={100} placeholder="Their name" onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="stack-sm">
          <span className="co-label">Where</span>
          <div className="chips" role="group" aria-label="Where">
            {active.map((s) => (
              <button key={s.show.showId} type="button" className="co-pill" aria-pressed={where === s.show.showId} onClick={() => setWhere(s.show.showId)}>
                {s.show.name}
              </button>
            ))}
            <button type="button" className="co-pill" aria-pressed={isAdmin} onClick={() => setWhere(ADMIN)}>
              Company admin (all shows)
            </button>
          </div>
        </div>
        {!isAdmin && (
          <div className="stack-sm">
            <span className="co-label">Role on the show</span>
            <div className="chips" role="group" aria-label="Role on the show">
              {STAFF_ROLES.map((t) => (
                <button key={t} type="button" className="co-pill" aria-pressed={title === t} onClick={() => setTitle(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="note">{isAdmin ? ADMIN_SENTENCE : roleSentence(title, show?.show.name ?? "this show")}</div>
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !ok}>
            {busy ? "Sending..." : isAdmin ? "Add admin" : "Send invite"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveAdminDialog(props: { admin: Admin; isMe: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const who = props.admin.name || props.admin.email;
  return (
    <Dialog title={props.isMe ? "Remove yourself as admin?" : `Remove ${who}?`} onClose={props.onCancel}>
      <p className="lede">
        {props.isMe
          ? "You will lose company home and every show you are not on yourself. Another admin can add you back."
          : `${who} will no longer see company home or shows they are not on. Shows they run keep them as staff.`}
      </p>
      <FormError error={error} />
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onConfirm();
              if (props.isMe) location.assign("/");
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Removing..." : "Remove admin"}
        </button>
      </div>
    </Dialog>
  );
}
