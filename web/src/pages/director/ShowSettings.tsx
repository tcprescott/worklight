import { useState, type ChangeEvent } from "react";
import type { ShowPageProps } from "../../App";
import { api } from "../../api";
import { useMedia } from "../../lib/useMedia";
import { StaffShell } from "../../shell";
import type { Show, UpdateShowBody } from "../../types";
import { FormError, useToast } from "../../ui";
import "./company.css";
import {
  ArchiveDialog,
  checkPlanDates,
  checkSlots,
  DateFields,
  liveSkips,
  MonthCalendar,
  PlaybillCard,
  planFromShow,
  RehearsalFields,
  ShowFields,
  slotList,
  summaryLine,
  type ShowPlan,
} from "./setup-parts";

interface Extra {
  offBookDate: string;
  conflictDeadline: string;
  minutesPerPage: string;
}

const extraFromShow = (show: Show): Extra => ({
  offBookDate: show.offBookDate ?? "",
  conflictDeadline: show.conflictDeadline ?? "",
  minutesPerPage: String(show.minutesPerPage ?? 8),
});

function bodyOf(plan: ShowPlan, extra: Extra): UpdateShowBody {
  return {
    name: plan.name.trim(),
    venue: plan.venue.trim() || null,
    address: plan.address.trim() || null,
    timezone: plan.timezone,
    startDate: plan.startDate,
    endDate: plan.endDate,
    openingDate: plan.openingDate || null,
    techStart: plan.techStart || null,
    slots: slotList(plan.slots),
    skippedDates: liveSkips(plan),
    offBookDate: extra.offBookDate || null,
    conflictDeadline: extra.conflictDeadline || null,
    minutesPerPage: Number(extra.minutesPerPage),
  };
}

export function ShowSettings(props: ShowPageProps) {
  const { show } = props.view;
  const wide = useMedia("(min-width: 1200px)");
  const archived = show.status === "archived";
  const [plan, setPlan] = useState<ShowPlan>(() => planFromShow(show));
  const [extra, setExtra] = useState<Extra>(() => extraFromShow(show));
  const [saved, setSaved] = useState(() => JSON.stringify(bodyOf(planFromShow(show), extraFromShow(show))));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [toast, showToast] = useToast();

  const body = bodyOf(plan, extra);
  const dirty = JSON.stringify(body) !== saved;

  const validate = (): string | undefined => {
    if (!plan.name.trim()) return "Add the show title.";
    const bad = checkPlanDates(plan) ?? checkSlots(plan);
    if (bad) return bad;
    if (extra.offBookDate && (extra.offBookDate < plan.startDate || extra.offBookDate > plan.endDate))
      return "Off book has to fall between the first rehearsal and closing.";
    const pace = Number(extra.minutesPerPage);
    if (!extra.minutesPerPage || !Number.isFinite(pace) || pace <= 0 || pace > 120) return "Rehearsal pace has to be between 1 and 120 minutes per page.";
    return undefined;
  };

  const save = async () => {
    const bad = validate();
    if (bad) return setError(bad);
    setBusy(true);
    setError(undefined);
    try {
      const updated = await api.updateShow(show.showId, body);
      setSaved(JSON.stringify(bodyOf(planFromShow(updated), extraFromShow(updated))));
      setPlan(planFromShow(updated));
      setExtra(extraFromShow(updated));
      await props.reloadView();
      showToast("Show settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await api.restoreShow(show.showId);
      await props.reloadView();
      showToast("Show restored.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setExtraField = (key: keyof Extra) => (e: ChangeEvent<HTMLInputElement>) => setExtra({ ...extra, [key]: e.target.value });
  const p = { plan, onChange: setPlan, disabled: archived };

  return (
    <StaffShell view={props.view} current="settings">
      <main className="co-settings">
        <form
          className="co-settings-main"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && !archived) void save();
          }}
        >
          <div className="stack-sm">
            <span className="caps">{props.view.theaterName}</span>
            <h1 className="co-h1">Show settings</h1>
            {archived && <p className="co-sub">This show is archived, so its settings are read-only. Restore it to make changes.</p>}
          </div>

          <fieldset className="co-plain" disabled={archived}>
            <section aria-labelledby="set-show">
              <h2 id="set-show">Show and venue</h2>
              <ShowFields {...p} />
            </section>

            <section aria-labelledby="set-dates">
              <h2 id="set-dates">Dates</h2>
              <DateFields {...p} withTech />
              <div className="form-grid">
                <label className="field">
                  Off book
                  <span className="hint">Lines learned by this date.</span>
                  <input type="date" value={extra.offBookDate} onChange={setExtraField("offBookDate")} />
                </label>
                <label className="field">
                  Conflict deadline
                  <span className="hint">Reminders tell people to send conflicts by this date.</span>
                  <input type="date" value={extra.conflictDeadline} onChange={setExtraField("conflictDeadline")} />
                </label>
              </div>
            </section>

            <section aria-labelledby="set-nights">
              <h2 id="set-nights">Rehearsal nights</h2>
              <RehearsalFields {...p} />
              <span className="co-summary">{summaryLine(plan)}</span>
              {!archived && <span className="co-hint">Tap a date on the calendar to skip it.</span>}
              {!wide && <MonthCalendar hideSummary plan={plan} onChange={archived ? undefined : setPlan} />}
              <label className="field">
                Rehearsal pace: minutes per script page
                <span className="hint">Used to estimate how long each scene takes to rehearse. 8 is a common starting point.</span>
                <span className="co-pace">
                  <input type="number" inputMode="decimal" min={1} max={120} step={0.5} value={extra.minutesPerPage} onChange={setExtraField("minutesPerPage")} />
                  <span className="muted">minutes per page</span>
                </span>
              </label>
            </section>
          </fieldset>

          {!archived && (
            <div className={dirty ? "co-savebar co-savebar-dirty" : "co-savebar"}>
              <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
                {busy ? "Saving..." : "Save changes"}
              </button>
              {dirty && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setPlan(planFromShow(show));
                    setExtra(extraFromShow(show));
                    setError(undefined);
                  }}
                >
                  Undo changes
                </button>
              )}
              <span className="co-hint">{dirty ? "Unsaved changes" : "All changes saved"}</span>
            </div>
          )}
          <FormError error={error} />

          <section aria-labelledby="set-archive">
            <h2 id="set-archive">{archived ? "Restore show" : "Archive show"}</h2>
            <div className="co-archive-box">
              {archived ? (
                <>
                  <p>Restoring brings it back to company home. Conflicts, invites and reminders work again.</p>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void restore()}>
                    Restore show
                  </button>
                </>
              ) : (
                <>
                  <p>When the show has closed, archive it. Everything becomes read-only, and people in it can still look back at it.</p>
                  <button type="button" className="btn btn-outline" onClick={() => setArchiving(true)}>
                    Archive show
                  </button>
                </>
              )}
            </div>
          </section>
        </form>

        {wide && (
          <aside className="co-wizard-side" aria-label="Preview">
            <PlaybillCard company={props.view.theaterName} show={plan.name} venue={[plan.venue, plan.address].filter((s) => s.trim()).join(", ")} />
            <MonthCalendar plan={plan} onChange={archived ? undefined : setPlan} />
          </aside>
        )}
      </main>
      {archiving && (
        <ArchiveDialog
          showName={show.name}
          onCancel={() => setArchiving(false)}
          onConfirm={async () => {
            await api.archiveShow(show.showId);
            setArchiving(false);
            await props.reloadView();
          }}
        />
      )}
      {toast}
    </StaffShell>
  );
}
