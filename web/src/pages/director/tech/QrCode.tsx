import { useMemo } from "react";
import { create } from "qrcode";

/** A real, scannable QR code drawn as one SVG path (crisp at any size, prints sharp). */
export function QrCode(props: { value: string; size: number; label?: string; className?: string }) {
  const { path, n } = useMemo(() => {
    const qr = create(props.value, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const quiet = 2;
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    return { path: d, n: size + quiet * 2 };
  }, [props.value]);
  return (
    <svg
      className={props.className}
      viewBox={`0 0 ${n} ${n}`}
      width={props.size}
      height={props.size}
      role="img"
      aria-label={props.label ?? "Check-in code"}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#1e1a16" />
    </svg>
  );
}
