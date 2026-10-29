import type { ShowPageProps } from "../../App";
import { StaffShell } from "../../shell";

export function CallboardPage(props: ShowPageProps) {
  return (
    <StaffShell view={props.view} current="callboard">
      <div className="page">Callboard</div>
    </StaffShell>
  );
}
