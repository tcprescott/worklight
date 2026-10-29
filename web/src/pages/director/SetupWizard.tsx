import { useState } from "react";
import { api } from "../../api";
import { useMedia } from "../../lib/useMedia";
import { navigate } from "../../router";
import { useSession } from "../../session";
import { CompanyShell } from "../../shell";
import type { CreateShowBody } from "../../types";
import { ErrorView, FormError, Loading } from "../../ui";
import { useAsync } from "../../useAsync";
import "./company.css";
import {
  checkPlanDates,
  checkSlots,
  DateFields,
  departmentFor,
  emptyPlan,
  liveSkips,
  MonthCalendar,
  PlanInput,
  PlaybillCard,
  RehearsalFields,
  ShowFields,
  slotList,
  STAFF_ROLES,
  summaryLine,
  validEmail,
  type ShowPlan,
} from "./setup-parts";

type StepId = "company" | "show" | "rehearsals" | "staff";

const STEP_NAME: Record<StepId, string> = {
  company: "Company",
  show: "Show and venue",
  rehearsals: "Rehearsals",
  staff: "Staff",
};
const HEADING: Record<StepId, string> = {
  company: "What is your company called?",
  show: "What show are you putting on?",
  rehearsals: "When do you rehearse?",
  staff: "Who is running it with you?",
};
const SUB: Record<StepId, string> = {
  company: "Your theater, troupe or school group. You can run many shows under it.",
  show: "You can add more shows later from your company home.",
  rehearsals: "Pick your usual nights. We fill in the dates, and you can skip any.",
  staff: "Invite your stage manager and other staff. They get a one-tap link.",
};

interface StaffRow {
  email: string;
  name: string;
  title: string;
}

const blankRow = (title = "Stage manager"): StaffRow => ({ email: "", name: "", title });

/** /setup (new company and its first show) and /c/:theaterId/new-show (another show). */
export function SetupWizard(props: { theaterId?: string }) {
  if (!props.theaterId) return <Wizard />;
  return <NewShow theaterId={props.theaterId} />;
}

function NewShow(props: { theaterId: string }) {
  const { data, error } = useAsync(() => api.theater(props.theaterId), [props.theaterId]);
  if (error)
    return (
      <CompanyShell>
        <ErrorView message={error} />
      </CompanyShell>
    );
  if (!data)
    return (
      <CompanyShell>
        <Loading />
      </CompanyShell>
    );
  return <Wizard theaterId={props.theaterId} companyName={data.theater.name} />;
}

