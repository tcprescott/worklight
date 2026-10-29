import { useState } from "react";
import { longDate } from "../../../lib/dates";
import type { TechModel } from "../TechWeek";
import { Confirm } from "../breakdown/Confirm";
import { doorUrl } from "./lib";
import { QrCode } from "./QrCode";

/** "New code" behind a confirm, because it retires the printed sign. */
export function NewCodeButton(props: { m: TechModel; className?: string }) {
  const [open, setOpen] = useState(false);
  if (props.m.readOnly) return null;
  return (
    <>
      <button type="button" className={props.className ?? "link-btn"} onClick={() => setOpen(true)}>
        New code
      </button>
      {open && (
        <Confirm title="Make a new code?" confirmLabel="Make a new code" onConfirm={props.m.rotate} onClose={() => setOpen(false)}>
          <p className="lede">
            The sign at the stage door, and any photo of it, stops working. Print the new sign and put it up before call.
          </p>
        </Confirm>
      )}
    </>
  );
}

/** The card beside tonight's sign-in on web. */
export function SignCard(props: { m: TechModel }) {
  const { m } = props;
  return (
    <aside className="tech-sign" aria-label="Stage door sign">
      <span className="caps">Stage door sign</span>
      <QrCode value={doorUrl(m.showId, m.att.doorCode)} size={200} className="tech-sign-qr" label="Stage door check-in code" />
      <span className="tech-sign-title">Scan to sign in</span>
      <span className="small muted">Print this for the stage door, or put it up on a tablet.</span>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        Print sign-in sheet
      </button>
      <NewCodeButton m={m} />
    </aside>
  );
}

/** Only visible when printing: the sign, big. */
export function PrintSheet(props: { m: TechModel }) {
  const { m } = props;
  const url = doorUrl(m.showId, m.att.doorCode);
  return (
    <section className="tech-print" aria-hidden="true">
      <div className="tech-print-show">{m.showName}</div>
      <h1>Scan to sign in</h1>
      <QrCode value={url} size={460} label="Stage door check-in code" />
      <p>Point your phone's camera at the code. It checks you in for tonight.</p>
      <p className="tech-print-small">
        {m.tonight ? `${longDate(m.tonight.date)} · ` : ""}No phone? Tell the stage manager you're here.
      </p>
    </section>
  );
}
