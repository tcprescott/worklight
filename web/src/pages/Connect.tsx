import { useState } from "react";
import { api } from "../api";
import { signOut } from "../auth";
import { Wordmark } from "../shell";
import type { AuthorizeRequest } from "../types";
import { FormError, Loading } from "../ui";
import { useAsync } from "../useAsync";
import "./actor/actor.css";

/** Reads what the app asked for from the address it sent the person to. */
function requestFrom(search: string): AuthorizeRequest | undefined {
  const q = new URLSearchParams(search);
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  if (!clientId || !redirectUri) return undefined;
  return {
    clientId,
    redirectUri,
    responseType: q.get("response_type") ?? "code",
    codeChallenge: q.get("code_challenge") ?? "",
    codeChallengeMethod: q.get("code_challenge_method") ?? "",
    state: q.get("state"),
    resource: q.get("resource"),
    scope: q.get("scope"),
  };
}

/**
 * /connect: an app such as Claude sends someone here to sign in with their Worklight account.
 * They're signed in by the time this shows; they say yes or no, and go back to the app.
 */
export function Connect(props: { search: string }) {
  const req = requestFrom(props.search);
  const { data, error } = useAsync(async () => (req ? Promise.all([api.connectInfo(req), api.me()]) : undefined), [props.search]);
  const [busy, setBusy] = useState<"allow" | "deny">();
  const [formError, setFormError] = useState<string>();

  const answer = async (approve: boolean) => {
    if (!req) return;
    setBusy(approve ? "allow" : "deny");
    setFormError(undefined);
    try {
      const { redirectTo } = await api.authorizeApp(req, approve);
      window.location.assign(redirectTo);
    } catch (err) {
      setFormError((err as Error).message);
      setBusy(undefined);
    }
  };

  let body;
  if (!req) {
    body = <p className="form-error">This link is missing what the app asked for. Start connecting again from the app.</p>;
  } else if (error) {
    body = <p className="form-error">{error}</p>;
  } else if (!data) {
    body = <Loading label="Checking the app..." />;
  } else {
    const [info, me] = data;
    body = (
      <>
        <div className="stack-sm">
          <h1 className="title-md">Connect {info.clientName} to Worklight?</h1>
          <p className="lede">{info.clientName} will be able to do what you can do in Worklight, as you, in every show you're in.</p>
        </div>
        <ul className="connect-list">
          <li>Read your calls, conflicts and callboard</li>
          <li>Read your own line notes, to help you run lines</li>
          <li>If you're staff or a note-taker: file line notes and make the changes you're allowed to</li>
        </ul>
        <p className="small muted">
          Signed in as <strong>{me.user.email}</strong>.{" "}
          <button
            type="button"
            className="actor-underline"
            onClick={() => {
              signOut();
              location.reload();
            }}
          >
            Not you?
          </button>
        </p>
        <div className="stack-sm">
          <button type="button" className="btn btn-primary actor-btn-xl" disabled={!!busy} onClick={() => void answer(true)}>
            {busy === "allow" ? "Connecting..." : `Allow ${info.clientName}`}
          </button>
          <button type="button" className="btn actor-btn-xl" disabled={!!busy} onClick={() => void answer(false)}>
            Cancel
          </button>
        </div>
        <FormError error={formError} />
        <p className="actor-foot">You'll go back to {info.redirectHost}. Disconnect it any time in Account.</p>
      </>
    );
  }

  return (
    <main className="actor-auth">
      <Wordmark />
      {body}
    </main>
  );
}
