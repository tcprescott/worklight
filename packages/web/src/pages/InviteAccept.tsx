import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate } from "../router";

export function InviteAccept(props: { token: string }) {
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .acceptInvite(props.token)
      .then(({ showId }) => navigate(`/shows/${showId}`, true))
      .catch((err: Error) => setError(err.message));
  }, [props.token]);

  return error ? (
    <div className="narrow">
      <h1>Couldn't join the show</h1>
      <p className="error">{error}</p>
    </div>
  ) : (
    <p>Joining the show...</p>
  );
}
