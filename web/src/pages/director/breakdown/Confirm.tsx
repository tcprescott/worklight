import { useState, type ReactNode } from "react";
import { Dialog, FormError } from "../../../ui";

/** A yes/no dialog for things that can't be undone. */
export function Confirm(props: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <div className="sp-confirm-body">{props.children}</div>
      <FormError error={error} />
      <div className="dialog-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await props.onConfirm();
              props.onClose();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Working..." : props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
