import type { ShowPageProps } from "../../App";
import { StaffShell } from "../../shell";

export function Schedule(props: ShowPageProps) {
  return (
    <StaffShell view={props.view} current="schedule">
      <div className="page">Schedule</div>
    </StaffShell>
  );
}
