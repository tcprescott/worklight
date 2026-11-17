import { useState, type CSSProperties } from "react";
import { formatPages } from "../../../lib/pages";
import type { Breakdown, Member } from "../../../types";
import { breakText, groupActs, key, orderedCharacters, partnersText, playerFull, playerShort, trackStats } from "./model";

export interface TracksProps {
  bd: Breakdown;
  on: Set<string>;
  memberMap: Map<string, Member>;
  readOnly: boolean;
  toggle: (sceneId: string, charId: string) => void;
  goFill: () => void;
  openCharacters: () => void;
}

function columns(bd: Breakdown) {
  return groupActs(bd).flatMap((g) => g.scenes.map((s, i) => ({ scene: s, actIndex: g.index, firstInAct: i === 0 })));
}

function Empty(props: TracksProps & { what: "scenes" | "characters" }) {
  return (
    <div className="empty">
      <p>
        {props.what === "scenes"
          ? "No scenes yet. Tracks show up here once the scenes are in."
          : "No characters yet. Add them, then each one gets a track across the scenes."}
      </p>
      {!props.readOnly &&
        (props.what === "scenes" ? (
          <button className="btn btn-primary" onClick={props.goFill}>
            Fill in scenes
          </button>
        ) : (
          <button className="btn btn-primary" onClick={props.openCharacters}>
            Add characters
          </button>
        ))}
    </div>
  );
}

/** Web: one row per character across every scene, with the selected character's details beside it. */
export function TracksWeb(props: TracksProps) {
  const { bd, on } = props;
  const cols = columns(bd);
  const chars = orderedCharacters(bd);
  const [picked, setPicked] = useState<string>();
  if (!cols.length) return <Empty {...props} what="scenes" />;
  if (!chars.length) return <Empty {...props} what="characters" />;
  const sel = chars.find((c) => c.charId === picked) ?? chars[0]!;
  const scenes = cols.map((c) => c.scene);
  const stats = trackStats(sel.charId, scenes, chars, on);
  const played = playerFull(sel, props.memberMap);
  const grid: CSSProperties = { gridTemplateColumns: `170px repeat(${cols.length}, minmax(48px, 1fr))` };
  const minWidth = 170 + cols.length * 64;

  return (
    <div className="sp-tracks-layout">
      <div className="sp-tracks">
        <div style={{ minWidth }} className="sp-tracks-inner">
          <div className="sp-tracks-row sp-tracks-headrow" style={grid}>
            <div className="caps sp-tracks-corner">Character</div>
            {cols.map((c, i) => (
              <div key={c.scene.sceneId} className={`sp-tracks-col${c.firstInAct && i > 0 ? " sp-act-line" : ""}`}>
                <span className="sp-tracks-act">{c.firstInAct ? `ACT ${c.actIndex}` : ""}</span>
                <span className="sp-tracks-num">{c.scene.number}</span>
              </div>
            ))}
          </div>
          {chars.map((ch) => {
            const isSel = ch.charId === sel.charId;
            const who = playerShort(ch, props.memberMap);
            return (
              <div key={ch.charId} className={`sp-tracks-row${isSel ? " sp-picked" : ""}`} style={grid}>
                <button className="sp-tracks-who" aria-pressed={isSel} onClick={() => setPicked(ch.charId)}>
                  <span className="sp-tracks-name">{ch.name}</span>
                  <span className={who ? "sp-tracks-player" : "sp-tracks-player sp-faint"}>{who || "Not cast"}</span>
                </button>
                {cols.map((c, i) => {
                  const here = on.has(key(c.scene.sceneId, ch.charId));
                  const prev = here && i > 0 && on.has(key(cols[i - 1]!.scene.sceneId, ch.charId));
                  const next = here && i < cols.length - 1 && on.has(key(cols[i + 1]!.scene.sceneId, ch.charId));
                  const cls = ["sp-bar", here ? "on" : "off", prev ? "join-l" : "", next ? "join-r" : ""].join(" ");
                  return (
                    <div key={c.scene.sceneId} className={`sp-tracks-cell${c.firstInAct && i > 0 ? " sp-act-line" : ""}`}>
                      <button
                        className="sp-tracks-hit"
                        aria-pressed={here}
                        aria-label={`${ch.name} in scene ${c.scene.number}${here ? ", yes" : ", no"}`}
                        disabled={props.readOnly}
                        onClick={() => {
                          setPicked(ch.charId);
                          props.toggle(c.scene.sceneId, ch.charId);
                        }}
                      >
                        <span className={cls} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <aside className="sp-track-panel" aria-live="polite">
        <div className="stack-sm sp-gap-2">
          <span className="caps">Selected</span>
          <span className="sp-panel-name">{sel.name}</span>
          <span className="sp-panel-sub">{played ? `Played by ${played}` : "Not cast yet"}</span>
        </div>
        <div className="sp-tiles">
          <div className="sp-tile">
            <span className="sp-tile-n">{stats.scenes.length}</span>
            <span className="sp-tile-l">of {scenes.length} scenes</span>
          </div>
          <div className="sp-tile">
            <span className="sp-tile-n">{formatPages(stats.eighths)}</span>
            <span className="sp-tile-l">pages on stage</span>
          </div>
        </div>
        <div className="sp-panel-sec">
          <span className="sp-panel-h">Longest break</span>
          <span className="sp-panel-v">{breakText(stats)}</span>
        </div>
        <div className="sp-panel-sec">
          <span className="sp-panel-h">Shares scenes most with</span>
          <span className="sp-panel-v">{partnersText(stats)}</span>
        </div>
      </aside>
    </div>
  );
}

/** Phone: a compact row per character; tap to see their scenes, longest break and partners. */
export function TracksPhone(props: TracksProps) {
  const { bd, on } = props;
  const cols = columns(bd);
  const chars = orderedCharacters(bd);
  const [open, setOpen] = useState<string>();
  if (!cols.length) return <Empty {...props} what="scenes" />;
  if (!chars.length) return <Empty {...props} what="characters" />;
  const scenes = cols.map((c) => c.scene);
  const grid: CSSProperties = { gridTemplateColumns: `minmax(0, 1fr) repeat(${cols.length}, minmax(5px, 16px))` };
  return (
    <div className="stack-sm">
      <div className="sp-mtrack-head" style={grid} aria-hidden="true">
        <span />
        {cols.map((c) => (
          <span key={c.scene.sceneId}>{cols.length > 12 ? "" : c.scene.number}</span>
        ))}
      </div>
      {chars.map((ch) => {
        const isOpen = open === ch.charId;
        const stats = isOpen ? trackStats(ch.charId, scenes, chars, on) : undefined;
        const who = playerShort(ch, props.memberMap);
        return (
          <button key={ch.charId} className="sp-mtrack" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : ch.charId)}>
            <span className="sp-mtrack-grid" style={grid}>
              <span className="sp-mtrack-name">{ch.name}</span>
              {cols.map((c) => (
                <span key={c.scene.sceneId} className={on.has(key(c.scene.sceneId, ch.charId)) ? "sp-mcell on" : "sp-mcell"} />
              ))}
            </span>
            {stats && (
              <span className="sp-mtrack-detail">
                <span>{who ? `Played by ${playerFull(ch, props.memberMap)}` : "Not cast yet"}</span>
                <span>
                  In {stats.scenes.length} of {scenes.length} scenes
                  {stats.scenes.length ? `: ${stats.scenes.map((s) => s.number).join(", ")}` : ""}
                </span>
                <span>Longest break: {breakText(stats)}</span>
                <span>Most often with: {partnersText(stats)}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
