import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../api";
import { isSignedIn, signedInEmail, signInWithInvite, signOut } from "../../auth";
import { longDate, time12 } from "../../lib/dates";
import { firstName } from "../../lib/people";
import { navigate } from "../../router";
import { Wordmark } from "../../shell";
import type { InvitePreview, Me, ShowDay, ShowView } from "../../types";
import { FormError } from "../../ui";
import { SignIn } from "../SignIn";
import { CalendarLinks } from "./CalendarLinks";
import "./actor.css";

type Phase =
  | { kind: "loading" }
  | { kind: "fallback"; notice: string; invite?: InvitePreview }
  | { kind: "used" }
  | { kind: "wrong"; invite: InvitePreview; signedAs: string }
  | { kind: "error"; message: string }
  | { kind: "confirm" | "prefs"; data: Joined };

interface Joined {
  invite: InvitePreview;
  me: Me;
  view: ShowView;
  first?: ShowDay;
  viaLink: boolean;
}

/** Lower-cases a title for mid-sentence use, leaving acronyms like "ASM" alone. */
const midSentence = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t);

/** "You're playing Hermia in ..." / "You're the stage manager on ..." */
function roleLine(invite: InvitePreview): ReactNode {
  const where = (
    <>
      {invite.showName}
      {invite.theaterName ? ` with ${invite.theaterName}` : ""}.
    </>
  );
  const part = invite.part?.trim();
  if (invite.role === "staff") {
    return part ? (
      <>
        You're the <strong>{midSentence(part)}</strong> on {where}
      </>
    ) : (
      <>You're on the staff of {where}</>
    );
  }
  if (invite.role === "crew") {
    return part ? (
      <>
        You're on the <strong>{part}</strong> crew for {where}
      </>
    ) : (
      <>You're on the crew for {where}</>
    );
  }
  return part ? (
    <>
      You're playing <strong>{part}</strong> in {where}
    </>
  ) : (
    <>You're in the cast of {where}</>
  );
}

