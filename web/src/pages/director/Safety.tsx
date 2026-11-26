import { useCallback, useEffect, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { time12 } from "../../lib/dates";
import { firstName } from "../../lib/people";
import { useIsPhone } from "../../lib/useMedia";
import { useSession } from "../../session";
import { StaffShell } from "../../shell";
import type { EmergencyContact, MedicalNotes, Member, MemberSafety, ShowSafetyPage } from "../../types";
import { Dialog, ErrorView, Icon, Loading, Sheet, useToast } from "../../ui";
import "./safety.css";

type View = "contacts" | "pickup" | "missing" | "access";

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function CallButton(props: { contact: EmergencyContact; label?: string }) {
  return (
    <a className="btn btn-sm btn-outline sf-call" href={tel(props.contact.phone)} onClick={(e) => e.stopPropagation()}>
      <Icon name="phone" size={16} /> {props.label ?? "Call"}
    </a>
  );
}

function contactLine(c: EmergencyContact) {
  return [c.name, c.relationship && `(${c.relationship.toLowerCase()})`, c.phone].filter(Boolean).join(" ");
}

/** Staff page: everyone's emergency contacts on one page, tonight's minors' pickups, and who's missing info. */
export function Safety(props: ShowPageProps) {
  const showId = props.view.show.showId;
  const phone = useIsPhone();
  const [page, setPage] = useState<ShowSafetyPage>();
  const [staff, setStaff] = useState<Member[]>([]);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<View>("contacts");
  const [open, setOpen] = useState<MemberSafety>();
  const [toast, showToast] = useToast();
  const canGrant = Boolean(page?.medicalAccess || props.view.viaAdmin);

  const load = useCallback(async () => {
    try {
      const [p, members] = await Promise.all([api.showSafety(showId), api.members(showId)]);
      setPage(p);
      setStaff(members.filter((m) => m.role === "staff" && m.status === "joined"));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [showId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = (body: React.ReactNode) => (
    <StaffShell view={props.view} current="safety">
      {body}
    </StaffShell>
  );
  if (error && !page) return shell(<ErrorView message={error} onRetry={() => void load()} />);
  if (!page) return shell(<Loading />);

  const byId = new Map(page.members.map((m) => [m.userId, m]));
  const missing = page.members.filter((m) => m.contacts.length === 0);
  const tonight = page.tonight.map((t) => ({ ...t, member: byId.get(t.userId) })).filter((t) => t.member);
  const views: { id: View; label: string }[] = [
    { id: "contacts", label: "Contacts" },
    { id: "pickup", label: phone ? "Pickup" : "Pickup tonight" },
    { id: "missing", label: missing.length ? `Missing (${missing.length})` : "Missing" },
    ...(canGrant ? [{ id: "access" as View, label: phone ? "Access" : "Medical access" }] : []),
  ];

  async function setAccess(m: Member, on: boolean) {
    try {
      await api.updateMember(showId, m.userId, { medicalAccess: on });
      showToast(on ? `${m.name ?? m.email} can now see medical notes` : "Medical access removed");
      await load();
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  return shell(
    <main className={phone ? "phone-body" : "page sf-page"}>
      <div className="stack-sm">
        <h1 className="title">Safety</h1>
        <p className="muted small">
          Everyone in the company can see who has looked at their info. You can only see this page while the show is active.
        </p>
      </div>
      <div className="segmented sf-views" role="group" aria-label="Show">
        {views.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "contacts" && (
        <div className="list">
          {page.members.map((m) => {
            const first = m.contacts[0];
            return (
              <div key={m.userId} className="sf-row" role="button" tabIndex={0} onClick={() => setOpen(m)} onKeyDown={(e) => e.key === "Enter" && setOpen(m)}>
                <span className="grow stack-sm sf-gap">
                  <span className="row sf-name">
                    <strong>{m.name ?? "Unnamed"}</strong>
                    {m.minor && <span className="tag tag-plum">Minor</span>}
                    {m.hasMedical && <span className="tag sf-tag-med">Medical</span>}
                  </span>
                  <span className="muted small">{first ? contactLine(first) : "No emergency contact yet"}</span>
                </span>
                {first ? <CallButton contact={first} /> : <span className="tag tag-soft">Missing</span>}
              </div>
            );
          })}
        </div>
      )}

      {view === "pickup" &&
        (tonight.length === 0 ? (
          <div className="empty">
            <strong>No minors are called tonight</strong>
            <span>Minors on tonight's published calls show here with who may pick them up.</span>
          </div>
        ) : (
          <div className="list">
            {tonight.map(({ member: m, ends }) => (
              <div key={m!.userId} className="sf-row sf-pickup">
                <span className="grow stack-sm sf-gap">
                  <span className="row sf-name">
                    <strong>{m!.name}</strong>
                    <span className="muted small">done {time12(ends)}</span>
                  </span>
                  <span className="small">
                    {[...m!.contacts.filter((c) => c.guardian).map((c) => c.name), ...m!.pickups.map((p) => p.name)].join(", ") ||
                      "No approved adults listed"}
                  </span>
                  {m!.pickups.some((p) => p.note) && (
                    <span className="muted small">{m!.pickups.filter((p) => p.note).map((p) => `${p.name}: ${p.note}`).join(" · ")}</span>
                  )}
                </span>
                {m!.contacts[0] && <CallButton contact={m!.contacts[0]} />}
              </div>
            ))}
          </div>
        ))}

      {view === "missing" &&
        (missing.length === 0 ? (
          <div className="empty">
            <strong>Everyone has an emergency contact</strong>
          </div>
        ) : (
          <>
            <p className="note">
              These people haven't added an emergency contact. They see a reminder on their show page, and they add it on their Account page.
            </p>
            <div className="list">
              {missing.map((m) => (
                <div key={m.userId} className="sf-row">
                  <span className="grow">
                    <strong>{m.name ?? "Unnamed"}</strong> <span className="muted small">{m.title ?? m.role[0]!.toUpperCase() + m.role.slice(1)}</span>
                  </span>
                  {m.minor && <span className="tag tag-plum">Minor</span>}
                </div>
              ))}
            </div>
          </>
        ))}

      {view === "access" && (
        <>
          <p className="note">
            Every staff member sees emergency contacts. Only the people switched on here can open medical notes. Usually that's the
            director and stage manager.
          </p>
          <div className="list">
            {staff.map((m) => (
              <label key={m.userId} className="sf-row check">
                <span className="grow">
                  <strong>{m.name ?? m.email}</strong> <span className="muted small">{m.title}</span>
                </span>
                <input type="checkbox" checked={Boolean(m.medicalAccess)} onChange={(e) => void setAccess(m, e.target.checked)} />
              </label>
            ))}
          </div>
        </>
      )}

      {open && <PersonSafety showId={showId} member={open} medicalAccess={page.medicalAccess} phone={phone} onClose={() => setOpen(undefined)} />}
      {toast}
    </main>,
  );
}

const MEDICAL_FIELDS: { key: keyof MedicalNotes; label: string }[] = [
  { key: "allergies", label: "Allergies" },
  { key: "conditions", label: "Conditions" },
  { key: "medications", label: "Medications" },
  { key: "other", label: "Other" },
];

function PersonSafety(props: { showId: string; member: MemberSafety; medicalAccess: boolean; phone: boolean; onClose: () => void }) {
  const m = props.member;
  const { me } = useSession();
  const [medical, setMedical] = useState<MedicalNotes | null>();
  const [error, setError] = useState<string>();
  const first = firstName(m.name) || "They";

  async function reveal() {
    try {
      setMedical((await api.memberMedical(props.showId, m.userId)).medical ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const body = (
    <div className="stack">
      <div className="row">
        {m.minor && <span className="tag tag-plum">Minor</span>}
        <span className="muted small">{m.title ?? m.role[0]!.toUpperCase() + m.role.slice(1)}</span>
      </div>
      <div className="stack-sm">
        <span className="caps">Emergency contacts</span>
        {m.contacts.length === 0 && <span className="muted">None yet</span>}
        {m.contacts.map((c, i) => (
          <div key={i} className="spread sf-contact">
            <span className="grow stack-sm sf-gap">
              <strong>
                {c.name} {c.guardian && <span className="tag">Guardian</span>}
              </strong>
              <span className="muted small">{[c.relationship, c.phone, c.altPhone].filter(Boolean).join(" · ")}</span>
            </span>
            <CallButton contact={c} />
          </div>
        ))}
      </div>
      {m.minor && (
        <div className="stack-sm">
          <span className="caps">Approved pickups</span>
          {m.pickups.length === 0 ? (
            <span className="muted">Guardians only</span>
          ) : (
            m.pickups.map((p, i) => (
              <span key={i}>
                {p.name}
                {p.note && <span className="muted small"> · {p.note}</span>}
              </span>
            ))
          )}
        </div>
      )}
      {m.hasMedical && (
        <div className="stack-sm">
          <span className="caps">Medical</span>
          {!props.medicalAccess ? (
            <span className="sf-locked">Medical notes are on file. Ask the director or stage manager.</span>
          ) : medical === undefined ? (
            <div className="sf-locked stack-sm">
              <span>{m.userId === me.user.userId ? "These are your own notes." : `${first} will see that you looked.`}</span>
              <button className="btn btn-sm btn-primary" onClick={() => void reveal()}>
                Show medical notes
              </button>
              {error && <span className="error">{error}</span>}
            </div>
          ) : (
            <div className="sf-medical stack-sm">
              {MEDICAL_FIELDS.filter((f) => medical?.[f.key]).map((f) => (
                <span key={f.key}>
                  <strong>{f.label}:</strong> {medical?.[f.key]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
  return props.phone ? (
    <Sheet title={m.name ?? "Safety info"} onClose={props.onClose}>
      {body}
    </Sheet>
  ) : (
    <Dialog title={m.name ?? "Safety info"} onClose={props.onClose}>
      {body}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
