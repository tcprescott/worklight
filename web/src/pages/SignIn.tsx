import { useEffect, useState } from "react";
import { api } from "../api";
import { requestMagicLink, startGoogleSignIn } from "../auth";
import { getConfig } from "../config";
import { match } from "../router";
import { Wordmark } from "../shell";
import type { InvitePreview } from "../types";
import { FormError } from "../ui";
import "./actor/actor.css";

/** "added you to the cast as" / "added you to the staff as" / "added you to the crew as". */
export function invitedAs(invite: InvitePreview): string {
  const group = invite.role === "staff" ? "staff" : invite.role === "crew" ? "crew" : "cast";
  return `${invite.inviterName} added you to the ${group}${invite.part ? " as" : ""}`;
}

function inviteToken(next: string): string | undefined {
  const fromNext = match("/join/{token}", next.split("?")[0]!)?.token;
  return fromNext ?? new URLSearchParams(location.search).get("invite") ?? undefined;
}

export function SignIn(props: {
  next: string;
  heading?: string;
  /** Already-loaded invite, so the banner shows without a second fetch. */
  invite?: InvitePreview;
  /** A short line above the form, e.g. why an invite link didn't sign them in. */
  notice?: string;
}) {
  const [invite, setInvite] = useState<InvitePreview | undefined>(props.invite);
  const [email, setEmail] = useState(props.invite?.email ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "throttled">("idle");
  const [error, setError] = useState<string>();
  const { googleEnabled } = getConfig();

  useEffect(() => {
    if (props.invite) return;
    const token = inviteToken(props.next);
    if (!token) return;
    let live = true;
    api
      .previewInvite(token)
      .then((p) => {
        if (!live) return;
        setInvite(p);
        setEmail((e) => e || p.email);
      })
      .catch(() => undefined); // An expired invite just means a plain sign-in.
    return () => {
      live = false;
    };
  }, [props.next, props.invite]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setState("sending");
    try {
      setState(await requestMagicLink(email.trim().toLowerCase(), props.next));
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent" || state === "throttled") {
    return (
      <main className="actor-auth">
        <Wordmark />
        <div className="actor-center">
          <div className="actor-medallion" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <h1 className="title-md">Check your email</h1>
          <p>
            {state === "sent" ? "We sent a sign-in link to " : "A sign-in link was sent to "}
            <strong>{email.trim()}</strong>
            {state === "sent"
              ? ". Open it on this device and you're in. It works once and expires in 15 minutes."
              : " a moment ago. Use that one, or wait a minute and ask again."}
          </p>
          <button className="actor-underline" onClick={() => setState("idle")}>
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="actor-auth">
      <Wordmark />
      {invite ? (
        <div className="actor-invite">
          <span className="caps">You're invited</span>
          <span className="actor-invite-show">{invite.showName}</span>
          <span className="actor-invite-by">{invitedAs(invite)}</span>
          {invite.part && <span className="actor-part">{invite.part}</span>}
        </div>
      ) : (
        <div className="stack-sm">
          <h1 className="title-md">{props.heading ?? "Sign in to Worklight"}</h1>
          <p className="lede">Your rehearsal calls, conflicts and show notices in one place.</p>
        </div>
      )}
      {props.notice && <p className="note">{props.notice}</p>}
      <form onSubmit={submit} className="actor-auth-form">
        <label className="field">
          Your email
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary actor-btn-xl" disabled={state === "sending"}>
          {state === "sending" ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
      {googleEnabled && (
        <>
          <div className="actor-or">or</div>
          <button className="btn actor-btn-xl" onClick={() => void startGoogleSignIn(props.next)}>
            Continue with Google
          </button>
        </>
      )}
      <FormError error={error} />
      <p className="actor-foot">No password to remember. We'll send a link that signs you in.</p>
    </main>
  );
}
