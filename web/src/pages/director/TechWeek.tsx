import type { ShowPageProps } from "../../App";
import { StaffShell } from "../../shell";

export function TechWeek(props: ShowPageProps) {
  return (
    <StaffShell view={props.view} current="tech">
      <div className="page">TechWeek</div>
    </StaffShell>
  );
}
