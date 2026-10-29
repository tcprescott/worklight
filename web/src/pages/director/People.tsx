import type { ShowPageProps } from "../../App";

export function People(props: ShowPageProps) {
  return <p>{props.view.show.name}: People (to build)</p>;
}
