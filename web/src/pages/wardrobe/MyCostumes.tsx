import { api } from "../../api";
import { shortDate, time12 } from "../../lib/dates";
import { Link } from "../../router";
import type { MyItems, ShowView } from "../../types";
import { Icon } from "../../ui";
import { useAsync } from "../../useAsync";
import { Thumb } from "./PhotoStrip";
import "./wardrobe.css";

/** On the actor's Show page: what they wear and carry, scene by scene, plus their measurement form.
 * Cast don't see status, where things come from or what they cost. */
export function MyCostumes(props: { view: ShowView }) {
  const view = props.view;
  const showId = view.show.showId;
  const archived = view.show.status === "archived";
  const cast = view.role === "cast";
  const { data } = useAsync<MyItems | undefined>(
    () => (cast ? api.myItems(showId).catch(() => undefined) : Promise.resolve(undefined)),
    [showId, cast],
  );
  const tracker = view.role !== "staff" && (view.costumeAccess || view.propsAccess);

  if (!cast && !tracker) return null;
  return (
    <>
      <div className="actor-section-head">
        <h2>{cast ? "Your costumes and props" : "Costumes and props"}</h2>
        {data && data.items.length > 0 && <span className="actor-unread-count">{data.items.length}</span>}
      </div>
      <div className="actor-section stack-sm">
        {tracker && (
          <Link to={`/shows/${showId}/costumes`} className="actor-todo">
            <span className="actor-todo-text">
              <strong>Open the tracker</strong>
              <span>
                You have {view.costumeAccess && view.propsAccess ? "costume and props" : view.costumeAccess ? "costume" : "props"} access for this
                show.
              </span>
            </span>
            <Icon name="right" />
          </Link>
        )}
        {cast && data && (
          <>
            {!archived && (
              <Link to={`/shows/${showId}/measurements`} className={data.measured < 16 ? "actor-todo" : "actor-todo done"}>
                <Icon name="ruler" />
                <span className="actor-todo-text">
                  <strong>{data.measured === 0 ? "Send your measurements" : data.measured < 16 ? "Finish your measurements" : "Your measurements"}</strong>
                  <span>
                    {data.measured === 0
                      ? "The costume team needs them. It takes about 10 minutes with a helper and a tape."
                      : data.measured < 16
                        ? `${data.measured} of 16 in. Fill in the rest when you can.`
                        : `All 16 in${data.measurementsUpdatedAt ? `, updated ${shortDate(data.measurementsUpdatedAt.slice(0, 10))}` : ""}.`}
                  </span>
                </span>
                <Icon name="right" />
              </Link>
            )}
            {data.nextFitting && (
              <div className="wr-fit-note">
                <Icon name="hanger" size={18} />
                <span>
                  <strong>Costume fitting</strong> {shortDate(data.nextFitting.date)}, {time12(data.nextFitting.start)} to{" "}
                  {time12(data.nextFitting.end)}
                </span>
              </div>
            )}
            {data.items.length === 0 ? (
              <div className="actor-empty">
                <strong>Nothing listed for you yet</strong>
                What you wear and carry shows up here, scene by scene, once the costume and props team adds it.
              </div>
            ) : (
              <MyByScene data={data} />
            )}
          </>
        )}
      </div>
    </>
  );
}

function MyByScene(props: { data: MyItems }) {
  const { data } = props;
  // Scene by scene, but a run of scenes with the same things shares one heading: "Scenes 1.1, 2.2, 3.2".
  const groups: { key: string; scenes: MyItems["scenes"]; items: MyItems["items"] }[] = [];
  let lastKey: string | undefined;
  for (const s of data.scenes) {
    const items = data.items.filter((i) => i.sceneIds.includes(s.sceneId));
    const key = items.map((i) => i.itemId).join();
    const prev = groups[groups.length - 1];
    if (prev && key === lastKey) prev.scenes.push(s);
    else groups.push({ key: s.sceneId, scenes: [s], items });
    lastKey = key;
  }
  const title = (g: (typeof groups)[number]) =>
    g.scenes.length === 0
      ? "Whole show"
      : g.scenes.length === 1
        ? `Scene ${g.scenes[0]!.number} ${g.scenes[0]!.name}`
        : `Scenes ${g.scenes.map((s) => s.number).join(", ")}`;
  const loose = data.items.filter((i) => i.sceneIds.length === 0);
  if (loose.length) groups.push({ key: "all", scenes: [], items: loose });
  return (
    <div className="wr-mine">
      {groups.map((g) => (
        <section key={g.key} className="wr-mine-scene">
          <h3 className="caps">{title(g)}</h3>
          {g.items.map((i) => (
            <div key={i.itemId} className="wr-item static">
              <Thumb photos={i.photos ?? []} kind={i.kind} />
              <span className="wr-item-body">
                <span className="wr-item-name">{i.name}</span>
                <span className="wr-item-meta">
                  {i.kind === "costume" ? "Costume" : "Prop"}
                  {i.characters.length > 0 && ` · ${i.characters.join(", ")}`}
                </span>
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
