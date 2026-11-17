import { useEffect, useRef, useState } from "react";
import { finishGoogleSignIn } from "../auth";
import { navigate } from "../router";
import { AuthStatus } from "./MagicLink";

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

  return <AuthStatus error={error} />;
}
