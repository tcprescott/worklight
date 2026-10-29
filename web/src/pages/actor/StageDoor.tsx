import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api, ApiError } from "../../api";
import { time12 } from "../../lib/dates";
import { Link } from "../../router";
import type { CheckInResult } from "../../types";
import { Icon } from "../../ui";
import "./actor.css";

function arrivedAt(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Scanned from the stage door sign: /shows/:id/door?code=... Checks you in for tonight. */
export function StageDoor(props: ShowPageProps) {
  const show = props.view.show;
  const code = new URLSearchParams(location.search).get("code") ?? "";
  const [result, setResult] = useState<CheckInResult>();
  const [error, setError] = useState<string>();
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!code) return setError("This link is missing its code. Scan the sign at the stage door again.");
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.checkIn(show.showId, code));
    } catch (err) {
      setError((err as Error).message);
      // A wrong or old code won't get better by trying again; a dropped connection might.
      setRetryable(!(err instanceof ApiError) || err.status >= 500);
    } finally {
      setBusy(false);
    }
  }, [code, show.showId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const home = `/shows/${show.showId}${props.view.role === "staff" ? "/tech" : "/calls"}`;

  if (result) {
    const late = result.minutesLate > 0;
    const time = arrivedAt(result.checkin.arrivedAt, show.timezone);
    return (
      <div className={late ? "door door-late" : "door"}>
        <span className="caps">Stage door · {show.name}</span>
        <div className="door-mark" aria-hidden="true">
          <Icon name="check" size={48} strokeWidth={2.5} />
        </div>
        <h1 role="status">{late ? `Checked in, ${result.minutesLate} min late` : "You're checked in"}</h1>
        <span className="door-time">{time}</span>
        <p>
          {result.callStart
            ? late
              ? `Your call was ${time12(result.callStart)}. Stage management can see you're here.`
              : `Your call is ${time12(result.callStart)}. Stage management can see you're here.`
            : "You're not called tonight, but stage management can see you're here."}
        </p>
        <Link to={home} className="btn btn-lg door-btn">
          {props.view.role === "staff" ? "Who's in the building" : "My calls"}
        </Link>
      </div>
    );
  }

  return (
    <div className="phone-page">
      <div className="door-wait">
        <span className="caps">Stage door · {show.name}</span>
        {error ? (
          <>
            <h1>Couldn't check you in</h1>
            <p className="form-error" role="alert">
              {error}
            </p>
            <div className="door-wait-actions">
              {code && retryable && (
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void run()}>
                  {busy ? "Trying..." : "Try again"}
                </button>
              )}
              <Link to={home} className="btn btn-lg">
                {props.view.role === "staff" ? "Who's in the building" : "My calls"}
              </Link>
            </div>
            <p className="small muted">No luck? Tell the stage manager you're here and they'll check you in.</p>
          </>
        ) : (
          <h1 role="status">Checking you in...</h1>
        )}
      </div>
    </div>
  );
}
