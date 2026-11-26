import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { shortDate } from "../../lib/dates";
import { Link } from "../../router";
import { ActorShell, StaffShell } from "../../shell";
import { useSession } from "../../session";
import type { MeasurementSheet, Photo } from "../../types";
import { ErrorView, FormError, Icon, Loading, useToast } from "../../ui";
import { BodyDiagram } from "./BodyDiagram";
import { NUMBERED, type Draft, type NumberKey, SIZES, changes, parseInches, toDraft } from "./measureLib";
import { PhotoStrip } from "./PhotoStrip";
import "./wardrobe.css";

type Section = "sizes" | "around" | "lengths" | "sleeve" | "notes" | "needs";
const SECTIONS: { id: Section; title: string; blurb: string }[] = [
  { id: "sizes", title: "Sizes", blurb: "Height, weight and the sizes you buy in a store." },
  { id: "around", title: "Around the body", blurb: "Measurements 1 to 7. Snug, not tight." },
  { id: "lengths", title: "Lengths", blurb: "Measurements 8 to 11, 15 and 16. Stand straight in socks." },
  { id: "sleeve", title: "Sleeve", blurb: "Measurements 12 to 14, one tape from the neck to the wrist." },
  { id: "notes", title: "Good to know", blurb: "Allergies, piercings, tattoos, anything the costume team should know." },
  { id: "needs", title: "Costume, hair and accessory ideas", blurb: "For this show. Add pictures if you have them." },
];

/** A person's measurement sheet, laid out like the theater's paper form. Sections fold open one at a time,
 * or "Walk me through it" goes one measurement at a time with the diagram and how to take it. */
