import { useState } from "react";
import { api } from "../../../api";
import { dateRange } from "../../../lib/dates";
import { Link } from "../../../router";
import type { ShowView } from "../../../types";
import { FormError } from "../../../ui";

/** No tech calls yet: call everyone for every tech night and performance in one go. */
export function NoTechCalls(props: { view: ShowView; readOnly: boolean; onMade: (n: number) => Promise<void> }) {
  const show = props.view.show;
  const [cast, setCast] = useState("18:00");
  const [crew, setCrew] = useState("17:30");
  const [end, setEnd] = useState("22:00");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
    <main className="page tech-setup-page">
      <div className="tech-head">
        <span className="kicker">Tech week</span>
        <h1 className="title">Who's in the building</h1>
        <p className="lede">Once tech calls are out, people check in here by scanning a code at the stage door.</p>
      </div>
      {!show.techStart ? (
        <div className="tech-setup">
          <h2 className="title-sm">Tech week isn't on the calendar</h2>
          <p className="lede">Set when tech week starts in the show settings, then come back here to call everyone.</p>
          {!props.readOnly && (
            <Link to={`/shows/${show.showId}/settings`} className="btn btn-outline">
              Open show settings
            </Link>
          )}
        </div>
      ) : props.readOnly ? (
        <div className="tech-setup">
          <h2 className="title-sm">No tech calls</h2>
          <p className="lede">This show never called tech week.</p>
        </div>
      ) : (
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
      )}
    </main>
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
