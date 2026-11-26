import { useState } from "react";
import { api } from "../api";
import type { ApiKey } from "../types";
import { FormError, Loading } from "../ui";
import { useAsync } from "../useAsync";
import { SecretReveal } from "./director/ApiKeys";
import "./director/api-keys.css";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** Account: read-only keys of your own, so an assistant like Claude can read your calls and line notes. */
export function PersonalKeys(props: { onSaved: (message: string) => void }) {
  const { data: keys, error, reload, setData } = useAsync(() => api.myApiKeys(), []);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [made, setMade] = useState<{ name: string; secret: string }>();
  const [revoking, setRevoking] = useState<string>();
  const origin = window.location.origin;

  const create = async () => {
    const clean = name.trim() || "Claude";
    setBusy(true);
    setFormError(undefined);
    try {
      const result = await api.createMyApiKey(clean);
      setData([...(keys ?? []), result.key]);
      setMade({ name: clean, secret: result.secret });
      setName("");
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    try {
      await api.revokeMyApiKey(k.keyId);
      setData((keys ?? []).filter((x) => x.keyId !== k.keyId));
      props.onSaved(`Revoked ${k.name}`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setRevoking(undefined);
    }
  };

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2 className="title-sm">Connect Claude</h2>
        <p className="small muted">
          Make a key so Claude (or another assistant) can read your calls and your line notes, and help you run lines. It can only read,
          and only what you can see here.
        </p>
      </div>
      <div className="field">
        MCP address
        <code className="actor-readonly">{origin}/mcp</code>
        <span className="hint">Add it as a connector and send the key as Authorization: Bearer wl_…</span>
      </div>

      {error ? (
        <p className="form-error">
          {error}{" "}
          <button type="button" className="btn btn-sm" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : !keys ? (
        <Loading label="Loading keys..." />
      ) : (
        keys.length > 0 && (
          <div className="ak-list" aria-label="Your keys">
            {keys.map((k) => (
              <div key={k.keyId} className="ak-row">
                <span className="ak-name">
                  <span className="ak-name-text">{k.name}</span>
                  <code className="ak-prefix">{k.prefix}…</code>
                </span>
                <span className="ak-meta">Made {day(k.createdAt)}</span>
                <span className={k.lastUsedAt ? "ak-used" : "ak-used ak-never"}>{k.lastUsedAt ? `Used ${day(k.lastUsedAt)}` : "Never used"}</span>
                {revoking === k.keyId ? (
                  <span className="row">
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void revoke(k)}>
                      Revoke now
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setRevoking(undefined)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn ak-revoke" onClick={() => setRevoking(k.keyId)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void create();
        }}
      >
        <input
          id="personal-key-name"
          aria-label="Key name"
          value={name}
          maxLength={80}
          placeholder="Claude"
          onChange={(e) => setName(e.target.value)}
          style={{ flex: "1 1 160px", minWidth: 0 }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Making..." : "Make a key"}
        </button>
      </form>
      <FormError error={formError} />
      {made && <SecretReveal name={made.name} secret={made.secret} onDone={() => setMade(undefined)} />}
    </div>
  );
}
