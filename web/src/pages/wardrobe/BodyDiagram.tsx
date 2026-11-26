/** Front and back outline with the 16 numbered measurement lines, like the paper sheet's diagram. The
 * active number is drawn heavier; tapping a number picks it. */

// Half of a figure's outline, from the neck down the left side and back up the inside of the leg,
// as (x offset from centre, y). Mirrored for the right side.
const HALF: [number, number][] = [
  [-5, 38],
  [-5, 45],
  [-22, 52],
  [-30, 60],
  [-33, 100],
  [-36, 140],
  [-34, 150],
  [-28, 148],
  [-26, 104],
  [-21, 74],
  [-16, 104],
  [-20, 130],
  [-18, 200],
  [-13, 262],
  [-15, 270],
  [-3, 270],
  [-3, 154],
  [0, 150],
];

function outline(cx: number): string {
  const left = HALF.map(([x, y]) => `${cx + x},${y}`);
  const right = [...HALF].reverse().map(([x, y]) => `${cx - x},${y}`);
  return `M${left.join(" L")} L${right.join(" L")} Z`;
}

type Shape = { n: number; d: string; label: [number, number] };

const F = 60; // front figure centre
const B = 180; // back figure centre

const SHAPES: Shape[] = [
  { n: 1, d: `M${F - 12},24 H${F + 12}`, label: [F + 18, 27] },
  { n: 2, d: `M${F - 7},44 H${F + 7}`, label: [F + 12, 47] },
  { n: 3, d: `M${F - 22},66 H${F + 22}`, label: [F + 38, 69] },
  { n: 4, d: `M${F - 20},82 H${F + 20}`, label: [F + 38, 85] },
  { n: 5, d: `M${F - 16},104 H${F + 16}`, label: [F + 38, 107] },
  { n: 6, d: `M${F - 20},130 H${F + 20}`, label: [F + 38, 133] },
  { n: 7, d: `M${F - 17},208 H${F - 4}`, label: [F - 30, 212] },
  { n: 8, d: `M${F - 5},154 V268`, label: [F - 2, 186] },
  { n: 9, d: `M${B + 22},104 V268`, label: [B + 27, 200] },
  { n: 10, d: `M${B},46 V104`, label: [B + 4, 80] },
  { n: 11, d: `M${B - 6},46 V268`, label: [B - 16, 200] },
  { n: 12, d: `M${B},45 L${B + 22},52`, label: [B + 8, 40] },
  { n: 13, d: `M${B + 22},52 L${B + 31},100`, label: [B + 36, 82] },
  { n: 14, d: `M${B + 31},100 L${B + 35},140`, label: [B + 38, 128] },
  { n: 15, d: `M${B - 22},56 H${B + 22}`, label: [B - 34, 60] },
  { n: 16, d: `M${F + 14},104 L${F + 16},268`, label: [F + 22, 240] },
];

export function BodyDiagram(props: { active?: number; done?: Set<number>; onPick?: (n: number) => void; compact?: boolean }) {
  return (
    <svg
      className={props.compact ? "wr-body compact" : "wr-body"}
      viewBox="0 0 240 280"
      role="img"
      aria-label={props.active ? `Body outline showing measurement ${props.active}` : "Body outline with numbered measurements"}
    >
      <circle cx={F} cy={26} r={12} className="wr-fig" />
      <path d={outline(F)} className="wr-fig" />
      <circle cx={B} cy={26} r={12} className="wr-fig" />
      <path d={outline(B)} className="wr-fig" />
      {SHAPES.map((s) => {
        const on = s.n === props.active;
        const done = props.done?.has(s.n);
        const cls = `wr-line${on ? " on" : ""}${done ? " done" : ""}${props.active && !on ? " dim" : ""}`;
        return (
          <g key={s.n} className={cls} onClick={props.onPick ? () => props.onPick?.(s.n) : undefined}>
            <path d={s.d} />
            <text x={s.label[0]} y={s.label[1]}>
              {s.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
