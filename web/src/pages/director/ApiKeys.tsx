import { useState, type ReactNode } from "react";
import { api } from "../../api";
import { useIsPhone } from "../../lib/useMedia";
import type { Admin, ApiKey, ApiKeyScope } from "../../types";
import { Dialog, FormError, Loading, Sheet } from "../../ui";
import { useAsync } from "../../useAsync";
import "./api-keys.css";

const SCOPE_LABEL: Record<ApiKeyScope, string> = { read: "Read only", write: "Read and write" };
const SCOPE_NOTE: Record<ApiKeyScope, string> = {
  read: "Can see shows, the breakdown, people, conflicts, the schedule and the callboard. Can't change anything.",
  write: "Can also build and publish the schedule and post notices to the callboard.",
};

/** "Oct 29", or "Oct 29, 2025" outside this year. */
function day(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function lastUsed(iso?: string | null): string {
  if (!iso) return "Never used";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Used today";
  return `Last used ${day(iso)}`;
}

/** Centered dialog on web, bottom sheet on phone. */
function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  const phone = useIsPhone();
  return phone ? (
    <Sheet title={props.title} onClose={props.onClose}>
      {props.children}
    </Sheet>
  ) : (
    <Dialog title={props.title} onClose={props.onClose}>
      {props.children}
    </Dialog>
  );
}

/** The API keys card on Staff and admins. Company admins only. */
export function ApiKeysCard(props: { theaterId: string; admins: Admin[]; showToast: (m: string) => void }) {
  const { data, error, reload, setData } = useAsync(() => api.apiKeys(props.theaterId), [props.theaterId]);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey>();
  const origin = window.location.origin;
  const nameOf = (userId: string) => {
    const a = props.admins.find((x) => x.userId === userId);
    return a ? a.name || a.email : "A former admin";
  };
  const keys = data ? [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : undefined;

  return (
    <section className="co-staff-card ak-card" aria-label="API keys">
      <div className="co-staff-card-head ak-head">
        <h2>API keys</h2>
        <button type="button" className="btn btn-primary ak-new" onClick={() => setCreating(true)}>
          + New key
        </button>
      </div>
      <span className="desc">Keys let other tools read the company's schedule, or change it, through the REST, GraphQL and MCP APIs.</span>

      <dl className="ak-endpoints">
        <div>
          <dt>REST</dt>
          <dd>
            <code>{origin}/api/v1</code>
          </dd>
        </div>
        <div>
          <dt>GraphQL</dt>
          <dd>
            <code>{origin}/api/graphql</code>
          </dd>
        </div>
        <div>
          <dt>MCP</dt>
          <dd>
            <code>{origin}/mcp</code>
          </dd>
        </div>
      </dl>
      <span className="ak-howto">
        Send the key as <code>Authorization: Bearer wl_…</code>. Up to 120 requests a minute per key. REST routes are listed in the{" "}
        <a href="/api/openapi.json" target="_blank" rel="noreferrer">
          OpenAPI schema
        </a>
        .
      </span>

      <div className="ak-list" aria-label="Keys">
        {error ? (
          <div className="ak-state">
            <p className="form-error">{error}</p>
            <button type="button" className="btn" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : !keys ? (
          <Loading label="Loading keys..." />
        ) : keys.length === 0 ? (
          <div className="ak-state ak-empty">
            <span className="ak-empty-title">No keys yet</span>
            <span>Make one when a tool needs to read the schedule.</span>
          </div>
        ) : (
          keys.map((k) => (
            <div key={k.keyId} className="ak-row">
              <span className="ak-name">
                <span className="ak-name-text">{k.name}</span>
                <code className="ak-prefix">{k.prefix}…</code>
              </span>
              <span className={k.scope === "write" ? "tag tag-plum ak-scope" : "tag ak-scope"}>{SCOPE_LABEL[k.scope]}</span>
              <span className="ak-meta">
                {nameOf(k.createdBy)} · {day(k.createdAt)}
              </span>
              <span className={k.lastUsedAt ? "ak-used" : "ak-used ak-never"}>{lastUsed(k.lastUsedAt)}</span>
              <button type="button" className="btn ak-revoke" onClick={() => setRevoking(k)}>
                Revoke
              </button>
            </div>
          ))
        )}
      </div>

      {creating && (
        <NewKeyDialog
          theaterId={props.theaterId}
          onClose={() => setCreating(false)}
          onCreated={(key) => setData([...(data ?? []), key])}
        />
      )}
      {revoking && (
        <RevokeDialog
          apiKey={revoking}
          onCancel={() => setRevoking(undefined)}
          onConfirm={async () => {
            await api.revokeApiKey(props.theaterId, revoking.keyId);
            setData((data ?? []).filter((k) => k.keyId !== revoking.keyId));
            setRevoking(undefined);
            props.showToast(`${revoking.name} is revoked.`);
          }}
        />
      )}
    </section>
  );
}

function NewKeyDialog(props: { theaterId: string; onClose: () => void; onCreated: (key: ApiKey) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [secret, setSecret] = useState<string>();

  const create = async () => {
    if (!name.trim()) return setError("Give the key a name.");
    setBusy(true);
    setError(undefined);
    try {
      const made = await api.createApiKey(props.theaterId, { name: name.trim(), scope });
      props.onCreated(made.key);
      setSecret(made.secret);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (secret) return <SecretReveal name={name.trim()} secret={secret} onDone={props.onClose} />;

  return (
    <Modal title="New API key" onClose={props.onClose}>
      <form
        className="stack ak-form"
        style={{ gap: 14 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void create();
        }}
      >
        <label className="field">
          Name
          <input type="text" value={name} maxLength={80} placeholder="Box office sheet" autoFocus autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <span className="hint">So you can tell keys apart later.</span>
        </label>
        <div className="stack-sm">
          <span className="co-label">What it can do</span>
          <div className="segmented segmented-block" role="group" aria-label="What it can do">
            {(["read", "write"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="note">{SCOPE_NOTE[scope]}</div>
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Making..." : "Make key"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SecretReveal(props: { name: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.secret);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };
  return (
    // Only Done closes it, so a stray click outside doesn't lose the secret.
    <Modal title="Copy your key" onClose={() => undefined}>
      <p className="lede ak-lede">{props.name} is ready. Paste it into the tool that will use it.</p>
      <div className="ak-secret">
        <code
          tabIndex={0}
          aria-label="API key"
          onFocus={(e) => {
            const range = document.createRange();
            range.selectNodeContents(e.currentTarget);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }}
        >
          {props.secret}
        </code>
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {copyError && <p className="form-error">Couldn't copy. Select the key and copy it by hand.</p>}
      <p className="ak-warn">You won't see this again. If you lose it, revoke it and make a new one.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onDone}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function RevokeDialog(props: { apiKey: ApiKey; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal title={`Revoke ${props.apiKey.name}?`} onClose={props.onCancel}>
      <p className="lede ak-lede">
        Anything using <code>{props.apiKey.prefix}…</code> stops working right away. This can't be undone.
      </p>
      <FormError error={error} />
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onConfirm();
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Revoking..." : "Revoke key"}
        </button>
      </div>
    </Modal>
  );
}
