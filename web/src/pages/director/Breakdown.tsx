import { useCallback, useState } from "react";
import type { ShowPageProps } from "../../App";
import { useIsPhone } from "../../lib/useMedia";
import { Link, navigate } from "../../router";
import { StaffShell } from "../../shell";
import type { Act, Scene } from "../../types";
import { ErrorView, Loading, useToast } from "../../ui";
import { ActDialog } from "./breakdown/ActDialog";
import { CharactersDialog } from "./breakdown/CharactersDialog";
import { FillInPhone, FillInWeb, type FillInProps } from "./breakdown/FillIn";
import { SceneDialog } from "./breakdown/SceneDialog";
import { TracksPhone, TracksWeb, type TracksProps } from "./breakdown/Tracks";
import { useBreakdown } from "./breakdown/useBreakdown";
import "./staff-pages.css";

type Open =
  | { kind: "scene"; scene?: Scene; actId?: string }
  | { kind: "act"; act?: Act }
  | { kind: "chars"; charId?: string };

export function Breakdown(props: ShowPageProps) {
  const { show } = props.view;
  const showId = show.showId;
  const phone = useIsPhone();
  const tracks = props.sub === "tracks";
  const readOnly = show.status === "archived";
  const [toast, showToast] = useToast();
  const data = useBreakdown(showId, showToast);
  const [open, setOpen] = useState<Open>();
  const [onlyIn, setOnlyIn] = useState(false);
  const base = `/shows/${showId}/breakdown`;

  const onSaved = useCallback(
    async (message: string) => {
      await data.reload();
      showToast(message);
    },
    [data, showToast],
  );

  const body = () => {
    if (data.error && !data.bd) return <ErrorView message={data.error} onRetry={() => void data.reload()} />;
    if (!data.bd) return <Loading />;
    const fill: FillInProps = {
      showId,
      bd: data.bd,
      on: data.on,
      readOnly,
      onlyIn,
      toggle: data.toggle,
      editScene: (scene) => setOpen({ kind: "scene", scene }),
      addScene: (actId) => setOpen({ kind: "scene", actId }),
      editAct: (act) => setOpen({ kind: "act", act }),
      openCharacters: () => setOpen({ kind: "chars" }),
      onSaved,
    };
    const tr: TracksProps = {
      bd: data.bd,
      on: data.on,
      memberMap: data.memberMap,
      readOnly,
      toggle: data.toggle,
      goFill: () => navigate(base),
      openCharacters: () => setOpen({ kind: "chars" }),
    };
    if (phone) return tracks ? <TracksPhone {...tr} /> : <FillInPhone {...fill} />;
    return tracks ? <TracksWeb {...tr} /> : <FillInWeb {...fill} />;
  };

  const hasActs = !!data.bd?.acts.length;
  const views = (
    <nav aria-label="Breakdown views" className={phone ? "segmented segmented-light segmented-block" : "segmented"}>
      <Link to={base} current={!tracks}>
        {phone ? "Fill in" : "Fill in scenes"}
      </Link>
      <Link to={`${base}/tracks`} current={tracks}>
        {phone ? "Review" : "Review character tracks"}
      </Link>
    </nav>
  );

  return (
    <StaffShell view={props.view} current="breakdown">
      {phone ? (
        <main className="sp-phone">
          {views}
          {body()}
        </main>
      ) : (
        <main className="page">
          <div className="page-head">
            <div>
              <h1 className="title">{tracks ? "Each character's track" : "Scenes"}</h1>
              <p className="lede">
                {tracks
                  ? readOnly
                    ? "One line per character, scenes in order. Gaps show who has free time."
                    : "One line per person, scenes in order. Click a scene to add or remove them. Gaps show who has free time."
                  : readOnly
                    ? "One card per scene, with who's in it."
                    : "One card per scene. Tap a name to add or remove that character."}
              </p>
            </div>
            <div className="row">
              {data.bd && (
                <button className="btn" onClick={() => setOpen({ kind: "chars" })}>
                  {readOnly ? "Cast list" : "Characters"}
                </button>
              )}
              {!tracks && !!data.bd?.scenes.length && (
                <button className="btn" aria-pressed={onlyIn} onClick={() => setOnlyIn(!onlyIn)}>
                  {onlyIn ? "Show everyone" : "Only who's in each scene"}
                </button>
              )}
              {!tracks && !readOnly && hasActs && (
                <button className="btn btn-primary" onClick={() => setOpen({ kind: "scene" })}>
                  Add scene
                </button>
              )}
            </div>
          </div>
          {views}
          {body()}
        </main>
      )}
      {data.bd && open?.kind === "scene" && (
        <SceneDialog
          showId={showId}
          bd={data.bd}
          minutesPerPage={show.minutesPerPage}
          scene={open.scene}
          defaultActId={open.actId}
          onClose={() => setOpen(undefined)}
          onSaved={onSaved}
        />
      )}
      {data.bd && open?.kind === "act" && (
        <ActDialog showId={showId} bd={data.bd} act={open.act} onClose={() => setOpen(undefined)} onSaved={onSaved} />
      )}
      {data.bd && open?.kind === "chars" && (
        <CharactersDialog
          showId={showId}
          bd={data.bd}
          members={data.members}
          readOnly={readOnly}
          startWith={open.charId}
          onClose={() => setOpen(undefined)}
          onSaved={onSaved}
        />
      )}
      {toast}
    </StaffShell>
  );
}
