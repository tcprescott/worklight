import { useRef, useState } from "react";
import { shrinkPhoto } from "../../lib/photos";
import type { Photo } from "../../types";
import { Icon } from "../../ui";

const MAX = 6;

/** Thumbnails with an Add photo button. Pictures upload as soon as they're picked; the record keeps them
 * when it's saved. */
export function PhotoStrip(props: {
  photos: Photo[];
  onChange?: (photos: Photo[]) => void;
  upload?: (blob: Blob) => Promise<Photo>;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string>();
  const [big, setBig] = useState<Photo>();
  const editable = Boolean(props.onChange && props.upload);

  const add = async (files: FileList | null) => {
    if (!files || !props.upload || !props.onChange) return;
    setError(undefined);
    const room = MAX - props.photos.length;
    const picked = [...files].slice(0, Math.max(0, room));
    if (files.length > room) setError(`Keep it to ${MAX} pictures.`);
    let current = props.photos;
    for (const f of picked) {
      setBusy((n) => n + 1);
      try {
        const photo = await props.upload(await shrinkPhoto(f));
        current = [...current, photo];
        props.onChange(current);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  if (!editable && props.photos.length === 0) return null;
  return (
    <div className="wr-photos">
      {props.label && <span className="field">{props.label}</span>}
      <div className="wr-photo-row">
        {props.photos.map((p) => (
          <span key={p.photoId} className="wr-photo">
            <button type="button" className="wr-photo-img" onClick={() => setBig(p)} aria-label="Show this picture bigger">
              <img src={p.url} alt="" loading="lazy" />
            </button>
            {editable && (
              <button
                type="button"
                className="wr-photo-x"
                aria-label="Remove this picture"
                onClick={() => props.onChange?.(props.photos.filter((x) => x.photoId !== p.photoId))}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </span>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <span key={`busy${i}`} className="wr-photo wr-photo-busy" aria-label="Uploading">
            …
          </span>
        ))}
        {editable && props.photos.length + busy < MAX && (
          <button type="button" className="wr-photo wr-photo-add" onClick={() => input.current?.click()}>
            <Icon name="camera" size={20} />
            <span>Add photo</span>
          </button>
        )}
      </div>
      {error && <span className="small error">{error}</span>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      {big && (
        <div className="wr-lightbox" role="dialog" aria-label="Picture" onClick={() => setBig(undefined)}>
          <img src={big.url} alt="" />
          <button type="button" className="btn" onClick={() => setBig(undefined)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export function Thumb(props: { photos: Photo[]; kind: "costume" | "prop" }) {
  const first = props.photos[0];
  return (
    <span className="wr-thumb" aria-hidden="true">
      {first ? <img src={first.url} alt="" loading="lazy" /> : <Icon name={props.kind === "costume" ? "hanger" : "target"} size={18} />}
    </span>
  );
}
