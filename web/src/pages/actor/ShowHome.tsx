import type { ShowPageProps } from "../../App";

export function ShowHome(props: ShowPageProps) {
  return <p>{props.view.show.name}: ShowHome (to build)</p>;
}
