import { useState } from "react";
import type { Theater } from "@call-time/shared";
import { api } from "../api";
import { Link, navigate } from "../router";
import { useAsync } from "../useAsync";

const roleLabel = { staff: "Staff", cast: "Cast", crew: "Crew" } as const;

export function Home() {
  const { data: me, error, loading, reload } = useAsync(() => api.me(), []);

  if (loading && !me) return <p>Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!me) return null;

  return (
    <div className="stack-lg">
      {!me.user.name && <NamePrompt onSaved={reload} />}

      <section>
        <h1>Your shows</h1>
        {me.shows.length === 0 ? (
          <p className="muted">
            You're not in any shows yet. Open the invite link from your director, or create a theater below to run one.
          </p>
        ) : (
          <ul className="cards">
            {me.shows.map(({ show, role, title }) => (
              <li key={show.showId}>
                <Link to={`/shows/${show.showId}`} className="card">
                  <strong>{show.name}</strong>
                  <span className="muted">
                    {title ?? roleLabel[role]} · {show.startDate} to {show.endDate}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {me.theaters.map(({ theater }) => (
        <NewShow key={theater.theaterId} theater={theater} />
      ))}
      <NewTheater onCreated={reload} />
    </div>
  );
}

function NamePrompt(props: { onSaved: () => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="notice stack"
      onSubmit={async (e) => {
        e.preventDefault();
        await api.updateName(name.trim());
        props.onSaved();
      }}
    >
      <label>
        What name should your director see?
        <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Save</button>
    </form>
  );
}

function NewTheater(props: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        Running a show? Set up your theater
      </button>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.createTheater(name.trim());
          setOpen(false);
          setName("");
          props.onCreated();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2>New theater</h2>
      <label>
        Theater or company name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Create theater</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function NewShow(props: { theater: Theater }) {
  const [form, setForm] = useState({
    name: "",
    venue: "",
    startDate: "",
    endDate: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [error, setError] = useState<string>();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <section>
      <h2>New show at {props.theater.name}</h2>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(undefined);
          try {
            const show = await api.createShow(props.theater.theaterId, {
              ...form,
              venue: form.venue || undefined,
            });
            navigate(`/shows/${show.showId}`);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Show name
          <input required value={form.name} onChange={set("name")} />
        </label>
        <label>
          Venue <span className="muted">(optional)</span>
          <input value={form.venue} onChange={set("venue")} />
        </label>
        <div className="row">
          <label>
            First rehearsal
            <input type="date" required value={form.startDate} onChange={set("startDate")} />
          </label>
          <label>
            Closing night
            <input type="date" required value={form.endDate} onChange={set("endDate")} />
          </label>
        </div>
        <label>
          Timezone
          <input required value={form.timezone} onChange={set("timezone")} />
        </label>
        <button type="submit">Create show</button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
