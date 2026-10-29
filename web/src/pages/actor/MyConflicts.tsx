import type { ShowPageProps } from "../../App";

export function MyConflicts(props: ShowPageProps) {
  return <p>{props.view.show.name}: MyConflicts (to build)</p>;
}
