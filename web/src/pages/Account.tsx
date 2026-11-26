import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { CompanyShell } from "../shell";
import { FormError, useToast } from "../ui";
import type { NotifyPrefs, PushDevice } from "../types";
import { pushSupport, thisDeviceId, turnOffPush, turnOnPush } from "../lib/push";
import { CalendarLinks } from "./actor/CalendarLinks";
import "./actor/actor.css";

export function Account() {
  const { me, reload } = useSession();
  const [name, setName] = useState(me.user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, showToast] = useToast();
  const changed = name.trim() !== (me.user.name ?? "").trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Your name can't be empty.");
    setSaving(true);
    setError(undefined);
    try {
      await api.updateName(clean);
      await reload();
      showToast("Name saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CompanyShell>
      <main className="actor-plain">
        <div className="stack-sm">
          <h1 className="title-md">Name and email</h1>
          <p className="lede">Your name is how directors and cast mates see you on cast lists and call sheets.</p>
        </div>
        <form className="card stack" onSubmit={save}>
          <label className="field">
            Your name
            <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <FormError error={error} />
          <div className="actor-save-row">
            <button type="submit" className="btn btn-primary" disabled={saving || !changed}>
              {saving ? "Saving..." : "Save name"}
            </button>
          </div>
        </form>
        <div className="card stack">
          <div className="field">
            Email
            <div className="actor-readonly">{me.user.email}</div>
            <span className="hint">
              This is the address you sign in with and where invites and reminders go. To use another address, ask your director
              to invite it.
            </span>
          </div>
        </div>
        <Notifications onSaved={showToast} />
        <div className="card stack">
          <div className="stack-sm">
            <h2 className="title-sm">Calendar</h2>
            <p className="small muted">Every call you're in, for every show, in your own calendar app. It updates on its own.</p>
          </div>
          <CalendarLinks />
        </div>
      </main>
      {toast}
    </CompanyShell>
  );
}

type Channel = "email" | "push";
const PREF_ROWS: { label: string; hint: string; email: keyof NotifyPrefs; push: keyof NotifyPrefs }[] = [
  { label: "Day-before reminders", hint: "The time, the place, and what to bring", email: "emailReminders", push: "pushReminders" },
  { label: "Schedule changes", hint: "A call you're in moves, changes, or is cancelled", email: "changeEmails", push: "pushChanges" },
  { label: "Callboard notices", hint: "Stage management posts a notice for you", email: "noticeEmails", push: "pushNotices" },
];

/** How each kind of message reaches the person: an Email and a Push column. Each box saves right away. */
function Notifications(props: { onSaved: (message: string) => void }) {
  const { me, reload } = useSession();
  const [prefs, setPrefs] = useState<NotifyPrefs>(me.user.prefs);
  const [error, setError] = useState<string>();
  const push = usePushDevices();
  const pushReady = push.devices.length > 0;

  async function toggle(id: keyof NotifyPrefs, channel: Channel) {
    const next = { ...prefs, [id]: !prefs[id] };
    setPrefs(next);
    setError(undefined);
    try {
      await api.updatePrefs(next);
      await reload();
      props.onSaved(`${channel === "email" ? "Email" : "Push"} ${next[id] ? "on" : "off"}`);
    } catch (err) {
      setPrefs(prefs);
      setError((err as Error).message);
    }
  }

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2 className="title-sm">Notifications</h2>
        <p className="small muted">
          Pick how each one reaches you. Email goes to {me.user.email}; push goes to the devices you turn it on for. Your calls are always in
          the app either way.
        </p>
      </div>
      <table className="acct-matrix">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Notification</span>
            </th>
            <th scope="col">Email</th>
            <th scope="col">Push</th>
          </tr>
        </thead>
        <tbody>
          {PREF_ROWS.map((row) => (
            <tr key={row.email}>
              <th scope="row">
                <strong>{row.label}</strong>
                <span>{row.hint}</span>
              </th>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${row.label} by email`}
                  checked={prefs[row.email]}
                  onChange={() => void toggle(row.email, "email")}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${row.label} by push`}
                  checked={pushReady && prefs[row.push]}
                  disabled={!pushReady}
                  title={pushReady ? undefined : "Turn on push for a device first"}
                  onChange={() => void toggle(row.push, "push")}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ThisDevice push={push} onSaved={props.onSaved} />
      <div className="acct-pref off">
        <span>
          <strong>
            Text messages <span className="tag tag-paid">PAID PLAN</span>
          </strong>
          <span>Only for urgent changes</span>
        </span>
        <input type="checkbox" disabled checked={false} aria-label="Text messages, paid plan" />
      </div>
      <FormError error={error} />
    </div>
  );
}

type PushDevices = {
  loaded: boolean;
  publicKey?: string | null;
  devices: PushDevice[];
  // The server's id for this browser's subscription, when it has one.
  thisId?: string;
  refresh: () => Promise<void>;
};

function usePushDevices(): PushDevices {
  const [state, setState] = useState<Omit<PushDevices, "refresh">>({ loaded: false, devices: [] });
  const refresh = useCallback(async () => {
    const [status, thisId] = await Promise.all([api.pushStatus(), thisDeviceId().catch(() => undefined)]);
    setState({ loaded: true, publicKey: status.publicKey, devices: status.devices, thisId });
  }, []);
  useEffect(() => {
    refresh().catch(() => setState((s) => ({ ...s, loaded: true })));
  }, [refresh]);
  return { ...state, refresh };
}

/** Turning push on or off for the phone or computer in hand, plus the person's other devices. */
function ThisDevice(props: { push: PushDevices; onSaved: (message: string) => void }) {
  const { push } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const support = pushSupport();
  const mine = push.devices.find((d) => d.deviceId === push.thisId);
  const others = push.devices.filter((d) => d !== mine);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      props.onSaved(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      // Even after a failure: a test to an ended subscription removes the device on the server.
      await push.refresh().catch(() => undefined);
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (!push.loaded) body = <span className="muted">Checking...</span>;
  else if (!push.publicKey) body = <span className="muted">Push notifications aren't switched on for Worklight yet.</span>;
  else if (support === "ios-needs-install")
    body = (
      <p className="acct-device-note">
        On iPhone and iPad, push works once Worklight is on your Home Screen. In Safari, tap Share, then <strong>Add to Home Screen</strong>,
        open Worklight from there, and come back to this page.
      </p>
    );
  else if (support === "unsupported") body = <span className="muted">This browser can't show push notifications. Try Chrome, Edge, Firefox, or Safari.</span>;
  else if (mine)
    body = (
      <>
        <span className="acct-device-on">Push is on for this device ({mine.label ?? "this browser"})</span>
        <div className="acct-device-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => void run(async () => {
              const res = await api.testPush(mine.deviceId);
              if (!res.sent) throw new Error("The test didn't go through. Turn push on for this device again and retry.");
            }, "Test sent")}
          >
            Send a test
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run(() => turnOffPush(mine.deviceId), "Push off for this device")}>
            Turn off
          </button>
        </div>
      </>
    );
  else if (Notification.permission === "denied")
    body = <span className="muted">Notifications are blocked for Worklight in this browser. Allow them in the site settings, then reload.</span>;
  else
    body = (
      <>
        <span className="muted">Not turned on for this device yet.</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void run(() => turnOnPush(push.publicKey!), "Push on for this device")}
        >
          {busy ? "Turning on..." : "Turn on for this device"}
        </button>
      </>
    );

  return (
    <div className="acct-device">
      <span className="acct-device-k">This device</span>
      {body}
      {others.length > 0 && (
        <div className="acct-device-others">
          <span className="acct-device-k">Also getting push</span>
          {others.map((d) => (
            <div key={d.deviceId} className="acct-device-row">
              <span>{d.label ?? "A device"}</span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() => void run(() => api.removePushDevice(d.deviceId), "Device removed")}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <FormError error={error} />
    </div>
  );
}
