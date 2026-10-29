import type { ShowPageProps } from "../../App";

export function GuidedSetup(props: ShowPageProps) {
  return <p>{props.view.show.name}: GuidedSetup (to build)</p>;
}
