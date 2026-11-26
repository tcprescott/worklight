import { useEffect, useState } from "react";
import { api } from "../../api";
import { Link } from "../../router";
import { CompanyShell } from "../../shell";
import type { StrikeTemplateLine } from "../../types";
import { ErrorView, FormError, Icon, Loading, useToast } from "../../ui";
import { useAsync } from "../../useAsync";
import "./strike.css";

interface Area {
  key: number;
  name: string;
  tasks: { key: number; text: string }[];
}

let nextKey = 1;
const k = () => nextKey++;

function toAreas(lines: StrikeTemplateLine[]): Area[] {
  const out: Area[] = [];
  for (const l of lines) {
    let a = out.find((x) => x.name === l.area);
    if (!a) out.push((a = { key: k(), name: l.area, tasks: [] }));
    a.tasks.push({ key: k(), text: l.text });
  }
  return out;
}

/** Company admins keep the standard strike list: areas and tasks, no people. Each show gets its own copy. */
export function StrikeTemplatePage(props: { theaterId: string }) {
  const theater = useAsync(() => api.theater(props.theaterId), [props.theaterId]);
  const template = useAsync(() => api.strikeTemplate(props.theaterId), [props.theaterId]);
  const [areas, setAreas] = useState<Area[]>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (template.data && !areas) setAreas(toAreas(template.data.tasks));
  }, [template.data, areas]);

  const name = theater.data?.theater.name;
  if (template.error || theater.error)
    return (
      <CompanyShell>
        <ErrorView message={(template.error ?? theater.error)!} />
      </CompanyShell>
    );
  if (!areas)
    return (
      <CompanyShell>
        <Loading />
      </CompanyShell>
    );

  const edit = (fn: (a: Area[]) => Area[]) => {
    setAreas((cur) => fn(cur ?? []));
    setDirty(true);
  };
  const setArea = (key: number, patch: Partial<Area>) => edit((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const save = async () => {
    setError(undefined);
    const lines: StrikeTemplateLine[] = [];
    for (const a of areas) {
      const tasks = a.tasks.filter((t) => t.text.trim());
      if (tasks.length && !a.name.trim()) return setError("Every area with tasks needs a name.");
      for (const t of tasks) lines.push({ area: a.name.trim(), text: t.text.trim() });
    }
    setSaving(true);
    try {
      const saved = await api.saveStrikeTemplate(props.theaterId, lines);
      setAreas(toAreas(saved.tasks));
      setDirty(false);
      showToast("Strike list saved. New strike calls start from it.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <CompanyShell context={name}>
      <main className="page strike-page">
        <div className="strike-head">
          <Link to={`/c/${props.theaterId}`} className="small">
            ← Company home
          </Link>
          <span className="kicker">Strike list</span>
          <h1 className="title-md">The standard strike list</h1>
          <p className="lede">
            When a show adds its strike call, it gets a copy of this list. The stage manager then edits it and assigns each task. Changing
            this list later doesn't change shows that already copied it.
          </p>
        </div>

        {areas.length === 0 && (
          <div className="empty strike-empty">
            <strong>No strike tasks yet</strong>
            <span>Add an area like Set or Props, then the jobs in it.</span>
          </div>
        )}

        <div className="strike-list">
          {areas.map((a) => (
            <section key={a.key} className="strike-area">
              <div className="strike-area-head strike-tpl-head">
                <input
                  className="input input-sm strike-tpl-area"
                  value={a.name}
                  maxLength={60}
                  placeholder="Area name"
                  aria-label="Area name"
                  onChange={(e) => setArea(a.key, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="strike-edit"
                  aria-label={`Remove ${a.name || "this area"}`}
                  title="Remove area"
                  onClick={() => edit((list) => list.filter((x) => x.key !== a.key))}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {a.tasks.map((t) => (
                <div key={t.key} className="strike-tpl-task">
                  <input
                    className="input input-sm"
                    value={t.text}
                    maxLength={200}
                    placeholder="What needs doing"
                    aria-label="Task"
                    onChange={(e) => setArea(a.key, { tasks: a.tasks.map((x) => (x.key === t.key ? { ...x, text: e.target.value } : x)) })}
                  />
                  <button
                    type="button"
                    className="strike-edit"
                    aria-label={`Remove ${t.text || "task"}`}
                    title="Remove task"
                    onClick={() => setArea(a.key, { tasks: a.tasks.filter((x) => x.key !== t.key) })}
                  >
                    <Icon name="x" size={18} />
                  </button>
                </div>
              ))}
              <button type="button" className="strike-add-here" onClick={() => setArea(a.key, { tasks: [...a.tasks, { key: k(), text: "" }] })}>
                <Icon name="plus" size={16} /> Add a task
              </button>
            </section>
          ))}
        </div>

        <div className="row">
          <button type="button" className="btn" onClick={() => edit((list) => [...list, { key: k(), name: "", tasks: [{ key: k(), text: "" }] }])}>
            <Icon name="plus" /> Add an area
          </button>
          <span className="grow" />
          <button type="button" className="btn btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? "Saving..." : dirty ? "Save the strike list" : "Saved"}
          </button>
        </div>
        <FormError error={error} />
      </main>
      {toast}
    </CompanyShell>
  );
}
