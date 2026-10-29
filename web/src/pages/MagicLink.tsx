import { useEffect, useRef, useState } from "react";
import { redeemMagicLink } from "../auth";
import { navigate } from "../router";

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function MagicLink() {
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev; a link can only be redeemed once.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    const email = params.get("email");
    const code = params.get("code");
    if (!email || !code) {
      setError("This sign-in link is incomplete. Request a new one.");
      return;
    }
    redeemMagicLink(email, code)
      .then(() => navigate(safeNext(params.get("next")), true))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="page narrow">
      {error ? (
        <>
          <h1>Couldn't sign you in</h1>
          <p className="error">{error}</p>
          <a href="/">Back to sign in</a>
        </>
      ) : (
        <p>Signing you in...</p>
      )}
    </main>
  );
}
