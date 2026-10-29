import type { ShowPageProps } from "../../App";

export function MyCalls(props: ShowPageProps) {
  return <p>{props.view.show.name}: MyCalls (to build)</p>;
}
