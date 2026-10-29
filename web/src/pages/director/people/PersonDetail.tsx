import { conflictStatus, firstName, STATUS_LABEL, STATUS_TAG } from "../../../lib/people";
import type { MemberConflicts } from "../../../types";
import { Avatar } from "../../../ui";
import { conflictLines, noConflictsText, type Person } from "./model";

export interface PersonActions {
  onChangePart: () => void;
  onRemind: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose?: () => void;
}

/** Details for one person: the web side panel, or the phone sheet's body. */
export function PersonDetail(
  props: PersonActions & {
    person: Person;
    conflicts?: MemberConflicts;
    isMe: boolean;
    readOnly: boolean;
    phone?: boolean;
    reminding?: boolean;
  },
) {
  const { person: p } = props;
  const m = p.member;
  const status = conflictStatus(m);
  const lines = conflictLines(props.conflicts);
  const first = firstName(p.name) || "them";
  const canRemind = !props.readOnly && !props.isMe && status !== "in";
  const remindLabel = status === "invited" ? "Resend invite" : "Remind about conflicts";
  const sub = `${p.part} · ${p.team}`;

  const email = m.email ? (
    <a className={props.phone && !canRemind ? "btn btn-primary btn-lg btn-block" : "btn btn-sm btn-outline"} href={`mailto:${m.email}`}>
      Email {first}
    </a>
  ) : null;
  const remind = canRemind ? (
    <button
      className={props.phone ? "btn btn-primary btn-lg btn-block" : "btn btn-sm btn-outline"}
      disabled={props.reminding}
      onClick={props.onRemind}
    >
      {props.reminding ? "Sending..." : remindLabel}
    </button>
  ) : null;
  const changePart = !props.readOnly && (m.role === "cast" || p.parts.length > 0) ? (
    <button className={props.phone ? "btn" : "btn btn-sm"} onClick={props.onChangePart}>
      Change part
    </button>
  ) : null;

  return (
    <div className="sp-person">
      <div className="sp-person-head">
        {props.phone ? <Avatar name={p.name} email={m.email} size="lg" /> : <Avatar name={p.name} email={m.email} size="xl" />}
        <span className="grow stack-sm sp-gap-2">
          <span className="sp-person-name">{p.name}</span>
          <span className="sp-person-sub">{sub}</span>
        </span>
        {props.onClose && (
          <button className="btn btn-outline" onClick={props.onClose}>
            Done
          </button>
        )}
      </div>
      {m.email && (
        <div className="stack-sm sp-gap-4">
          <span className="caps">Email</span>
          <span className="sp-person-email">{m.email}</span>
        </div>
      )}
      <div className="stack-sm sp-gap-8">
        <span className="spread">
          <span className="caps">Conflicts</span>
          <span className={STATUS_TAG[status]}>{STATUS_LABEL[status]}</span>
        </span>
        {lines.length ? (
          <div className="sp-conflicts">
            {lines.map((l) => (
              <div key={l.key} className="sp-conflict">
                <span className="grow">
                  {l.when}
                  {l.note && <span className="sp-conflict-note">{l.note}</span>}
                </span>
                <span className={l.tag}>{l.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="sp-person-none">{noConflictsText(m)}</span>
        )}
      </div>
      {props.phone ? (
        <div className="stack-sm">
          {remind ?? email}
          {remind && email && (
            <a className="btn" href={`mailto:${m.email}`}>
              Email {first}
            </a>
          )}
          <div className="sp-phone-tools">
            {changePart}
            {!props.readOnly && (
              <button className="btn" onClick={props.onEdit}>
                Edit
              </button>
            )}
          </div>
          {!props.readOnly && !props.isMe && (
            <button className="btn btn-danger" onClick={props.onRemove}>
              Remove from show
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="sp-person-actions">
            {email}
            {changePart}
            {remind}
          </div>
          {!props.readOnly && (
            <div className="sp-person-more">
              <button className="sp-text-action" onClick={props.onEdit}>
                Edit role
              </button>
              {!props.isMe && (
                <button className="sp-text-action sp-danger-text" onClick={props.onRemove}>
                  Remove from show
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
