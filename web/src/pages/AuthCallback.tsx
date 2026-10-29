import { useEffect, useRef, useState } from "react";
import { finishGoogleSignIn } from "../auth";
import { navigate } from "../router";

export function AuthCallback() {
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    finishGoogleSignIn(new URLSearchParams(location.search))
      .then((next) => navigate(next.startsWith("/") && !next.startsWith("//") ? next : "/", true))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="page narrow">
      {error ? (
        <>
          <p className="error">{error}</p>
          <a href="/">Back to sign in</a>
        </>
      ) : (
        <p>Signing you in...</p>
      )}
    </main>
  );
}
