import { useEffect, useState } from "react";
import { api } from "../../api";
import { Link } from "../../router";
import type { KeeperView } from "../../types";
import { Avatar, Dialog, FormError } from "../../ui";

const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** On Staff and admins: who looks after the company's costume and props stock. Admins only. */
export function KeepersCard(props: { theaterId: string; showToast: (m: string) => void }) {
  const [keepers, setKeepers] = useState<KeeperView[]>();
  const [editing, setEditing] = useState<KeeperView | "new">();
  useEffect(() => {
    api
      .keepers(props.theaterId)
      .then(setKeepers)
      .catch(() => setKeepers([]));
  }, [props.theaterId]);

  const what = (k: KeeperView) => (k.costumes && k.props ? "Costume and props keeper" : k.costumes ? "Costume keeper" : "Props keeper");
  return (
    <section className="co-staff-card" aria-label="Costume and props keepers">
      <div className="co-staff-card-head">
        <h2>Costume and props keepers</h2>
      </div>
      <span className="desc">
        Look after the company's <Link to={`/c/${props.theaterId}/stock`}>stock</Link>, which carries over between shows. They don't need
        to be on a show.
      </span>
      {keepers?.map((k) => (
        <div key={k.userId} className="co-staff-person">
          <Avatar name={k.name} email={k.email} />
          <span className="co-person-text">
            <span className="co-person-name">{k.name || k.email}</span>
            <span className="co-person-sub">{what(k)}</span>
          </span>
          <button type="button" className="btn" onClick={() => setEditing(k)}>
            Change
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-dashed" onClick={() => setEditing("new")}>
        + Add a keeper
      </button>
      {editing && (
        <KeeperDialog
          theaterId={props.theaterId}
          keeper={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onDone={(list, message) => {
            setKeepers(list);
            setEditing(undefined);
            props.showToast(message);
          }}
        />
      )}
    </section>
  );
}

function KeeperDialog(props: {
  theaterId: string;
  keeper?: KeeperView;
  onClose: () => void;
  onDone: (list: KeeperView[], message: string) => void;
}) {
  const k = props.keeper;
  const [email, setEmail] = useState(k?.email ?? "");
  const [name, setName] = useState(k?.name ?? "");
  const [costumes, setCostumes] = useState(k?.costumes ?? true);
  const [propsOn, setPropsOn] = useState(k?.props ?? false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!validEmail(email)) return setError("Enter their email address.");
    if (!costumes && !propsOn) return setError("Tick costumes, props or both.");
    setBusy(true);
    try {
      const list = await api.putKeeper(props.theaterId, { email: email.trim(), name: name.trim() || null, costumes, props: propsOn });
      props.onDone(list, `${name.trim() || email.trim()} can now look after the stock`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!k) return;
    setBusy(true);
    try {
      props.onDone(await api.removeKeeper(props.theaterId, k.userId), `${k.name || k.email} is no longer a keeper`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={k ? "Change keeper" : "Add a keeper"} onClose={props.onClose}>
      {!k && (
        <>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label className="field">
            Name <span className="hint">Optional</span>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={costumes} onChange={(e) => setCostumes(e.target.checked)} />
        Costumes
      </label>
      <label className="check">
        <input type="checkbox" checked={propsOn} onChange={(e) => setPropsOn(e.target.checked)} />
        Props
      </label>
      <FormError error={error} />
      <div className="dialog-actions">
        {k && (
          <button className="btn" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
        <span className="grow" />
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </Dialog>
  );
}