export function Join(props: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase({ kind: "loading" });
    let invite: InvitePreview;
    try {
      invite = await api.previewInvite(props.token);
    } catch {
      if (isSignedIn()) setPhase({ kind: "used" });
      else
        setPhase({
          kind: "fallback",
          notice: "This invite link has expired or was already used. Sign in with your email and you'll find the show waiting.",
        });
      return;
    }

    let viaLink = false;
    if (!isSignedIn()) {
      try {
        await signInWithInvite(invite.email, props.token);
        viaLink = true;
      } catch {
        setPhase({
          kind: "fallback",
          invite,
          notice: "This link couldn't sign you in on its own. We'll email you a fresh sign-in link instead.",
        });
        return;
      }
    } else {
      const current = (signedInEmail() ?? "").toLowerCase();
      if (current && current !== invite.email.toLowerCase()) {
        setPhase({ kind: "wrong", invite, signedAs: current });
        return;
      }
    }

    try {
      const accepted = await api.acceptInvite(props.token);
      const [me, view, days] = await Promise.all([
        api.me(),
        api.show(accepted.showId),
        api.myDays().catch(() => [] as ShowDay[]),
      ]);
      const first = days.find((d) => d.showId === accepted.showId && d.kind === "rehearsal");
      setPhase({ kind: "confirm", data: { invite, me, view, first, viaLink } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase({ kind: "wrong", invite, signedAs: signedInEmail() ?? "another account" });
      } else {
        setPhase({ kind: "error", message: (err as Error).message });
      }
    }
  }, [props.token]);

  useEffect(() => {
    // StrictMode runs effects twice in dev; an invite can only be accepted once.
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  switch (phase.kind) {
    case "loading":
      return (
        <main className="actor-auth">
          <Wordmark />
          <div className="actor-center">
            <p role="status">Opening your invite...</p>
          </div>
        </main>
      );
    case "fallback":
      return <SignIn next={phase.invite ? `/join/${props.token}` : "/"} invite={phase.invite} notice={phase.notice} />;
    case "used":
      return (
        <Plain title="This invite was already used">
          <p>It may have been you, on this device or another one. Your shows are waiting.</p>
          <button className="btn btn-primary actor-btn-xl" onClick={() => navigate("/", true)}>
            Go to my shows
          </button>
        </Plain>
      );
    case "error":
      return (
        <Plain title="Couldn't open this invite">
          <FormError error={phase.message} />
          <button className="btn btn-primary actor-btn-xl" onClick={() => void run()}>
            Try again
          </button>
        </Plain>
      );
    case "wrong":
      return (
        <Plain title={`This invite is for ${phase.invite.email}`}>
          <p>
            You're signed in as <strong>{phase.signedAs}</strong>. Sign out to join {phase.invite.showName} as{" "}
            {phase.invite.email}.
          </p>
          <button
            className="btn btn-primary actor-btn-xl"
            onClick={() => {
              signOut();
              void run();
            }}
          >
            Sign out and join
          </button>
          <button className="actor-underline" onClick={() => navigate("/", true)}>
            Stay signed in as {phase.signedAs}
          </button>
        </Plain>
      );
    case "confirm":
      return <Confirm data={phase.data} onNext={(data) => setPhase({ kind: "prefs", data })} />;
    case "prefs":
      return <Prefs showId={phase.data.view.show.showId} me={phase.data.me} />;
  }
}

function Plain(props: { title: string; children: ReactNode }) {
  return (
    <main className="actor-auth">
      <Wordmark />
      <div className="stack" style={{ marginTop: 24 }}>
        <h1 className="title-md" style={{ overflowWrap: "anywhere" }}>
          {props.title}
        </h1>
        <div className="stack" style={{ fontSize: 15, color: "var(--ink-2)" }}>
          {props.children}
        </div>
      </div>
    </main>
  );
}

function Confirm(props: { data: Joined; onNext: (data: Joined) => void }) {
  const { invite, me, view, first, viaLink } = props.data;
  const needsName = !me.user.name?.trim();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const first_ = firstName(me.user.name);
  const inviter = firstName(invite.inviterName) || invite.inviterName;
  const show = view.show;
  const isFirst = first && first.date === show.startDate;

  async function next() {
    if (!needsName) return props.onNext(props.data);
    const clean = name.trim();
    if (!clean) return setError("Add your name so the company knows who you are.");
    setSaving(true);
    setError(undefined);
    try {
      const user = await api.updateName(clean);
      props.onNext({ ...props.data, me: { ...me, user } });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <main className="actor-join">
      <div className="actor-join-head">
        <span className="caps">Welcome to the company</span>
        <h1>{first_ ? `Hi, ${first_}.` : "You're in."}</h1>
        <p>{roleLine(invite)}</p>
      </div>
      <div className="actor-join-body">
        <p>
          {viaLink
            ? `You tapped the link in ${inviter}'s invite, so you're already signed in. No password, no code.`
            : `You're signed in as ${me.user.email}.`}
        </p>
        {first && (
          <div className="actor-fact">
            <span className="caps">{isFirst ? "First rehearsal" : "Next rehearsal"}</span>
            <strong>
              {longDate(first.date)}
              {first.start ? ` · ${time12(first.start)}` : ""}
            </strong>
            {show.venue && <span>At {show.venue}</span>}
          </div>
        )}
        {needsName && (
          <label className="field">
            Your name
            <span className="hint">How it appears on the cast list and call sheets.</span>
            <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <FormError error={error} />
        <button className="btn btn-primary actor-btn-xl actor-push" disabled={saving} onClick={() => void next()}>
          {saving ? "Saving..." : needsName ? "Continue" : "That's me, let's go"}
        </button>
        <button
          className="actor-underline"
          onClick={() => {
            signOut();
            navigate("/sign-in", true);
          }}
        >
          {first_ ? `Not ${first_}? Sign out` : `Not ${me.user.email}? Sign out`}
        </button>
      </div>
    </main>
  );
}

type PrefId = "email" | "cal" | "push" | "sms";
const PREFS: { id: PrefId; label: string; hint: string; paid?: boolean; later?: string }[] = [
  { id: "email", label: "Email", hint: "A reminder the day before you're called" },
  { id: "cal", label: "Add to my calendar", hint: "Rehearsals show up in your phone calendar" },
  { id: "push", label: "Phone notifications", hint: "A nudge the day before you're called", later: "Coming with the app" },
  { id: "sms", label: "Text messages", hint: "Only for urgent changes", paid: true },
];

function Prefs(props: { showId: string; me: Me }) {
  const [on, setOn] = useState<Record<PrefId, boolean>>({
    email: props.me.user.prefs.emailReminders,
    cal: true,
    push: false,
    sms: false,
  });
  const [step, setStep] = useState<"pick" | "calendar">("pick");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const toConflicts = () => navigate(`/shows/${props.showId}/setup`, true);

  async function next() {
    setSaving(true);
    setError(undefined);
    try {
      if (on.email !== props.me.user.prefs.emailReminders) {
        await api.updatePrefs({ ...props.me.user.prefs, emailReminders: on.email });
      }
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
      return;
    }
    setSaving(false);
    if (on.cal) setStep("calendar");
    else toConflicts();
  }

  if (step === "calendar")
    return (
      <main className="actor-join">
        <div className="actor-prefs">
          <h1 className="title-md" style={{ fontSize: 30 }}>
            Put your calls in your calendar
          </h1>
          <p className="lede">One private link with every call you're in. New calls and changes show up on their own.</p>
          <CalendarLinks compact />
          <button type="button" className="btn btn-primary actor-btn-xl actor-push" onClick={toConflicts}>
            Next: your conflicts
          </button>
          <button type="button" className="actor-underline" onClick={toConflicts}>
            Skip for now
          </button>
        </div>
      </main>
    );

  return (
    <main className="actor-join">
      <div className="actor-prefs">
        <h1 className="title-md" style={{ fontSize: 30 }}>
          How should we remind you?
        </h1>
        <p className="lede">Pick as many as you like. You can change these later in your account.</p>
        {PREFS.map((p) => {
          const off = !!p.paid || !!p.later;
          return (
            <label key={p.id} className={off ? "actor-pref off" : on[p.id] ? "actor-pref on" : "actor-pref"}>
              <span className="actor-pref-text">
                <strong>
                  {p.label}
                  {p.paid && <span className="tag tag-paid">PAID PLAN</span>}
                </strong>
                <span>{p.later ? `${p.hint}. ${p.later}.` : p.hint}</span>
              </span>
              <input
                type="checkbox"
                checked={!off && on[p.id]}
                disabled={off}
                onChange={() => setOn({ ...on, [p.id]: !on[p.id] })}
              />
            </label>
          );
        })}
        <FormError error={error} />
        <button className="btn btn-primary actor-btn-xl actor-push" disabled={saving} onClick={() => void next()}>
          {saving ? "Saving..." : on.cal ? "Next: your calendar" : "Next: your conflicts"}
        </button>
      </div>
    </main>
  );
}
