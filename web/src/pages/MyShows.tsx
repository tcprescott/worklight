import { useState } from "react";
import { api } from "../api";
import { dateRange } from "../lib/dates";
import { Link } from "../router";
import { useSession } from "../session";
import { CompanyShell } from "../shell";
import type { MyShow } from "../types";
import { FormError, Icon } from "../ui";
import "./actor/actor.css";

const ROLE_LABEL = { staff: "Staff", cast: "Cast", crew: "Crew" } as const;

function ShowRow(props: { s: MyShow }) {
  const { s } = props;
  const archived = s.show.status === "archived";
  const tag = archived ? null : s.status === "invited" ? (
    <span className="tag">Invited</span>
  ) : s.conflictsSubmittedAt ? (
    <span className="tag tag-plum">Conflicts in</span>
  ) : (
    <span className="tag tag-soft">Send conflicts</span>
  );
  return (
    <Link to={`/shows/${s.show.showId}`} className="actor-show-row">
      <span className="grow">
        <span className="caps">{s.theaterName}</span>
        <span className="name">{s.show.name}</span>
        <span className="meta">
          {s.title ? s.title : ROLE_LABEL[s.role]} · {dateRange(s.show.startDate, s.show.endDate)}
        </span>
      </span>
      {tag}
      <Icon name="right" />
    </Link>
  );
}

function NamePrompt() {
  const { reload } = useSession();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Add your name first.");
    setSaving(true);
    setError(undefined);
    try {
      await api.updateName(name.trim());
      await reload();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }
  return (
    <form className="card stack" onSubmit={save} style={{ borderColor: "var(--plum-line)" }}>
      <label className="field">
        What's your name?
        <span className="hint">So your company sees a name, not an email address.</span>
        <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <FormError error={error} />
      <div className="actor-save-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

export function MyShows() {
  const { me } = useSession();
  const active = me.shows.filter((s) => s.show.status === "active");
  const archived = me.shows.filter((s) => s.show.status === "archived");
  const admin = me.theaters.length > 0;

  return (
    <CompanyShell>
      <main className="actor-plain">
        <h1 className="title-md">Your shows</h1>
        {!me.user.name?.trim() && <NamePrompt />}

        {active.length > 0 && (
          <div className="list">
            {active.map((s) => (
              <ShowRow key={s.show.showId} s={s} />
            ))}
          </div>
        )}

        {!active.length && !archived.length && (
          <div className="empty" style={{ alignItems: "flex-start", textAlign: "left" }}>
            <strong style={{ color: "var(--ink)", fontSize: 16 }}>You're not in any shows yet</strong>
            <span>
              When a director adds you to a show, you'll get an email from Worklight. The link in it brings you straight to the
              show. Signed in with a different address? Sign out and use the one your director has.
            </span>
            {!admin && (
              <span>
                Running a theater company? <Link to="/setup">Set up your company</Link>
              </span>
            )}
          </div>
        )}

        {!active.length && archived.length > 0 && (
          <p className="lede">You're not in any running shows. Your past shows are below.</p>
        )}

        {archived.length > 0 && (
          <details className="actor-details" open={!active.length}>
            <summary className="caps">Archived · {archived.length}</summary>
            <div className="list">
              {archived.map((s) => (
                <ShowRow key={s.show.showId} s={s} />
              ))}
            </div>
          </details>
        )}

        {admin && (
          <p className="small muted">
            <Link to={`/c/${me.theaters[0]!.theater.theaterId}`}>Go to company home</Link>
          </p>
        )}
      </main>
    </CompanyShell>
  );
}
