import { useState } from "react";
import { api } from "../../../api";
import type { Breakdown, ShowRole } from "../../../types";
import { Dialog, FormError, Icon } from "../../../ui";
import { errorText } from "../breakdown/Confirm";
import { parseList, ROLE_LABEL } from "./model";

const ROLE_HINT: Record<ShowRole, string> = {
  cast: "Cast send their conflicts and see their calls.",
  crew: "Crew send their conflicts and see the calls they're in.",
  staff: "Staff can edit the schedule, the breakdown and the company list for this show.",
};

interface Result {
  line: string;
  ok: boolean;
  text: string;
}

/** Invite one person, or paste a list of names and emails. */
export function InviteDialog(props: {
  showId: string;
  bd?: Breakdown;
  departments: string[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"one" | "list">("one");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShowRole>("cast");
  const [parts, setParts] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [text, setText] = useState("");
  const [results, setResults] = useState<Result[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const chars = [...(props.bd?.characters ?? [])].sort((a, b) => a.order - b.order);
  const parsed = parseList(text);
  const usable = parsed.filter((p) => p.email);

  const sendOne = async () => {
    setError(undefined);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter their email address.");
    setBusy(true);
    try {
      const sent = await api.invite(props.showId, {
        email: email.trim(),
        name: name.trim() || null,
        role,
        characterIds: role === "cast" ? parts : [],
        title: role !== "cast" ? title.trim() || null : null,
        department: role !== "cast" ? department.trim() || null : null,
      });
      await props.onSaved(`Invite sent to ${name.trim() || sent.email}`);
      props.onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const sendList = async () => {
    setError(undefined);
    if (!usable.length) return setError('Paste one person per line, like "Maya Chen, maya@example.org".');
    setBusy(true);
    const out: Result[] = [];
    for (const p of parsed) {
      if (!p.email) {
        out.push({ line: p.line, ok: false, text: "No email address on this line" });
        continue;
      }
      try {
        await api.invite(props.showId, { email: p.email, name: p.name ?? null, role: "cast", characterIds: [] });
        out.push({ line: p.line, ok: true, text: `Invited ${p.name ?? p.email}` });
      } catch (e) {
        out.push({ line: p.line, ok: false, text: errorText(e) });
      }
    }
    setResults(out);
    setBusy(false);
    const sent = out.filter((r) => r.ok).length;
    await props.onSaved(sent ? `Sent ${sent} invite${sent === 1 ? "" : "s"}` : "No invites sent");
  };

  if (results)
    return (
      <Dialog title="Invites" onClose={props.onClose}>
        <p className="lede">
          {results.filter((r) => r.ok).length} of {results.length} sent.
        </p>
        <div className="list">
          {results.map((r, i) => (
            <div key={i} className="sp-result">
              <span className={r.ok ? "sp-result-ok" : "sp-result-bad"}>
                <Icon name={r.ok ? "check" : "x"} size={16} strokeWidth={3} />
              </span>
              <span className="grow">
                <span className="sp-result-line">{r.line}</span>
                <span className={r.ok ? "small muted" : "small error"}>{r.text}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          {results.some((r) => !r.ok) && (
            <button
              className="btn"
              onClick={() => {
                setText(results.filter((r) => !r.ok).map((r) => r.line).join("\n"));
                setResults(undefined);
              }}
            >
              Fix the ones that failed
            </button>
          )}
          <button className="btn btn-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </Dialog>
    );

  return (
    <Dialog title="Invite people" onClose={props.onClose}>
      <div className="segmented segmented-light" role="group" aria-label="How to invite">
        <button type="button" aria-pressed={mode === "one"} onClick={() => setMode("one")}>
          One person
        </button>
        <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
          Paste a list
        </button>
      </div>
      {mode === "one" ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void sendOne();
          }}
        >
          <div className="form-grid">
            <label className="field">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Chen" maxLength={100} autoFocus />
            </label>
            <label className="field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maya@example.org" />
            </label>
          </div>
          <div className="field">
            Joining as
            <div className="chips" role="group" aria-label="Role">
              {(["cast", "crew", "staff"] as const).map((r) => (
                <button type="button" key={r} className="chip chip-lg" aria-pressed={role === r} onClick={() => setRole(r)}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <span className="hint">{ROLE_HINT[role]}</span>
          </div>
          {role === "cast" ? (
            <div className="field">
              <span>
                Part <span className="hint">(optional, pick more than one for doubling)</span>
              </span>
              {chars.length ? (
                <div className="chips">
                  {chars.map((c) => {
                    const on = parts.includes(c.charId);
                    return (
                      <button
                        type="button"
                        key={c.charId}
                        className="sp-chip"
                        aria-pressed={on}
                        onClick={() => setParts(on ? parts.filter((x) => x !== c.charId) : [...parts, c.charId])}
                      >
                        {on && <Icon name="check" size={12} strokeWidth={3.5} />}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="hint">No characters yet. You can cast them later from the Breakdown page.</span>
              )}
            </div>
          ) : (
            <div className="form-grid">
              <label className="field">
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={role === "staff" ? "Stage manager" : "Lighting"} maxLength={60} />
              </label>
              <label className="field">
                Department
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder={role === "staff" ? "Stage management" : "Set and tech"}
                  list="sp-departments"
                  maxLength={60}
                />
                <datalist id="sp-departments">
                  {props.departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </label>
            </div>
          )}
          <FormError error={error} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Sending..." : "Send invite"}
            </button>
          </div>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void sendList();
          }}
        >
          <label className="field">
            One person per line
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"Maya Chen, maya@example.org\nJay Patel <jay@example.org>"}
              autoFocus
            />
            <span className="hint">
              Everyone on the list joins as cast. Set parts after, from the Breakdown page or each person's card.
              {text.trim() && ` ${usable.length} with an email${parsed.length > usable.length ? `, ${parsed.length - usable.length} without` : ""}.`}
            </span>
          </label>
          <FormError error={error} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !usable.length}>
              {busy ? "Sending..." : usable.length ? `Invite ${usable.length}` : "Invite"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
