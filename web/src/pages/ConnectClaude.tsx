import { useState } from "react";
import { api } from "../api";
import type { ApiKey } from "../types";
import { FormError, Loading } from "../ui";
import { useAsync } from "../useAsync";
import "./director/api-keys.css";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** Account: how to connect Claude (it signs in as you), and the apps that are connected. */
export function ConnectClaude(props: { onSaved: (message: string) => void }) {
  const { data: apps, error, reload, setData } = useAsync(() => api.myConnections(), []);
  const [formError, setFormError] = useState<string>();
  const [removing, setRemoving] = useState<string>();

  const disconnect = async (k: ApiKey) => {
    try {
      await api.disconnect(k.keyId);
      setData((apps ?? []).filter((x) => x.keyId !== k.keyId));
      props.onSaved(`Disconnected ${k.name}`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setRemoving(undefined);
    }
  };

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2 className="title-sm">Connect Claude</h2>
        <p className="small muted">
          Claude (or another assistant) can read your calls and line notes and help you run lines. It does what you can do here, as
          you.
        </p>
      </div>
      <div className="field">
        Connector address
        <code className="actor-readonly">{window.location.origin}/mcp</code>
        <span className="hint">In Claude, add a custom connector with this address. It will ask you to sign in to Worklight.</span>
      </div>

      {error ? (
        <p className="form-error">
          {error}{" "}
          <button type="button" className="btn btn-sm" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : !apps ? (
        <Loading label="Loading connected apps..." />
      ) : (
        apps.length > 0 && (
          <div className="ak-list" aria-label="Connected apps">
            {apps.map((k) => (
              <div key={k.keyId} className="ak-row">
                <span className="ak-name">
                  <span className="ak-name-text">{k.name}</span>
                </span>
                <span className="ak-meta">Connected {day(k.createdAt)}</span>
                <span className="ak-used">{k.lastUsedAt ? `Used ${day(k.lastUsedAt)}` : "Never used"}</span>
                {removing === k.keyId ? (
                  <span className="row">
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void disconnect(k)}>
                      Disconnect now
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setRemoving(undefined)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn ak-revoke" onClick={() => setRemoving(k.keyId)}>
                    Disconnect
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}
      <FormError error={formError} />
    </div>
  );
}