function Wizard(props: { theaterId?: string; companyName?: string }) {
  const { me, reload } = useSession();
  const wide = useMedia("(min-width: 1200px)");
  const isNew = !props.theaterId;
  const steps: StepId[] = isNew ? ["company", "show", "rehearsals", "staff"] : ["show", "rehearsals", "staff"];
  const needName = !me.user.name?.trim();

  const [index, setIndex] = useState(0);
  const [company, setCompany] = useState(props.companyName ?? "");
  const [yourName, setYourName] = useState("");
  const [yourTitle, setYourTitle] = useState("");
  const [theaterId, setTheaterId] = useState(props.theaterId);
  const [plan, setPlanState] = useState<ShowPlan>(emptyPlan);
  const setPlan = (p: ShowPlan) => {
    setPlanState(p);
    setError(undefined);
  };
  const [showId, setShowId] = useState<string>();
  const [rows, setRows] = useState<StaffRow[]>([blankRow()]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const step = steps[index]!;
  const go = (i: number) => {
    setError(undefined);
    setIndex(i);
    window.scrollTo(0, 0);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showBody = (): CreateShowBody => ({
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
    creatorTitle: "Director",
  });

  const next = () => {
    if (step === "company") {
      if (!company.trim()) return setError("Add your company or group name.");
      if (needName && !yourName.trim()) return setError("Add your name so your cast knows who is calling them.");
      if (theaterId) return go(index + 1);
      return void run(async () => {
        if (needName) await api.updateName(yourName.trim());
        const theater = await api.createTheater(company.trim(), yourTitle.trim() || undefined);
        setTheaterId(theater.theaterId);
        await reload();
        go(index + 1);
      });
    }
    if (step === "show") {
      if (!plan.name.trim()) return setError("Add the show title.");
      const bad = checkPlanDates(plan, { needOpening: true });
      if (bad) return setError(bad);
      return go(index + 1);
    }
    if (step === "rehearsals") {
      const bad = checkSlots(plan) ?? checkPlanDates(plan, { needOpening: true });
      if (bad) return setError(bad);
      return void run(async () => {
        const body = showBody();
        if (showId) {
          const { creatorTitle: _c, ...update } = body;
          await api.updateShow(showId, update);
        } else {
          const show = await api.createShow(theaterId!, body);
          setShowId(show.showId);
        }
        await reload();
        go(index + 1);
      });
    }
    // Staff: send the filled rows, then open the show.
    const filled = rows.filter((r) => r.email.trim() || r.name.trim());
    const badRow = filled.find((r) => !validEmail(r.email));
    if (badRow) return setError(`Check the email for ${badRow.name.trim() || "the row you started"}.`);
    void run(async () => {
      const left = [...filled];
      while (left.length) {
        const r = left[0]!;
        try {
          await api.invite(showId!, {
            email: r.email.trim(),
            name: r.name.trim() || null,
            role: "staff",
            title: r.title,
            department: departmentFor(r.title),
            characterIds: [],
          });
        } catch (err) {
          setRows(left.length ? left : [blankRow()]);
          throw new Error(`Couldn't invite ${r.email.trim()}: ${(err as Error).message}`);
        }
        left.shift();
      }
      finish();
    });
  };

  const finish = () => navigate(`/shows/${showId}/breakdown`);

  const back = () => {
    if (index === 0) navigate(theaterId ? `/c/${theaterId}` : "/");
    else go(index - 1);
  };

  const pct = ((index + 1) / steps.length) * 100;
  const companyLabel = company || props.companyName || "";
  const summary = summaryLine(plan);
  const oneLine = [companyLabel, plan.name, plan.venue].filter((s) => s.trim()).join(" · ");
  const nextLabel = step === "staff" ? (rows.some((r) => r.email.trim()) ? "Send invites and finish" : "Finish") : "Next";

  return (
    <CompanyShell context={theaterId ? companyLabel : undefined}>
      <main className="co-wizard">
        <form
          className="co-wizard-main"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) next();
          }}
          noValidate
        >
          <span className="co-step">
            Step {index + 1} of {steps.length} · {STEP_NAME[step]}
          </span>
          <div className="progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1}>
            <span style={{ width: `${pct}%` }} />
          </div>
          {!wide && oneLine && index > 0 && <span className="co-oneline">{oneLine}</span>}
          <h1 className="co-h1">{HEADING[step]}</h1>
          <p className="co-sub">{SUB[step]}</p>

          {step === "company" && (
            <div className="stack">
              <label className="field">
                Company or group name
                <input
                  type="text"
                  value={company}
                  maxLength={120}
                  autoFocus
                  disabled={!!theaterId}
                  placeholder="Maplewood Players"
                  onChange={(e) => setCompany(e.target.value)}
                />
                {theaterId && <span className="hint">Created. You can add more shows to it from company home.</span>}
              </label>
              {needName && (
                <label className="field">
                  Your name
                  <input type="text" value={yourName} maxLength={100} autoComplete="name" onChange={(e) => setYourName(e.target.value)} />
                </label>
              )}
              <label className="field">
                Your title
                <span className="hint">How the company knows you, e.g. Artistic director or Board president.</span>
                <input
                  type="text"
                  value={yourTitle}
                  maxLength={60}
                  disabled={!!theaterId}
                  placeholder="Artistic director"
                  onChange={(e) => setYourTitle(e.target.value)}
                />
              </label>
            </div>
          )}

          {step === "show" && (
            <div className="stack">
              <ShowFields plan={plan} onChange={setPlan} autoFocus />
              <DateFields plan={plan} onChange={setPlan} />
              <span className="co-hint">You will be listed as the director. You can change any of this later in show settings.</span>
            </div>
          )}

          {step === "rehearsals" && (
            <div className="stack">
              <RehearsalFields plan={plan} onChange={setPlan} />
              <div className="co-dates">
                <PlanInput plan={plan} onChange={setPlan} field="techStart" type="date" label="Tech week starts" />
              </div>
              <span className="co-summary">{summary}</span>
              <span className="co-hint">Tap a date on the calendar to skip it.</span>
              {!wide && <MonthCalendar hideSummary plan={plan} onChange={setPlan} />}
            </div>
          )}

          {step === "staff" && (
            <div className="stack">
              <div>
                {rows.map((r, i) => (
                  <StaffRowFields
                    key={i}
                    row={r}
                    onChange={(row) => setRows(rows.map((x, j) => (j === i ? row : x)))}
                    onRemove={rows.length > 1 ? () => setRows(rows.filter((_, j) => j !== i)) : undefined}
                  />
                ))}
              </div>
              <button type="button" className="btn btn-dashed btn-sm" style={{ alignSelf: "flex-start", minHeight: 40 }} onClick={() => setRows([...rows, blankRow("Assistant director")])}>
                + Add someone
              </button>
              <span className="co-hint">
                These people run this show only. Company admins, who see every show, are added from your company home. Cast come later from the People page.
              </span>
            </div>
          )}

          <FormError error={error} />
          <div className="co-actions">
            {(index > 0 || !isNew) && step !== "staff" && (
              <button type="button" className="btn btn-outline" onClick={back} disabled={busy}>
                {index === 0 ? "Cancel" : "Back"}
              </button>
            )}
            {step === "staff" && (
              <button type="button" className="btn btn-outline" onClick={finish} disabled={busy}>
                Skip for now
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving..." : nextLabel}
            </button>
          </div>
        </form>

        {wide && (
          <aside className="co-wizard-side" aria-label="Preview">
            <PlaybillCard company={companyLabel} show={plan.name} venue={[plan.venue, plan.address].filter((s) => s.trim()).join(", ")} />
            <MonthCalendar plan={plan} onChange={step === "rehearsals" ? setPlan : undefined} />
          </aside>
        )}
      </main>
    </CompanyShell>
  );
}

function StaffRowFields(props: { row: StaffRow; onChange: (row: StaffRow) => void; onRemove?: () => void }) {
  const { row } = props;
  return (
    <div className="co-staff-row">
      <div className="co-staff-inputs">
        <input
          type="email"
          aria-label="Email"
          placeholder="name@example.com"
          value={row.email}
          autoComplete="off"
          onChange={(e) => props.onChange({ ...row, email: e.target.value })}
        />
        <input type="text" aria-label="Name" placeholder="Name" value={row.name} maxLength={100} onChange={(e) => props.onChange({ ...row, name: e.target.value })} />
        {props.onRemove ? (
          <button type="button" className="link-btn" onClick={props.onRemove}>
            Remove
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="chips" role="group" aria-label="Role on the show">
        {STAFF_ROLES.map((t) => (
          <button key={t} type="button" className="co-pill" aria-pressed={row.title === t} onClick={() => props.onChange({ ...row, title: t })}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