export function MeasurementForm(props: ShowPageProps) {
  const view = props.view;
  const showId = view.show.showId;
  const session = useSession();
  const me = session.me.user.userId;
  const userId = props.sub ?? me;
  const staff = view.role === "staff";
  const [sheet, setSheet] = useState<MeasurementSheet>();
  const [error, setError] = useState<string>();
  const [before, setBefore] = useState<Draft>({});
  const [draft, setDraft] = useState<Draft>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [open, setOpen] = useState<Section | undefined>("sizes");
  const [guided, setGuided] = useState<number>();
  const [active, setActive] = useState<number>();
  const [saveError, setSaveError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const take = useCallback((s: MeasurementSheet) => {
    setSheet(s);
    const d = toDraft(s.measurements, s.needs.needs);
    setBefore(d);
    setDraft(d);
    setPhotos(s.needs.photos ?? []);
  }, []);

  useEffect(() => {
    if (!userId) return;
    api
      .measurements(showId, userId)
      .then(take)
      .catch((e: Error) => setError(e.message));
  }, [showId, userId, take]);

  const done = useMemo(() => new Set(NUMBERED.filter((x) => parseInches(draft[x.key] ?? "") != null).map((x) => x.n)), [draft]);
  const photosChanged = sheet ? photos.map((p) => p.photoId).join() !== (sheet.needs.photos ?? []).map((p) => p.photoId).join() : false;
  const dirty = Object.keys(draft).some((k) => (draft[k as keyof Draft] ?? "") !== (before[k as keyof Draft] ?? "")) || photosChanged;
  const mine = userId === me;
  const editable = Boolean(sheet?.canEdit);

  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async (after?: () => void) => {
    if (!sheet) return;
    const result = changes(before, draft);
    if ("error" in result) return setSaveError(result.error);
    const body = { ...result.body, ...(photosChanged ? { needsPhotoIds: photos.map((p) => p.photoId) } : {}) };
    if (Object.keys(body).length === 0) return after?.();
    setBusy(true);
    setSaveError(undefined);
    try {
      take(await api.saveMeasurements(showId, userId, body));
      showToast("Measurements saved");
      after?.();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (error) body = <ErrorView message={error} />;
  else if (!sheet) body = <Loading />;
  else {
    const who = mine ? "Your measurements" : `${sheet.name ?? "Someone"}'s measurements`;
    const back = staff || !mine ? `/shows/${showId}/costumes/measurements` : `/shows/${showId}`;
    body = (
      <main className={staff ? "page wr-page wr-measure" : "wr-measure wr-measure-phone"}>
        <div className="wr-head">
          <Link to={back} className="small">
            ← {staff || !mine ? "Measurements" : "Show"}
          </Link>
          <h1 className="title-md">{who}</h1>
          <p className="small muted">
            {sheet.parts.length > 0 && <>{sheet.parts.join(", ")} · </>}
            {done.size} of 16 measured
            {sheet.measurements.updatedAt && (
              <>
                {" "}
                · Updated {shortDate(sheet.measurements.updatedAt.slice(0, 10))}
                {sheet.updatedByName && ` by ${sheet.updatedByName}`}
              </>
            )}
          </p>
          <p className="small muted">
            {mine
              ? "These stay with you for future shows in this company. Only you and the people with costume access see them."
              : "Only this person and people with costume access see these. They carry over to the person's next show."}
          </p>
        </div>

        {guided !== undefined ? (
          <Guided
            step={guided}
            draft={draft}
            done={done}
            onChange={set}
            onStep={setGuided}
            onFinish={() => void save(() => setGuided(undefined))}
            onStop={() => setGuided(undefined)}
            busy={busy}
            error={saveError}
          />
        ) : (
          <>
            {editable && (
              <button type="button" className="btn btn-outline wr-guide-btn" onClick={() => setGuided(0)}>
                <Icon name="ruler" size={18} /> Walk me through it
                <span className="small muted">One measurement at a time, with how to take it</span>
              </button>
            )}
            <div className="wr-measure-grid">
              <div className="wr-sections">
                {SECTIONS.map((s) => {
                  const isOpen = open === s.id;
                  const nums = NUMBERED.filter((x) => x.group === s.id);
                  const count =
                    s.id === "sizes"
                      ? `${SIZES.filter((z) => (draft[z.key] ?? "").trim()).length} of ${SIZES.length}`
                      : nums.length
                        ? `${nums.filter((x) => done.has(x.n)).length} of ${nums.length}`
                        : s.id === "notes"
                          ? (draft.notes ?? "").trim()
                            ? "Filled in"
                            : ""
                          : (draft.needs ?? "").trim() || photos.length
                            ? "Filled in"
                            : "";
                  return (
                    <section key={s.id} className={isOpen ? "wr-sec open" : "wr-sec"}>
                      <button type="button" className="wr-sec-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : s.id)}>
                        <span className="wr-sec-title">{s.title}</span>
                        <span className="wr-sec-count">{count}</span>
                        <Icon name={isOpen ? "up" : "down"} size={18} />
                      </button>
                      {isOpen && (
                        <div className="wr-sec-body">
                          <p className="small muted">{s.blurb}</p>
                          {s.id === "sizes" && (
                            <div className="wr-size-grid">
                              {SIZES.map((z) => (
                                <label key={z.key} className="field">
                                  {z.label}
                                  <input
                                    value={draft[z.key] ?? ""}
                                    maxLength={40}
                                    placeholder={z.placeholder}
                                    disabled={!editable}
                                    onChange={(e) => set(z.key, e.target.value)}
                                  />
                                </label>
                              ))}
                            </div>
                          )}
                          {nums.map((x) => (
                            <label key={x.key} className={active === x.n ? "wr-num on" : "wr-num"}>
                              <span className="wr-num-n">{x.n}</span>
                              <span className="wr-num-label">
                                {x.label}
                                <span className="small muted">{x.how}</span>
                              </span>
                              <span className="wr-num-in">
                                <input
                                  id={`m-${x.n}`}
                                  inputMode="decimal"
                                  value={draft[x.key] ?? ""}
                                  disabled={!editable}
                                  onFocus={() => setActive(x.n)}
                                  onBlur={() => setActive(undefined)}
                                  onChange={(e) => set(x.key, e.target.value)}
                                  aria-label={`${x.n}. ${x.label}, inches`}
                                />
                                <span className="small muted">in</span>
                              </span>
                            </label>
                          ))}
                          {s.id === "notes" && (
                            <label className="field">
                              Notes <span className="hint">Allergies (latex, wool, makeup), piercings, tattoos</span>
                              <textarea
                                rows={3}
                                maxLength={1000}
                                value={draft.notes ?? ""}
                                disabled={!editable}
                                onChange={(e) => set("notes", e.target.value)}
                              />
                            </label>
                          )}
                          {s.id === "needs" && (
                            <>
                              <label className="field">
                                Ideas <span className="hint">What you've talked about with the designer, or your own thoughts</span>
                                <textarea
                                  rows={3}
                                  maxLength={2000}
                                  value={draft.needs ?? ""}
                                  disabled={!editable}
                                  onChange={(e) => set("needs", e.target.value)}
                                />
                              </label>
                              <PhotoStrip
                                label="Idea pictures"
                                photos={photos}
                                onChange={editable ? setPhotos : undefined}
                                upload={editable ? (blob) => api.uploadShowPhoto(showId, blob) : undefined}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <aside className="wr-diagram">
                <BodyDiagram
                  active={active}
                  done={done}
                  onPick={(n) => {
                    const x = NUMBERED.find((m) => m.n === n);
                    if (!x) return;
                    setOpen(x.group);
                    setTimeout(() => document.getElementById(`m-${n}`)?.focus(), 0);
                  }}
                />
                <span className="small muted">Front and back. Tap a number to jump to it.</span>
              </aside>
            </div>
            {editable && (
              <div className="wr-save-bar">
                <FormError error={saveError} />
                <span className="grow" />
                {dirty && <span className="small muted">Not saved yet</span>}
                <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    );
  }

  if (staff)
    return (
      <StaffShell view={view} current="costumes">
        {body}
        {toast}
      </StaffShell>
    );
  return (
    <ActorShell showId={showId} current="show" archived={view.show.status === "archived"}>
      {body}
      {toast}
    </ActorShell>
  );
}

function Guided(props: {
  step: number;
  draft: Draft;
  done: Set<number>;
  onChange: (key: NumberKey, value: string) => void;
  onStep: (n: number) => void;
  onFinish: () => void;
  onStop: () => void;
  busy: boolean;
  error?: string;
}) {
  const x = NUMBERED[props.step]!;
  const last = props.step === NUMBERED.length - 1;
  const value = props.draft[x.key] ?? "";
  const bad = value.trim() !== "" && parseInches(value) === undefined;
  return (
    <div className="wr-guided">
      <div className="wr-guided-top">
        <span className="caps">
          {x.n} of 16 · {props.done.size} done
        </span>
        <button type="button" className="btn btn-sm" onClick={props.onStop}>
          Back to the form
        </button>
      </div>
      <div className="wr-guided-body">
        <BodyDiagram active={x.n} done={props.done} />
        <div className="stack">
          <h2 className="title-sm">
            {x.n}. {x.label}
          </h2>
          <p>{x.how}</p>
          <label className="wr-guided-in">
            <input
              key={x.key}
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => props.onChange(x.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !bad) (last ? props.onFinish : () => props.onStep(props.step + 1))();
              }}
              aria-label={`${x.label}, inches`}
              placeholder="0"
            />
            <span>inches</span>
          </label>
          {bad && <span className="small error">Use inches, like 28 or 28.5 or 28 1/2.</span>}
          <p className="small muted">Measure with someone helping if you can. Leave it blank to skip.</p>
        </div>
      </div>
      <FormError error={props.error} />
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={props.step === 0} onClick={() => props.onStep(props.step - 1)}>
          Back
        </button>
        <span className="grow" />
        {last ? (
          <button type="button" className="btn btn-primary" disabled={props.busy || bad} onClick={props.onFinish}>
            {props.busy ? "Saving..." : "Save and finish"}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={bad} onClick={() => props.onStep(props.step + 1)}>
            {value.trim() ? "Next" : "Skip"}
          </button>
        )}
      </div>
    </div>
  );
}
