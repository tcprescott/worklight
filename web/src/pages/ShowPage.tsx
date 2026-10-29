import { useState } from "react";
import { SHOW_ROLES, canOnShow } from "../roles";
import type { ShowRole } from "../types";
import { api } from "../api";
import { useAsync } from "../useAsync";

const roleLabel: Record<ShowRole, string> = { staff: "Staff", cast: "Cast", crew: "Crew" };

export function ShowPage(props: { showId: string }) {
  const show = useAsync(() => api.show(props.showId), [props.showId]);
  const members = useAsync(() => api.members(props.showId), [props.showId]);

  if (show.loading && !show.data) return <p>Loading...</p>;
  if (show.error) return <p className="error">{show.error}</p>;
  if (!show.data) return null;
  const { show: s, role } = show.data;

  return (
    <div className="stack-lg">
      <section>
        <h1>{s.name}</h1>
        <p className="muted">
          {s.venue ? `${s.venue} · ` : ""}
          {s.startDate} to {s.endDate} · {s.timezone}
        </p>
      </section>

      <section>
        <h2>Company</h2>
        {members.error && <p className="error">{members.error}</p>}
        {SHOW_ROLES.map((r) => {
          const people = (members.data ?? []).filter((m) => m.role === r);
          if (people.length === 0) return null;
          return (
            <div key={r}>
              <h3>{roleLabel[r]}</h3>
              <ul className="people">
                {people.map((m) => (
                  <li key={m.userId}>
                    <span>{m.name ?? m.email ?? "Invited member"}</span>
                    {m.title && <span className="muted"> · {m.title}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {canOnShow(role, "members:invite") && <InviteForm showId={s.showId} onSent={members.reload} />}
    </div>
  );
}

function InviteForm(props: { showId: string; onSent: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShowRole>("cast");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  return (
    <section>
      <h2>Invite someone</h2>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(undefined);
          try {
            await api.invite(props.showId, { email: email.trim(), role, title: title.trim() || undefined });
            setStatus(`Invite sent to ${email.trim()}.`);
            setEmail("");
            setTitle("");
            props.onSent();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="row">
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as ShowRole)}>
              {SHOW_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title <span className="muted">(optional)</span>
            <input
              placeholder={role === "staff" ? "Stage manager" : role === "crew" ? "Lights" : ""}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        </div>
        <button type="submit">Send invite</button>
        {status && <p className="success">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
