import { useEffect, useState } from "react";
import { api } from "../../api";
import type { CalendarLinks as Links } from "../../types";
import { FormError, Loading } from "../../ui";
import "./actor.css";

/** The private calendar feed: subscribe on a phone, copy for Google or Outlook, reset if it leaks. */
export function CalendarLinks(props: { compact?: boolean }) {
  const [links, setLinks] = useState<Links>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);

  useEffect(() => {
    api
      .calendarLinks()
      .then(setLinks)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function copy() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.url);
    } catch {
      // Clipboard can be blocked; select the text so a long-press copy works.
      (document.getElementById("cal-url") as HTMLInputElement | null)?.select();
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function rotate() {
    setBusy(true);
    setError(undefined);
    try {
      setLinks(await api.rotateCalendar());
      setConfirming(false);
      setReset(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!links) return error ? <FormError error={error} /> : <Loading label="Getting your calendar link..." />;

  if (confirming)
    return (
      <div className="cal-links">
        <strong className="cal-confirm-title">Reset your calendar link?</strong>
        <p className="cal-note">
          The old link stops working right away. Any calendar subscribed to it stops getting your calls, so you'll need to
          subscribe again with the new one.
        </p>
        <FormError error={error} />
        <div className="cal-confirm-actions">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep this link
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void rotate()}>
            {busy ? "Resetting..." : "Reset link"}
          </button>
        </div>
      </div>
    );

  return (
    <div className="cal-links">
      {reset && (
        <p className="note" role="status">
          New link made. The old one no longer works. Subscribe again below.
        </p>
      )}
      <a className="btn btn-primary btn-lg btn-block" href={links.webcalUrl}>
        Subscribe in Apple or phone calendar
      </a>
      <div className="field">
        Google Calendar or Outlook
        <div className="cal-copy">
          <input id="cal-url" readOnly value={links.url} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar link" />
          <button type="button" className="btn btn-outline" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <span className="hint">
          In Google Calendar, pick Other calendars, then From URL, and paste it. In Outlook, pick Add calendar, then Subscribe
          from web.
        </span>
      </div>
      {!props.compact && (
        <p className="cal-note">New calls and changes show up on their own. Calendar apps check for updates every few hours.</p>
      )}
      <p className="cal-note">
        This link is private to you.{" "}
        <button type="button" className="link-btn cal-reset" onClick={() => setConfirming(true)}>
          Reset link
        </button>
      </p>
    </div>
  );
}

/** Downloads one call as an .ics file, which phones open straight in the calendar. */
export async function downloadCallIcs(callId: string, name: string): Promise<void> {
  const text = await api.callIcs(callId);
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "call"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
