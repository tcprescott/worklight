import type { ShowPageProps } from "../../App";

export function Breakdown(props: ShowPageProps) {
  return <p>{props.view.show.name}: Breakdown (to build)</p>;
}
