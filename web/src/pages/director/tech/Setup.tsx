import { useState } from "react";
import { api } from "../../../api";
import { dateRange } from "../../../lib/dates";
import { Link } from "../../../router";
import type { ShowView } from "../../../types";
import { FormError } from "../../../ui";

/** Nothing published yet. */
export function NoCalls(props: { view: ShowView; readOnly: boolean; onMade: (n: number) => Promise<void> }) {
  const show = props.view.show;
  return (
    <main className="page tech-setup-page">
      <div className="tech-head">
        <span className="kicker">Attendance</span>
        <h1 className="title">Who's here</h1>
        <p className="lede">
          Once calls are published, people tap "I'm here" on their phone when they arrive, and anything they tell you ahead of
          time shows up here.
        </p>
      </div>
      {props.readOnly ? (
        <div className="tech-setup">
          <h2 className="title-sm">No calls</h2>
          <p className="lede">This show never published a call.</p>
        </div>
      ) : (
        <div className="tech-setup">
          <h2 className="title-sm">No calls published yet</h2>
          <p className="lede">Publish a week on the Schedule and it shows up here.</p>
          <Link to={`/shows/${show.showId}/schedule`} className="btn btn-outline">
            Open the Schedule
          </Link>
        </div>
      )}
      {!props.readOnly && show.techStart && <TechCallsForm view={props.view} onMade={props.onMade} />}
    </main>
  );
}

/** No tech calls yet: call everyone for every tech night and performance in one go. */
export function TechCallsForm(props: { view: ShowView; onMade: (n: number) => Promise<void> }) {
  const show = props.view.show;
  const [cast, setCast] = useState("18:00");
  const [crew, setCrew] = useState("17:30");
  const [end, setEnd] = useState("22:00");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!show.techStart) return null;

  async function make() {
    setError(undefined);
    if (!cast || !end) return setError("Add a cast call time and an end time.");
    if (end <= cast) return setError("The end has to be after the cast call.");
    if (crew && crew > cast) return setError("Crew call is usually before cast call. Leave it blank to call crew with cast.");
    setBusy(true);
    try {
      const made = await api.createTechCalls(show.showId, { start: cast, end, crewStart: crew || null, location: where.trim() || null });
      if (!made.length) setError("There were no tech nights or performances without a call.");
      else await props.onMade(made.length);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="tech-setup"
      onSubmit={(e) => {
        e.preventDefault();
        void make();
      }}
    >
      <h2 className="title-sm">Call everyone for tech week</h2>
      <p className="lede">
        Everyone is called every tech night and performance, {dateRange(show.techStart, show.endDate, false)}. You can change any
        night on the Schedule afterwards.
      </p>
      <div className="tech-setup-fields">
        <label className="field">
          Cast call
          <input type="time" value={cast} onChange={(e) => setCast(e.target.value)} required />
        </label>
        <label className="field">
          Crew call
          <input type="time" value={crew} onChange={(e) => setCrew(e.target.value)} />
        </label>
        <label className="field">
          Ends
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className="field tech-setup-where">
          Where
          <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder={show.venue ?? "The theater"} maxLength={200} />
        </label>
      </div>
      <FormError error={error} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Calling everyone..." : "Call everyone"}
        </button>
      </div>
    </form>
  );
}

/** Tech calls made but not published: nobody sees them yet. */
export function DraftBanner(props: { view: ShowView; count: number; onPublished: (n: number) => Promise<void> }) {
  const show = props.view.show;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="tech-draft" role="status">
      <div className="tech-draft-text">
        <strong>
          {props.count} tech call{props.count === 1 ? " is a draft" : "s are drafts"}.
        </strong>{" "}
        Nobody sees {props.count === 1 ? "it" : "them"} or gets a reminder until you publish. You can also publish from the{" "}
        <Link to={`/shows/${show.showId}/schedule`}>Schedule</Link>.
        <FormError error={error} />
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const r = await api.publish(show.showId, show.techStart!, show.endDate);
            await props.onPublished(r.published);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Publishing..." : "Publish tech week"}
      </button>
    </div>
  );
}
