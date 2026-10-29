import type { ShowPageProps } from "../../App";

export function ShowSettings(props: ShowPageProps) {
  return <p>{props.view.show.name}: ShowSettings (to build)</p>;
}
