"""Measurement forms: a person's sizes and body measurements, plus their costume needs for one show.

Measurements belong to the person, so they carry over to their next show. The person themselves and anyone
with costume access on a show they're in can see and change them; nobody else can, staff included."""

from typing import Annotated

from pydantic import Field

from worklight.ids import now_iso
from worklight.models import CostumeNeeds, Measurements, Model, ShowRole, User
from worklight.services.base import Ctx, Forbidden, NotFound, ShowAccess, optional_text, readable_show
from worklight.services.photo_uploads import Photo, check_photo_ids, drop_photos, photo_views
from worklight.services.wardrobe import edit_kinds

# The 16 numbered measurements, in the order of the sheet's diagram.
NUMBERED = (
    "head",
    "neck",
    "chest",
    "underbust",
    "waist",
    "hip",
    "below_knee",
    "inseam",
    "outseam",
    "nape_to_waist",
    "nape_to_floor",
    "nape_to_shoulder",
    "to_elbow",
    "to_wrist",
    "across_shoulders",
    "waist_to_floor",
)
SIZES = ("height", "weight", "shoe", "suit_dress", "shirt", "trouser", "bra", "hat")

Inches = Annotated[float, Field(gt=0, le=150)]
Size = optional_text(40)


def _access(ctx: Ctx, user: User, show_id: str, person_id: str) -> tuple[ShowAccess, ShowRole]:
    """Returns the access and the person's role in the show, or refuses."""
    access = readable_show(ctx, show_id, user)
    person = ctx.store.get_membership(show_id, person_id)
    if not person:
        raise NotFound("That person isn't in this show")
    if person_id != user.user_id and "costume" not in edit_kinds(access):
        raise Forbidden("Only the person and people with costume access can see measurements")
    return access, person.role


class Needs(Model):
    needs: str | None = None
    photos: list[Photo] = []
    updated_at: str | None = None


class MeasurementSheet(Model):
    user_id: str
    name: str | None = None
    role: ShowRole
    # The characters they play in this show.
    parts: list[str] = []
    measurements: Measurements
    needs: Needs
    # How many of the 16 numbered measurements are filled in.
    measured: int
    sizes_filled: int
    updated_by_name: str | None = None
    can_edit: bool


def _sheet(ctx: Ctx, access: ShowAccess, user: User, person_id: str, role: ShowRole) -> MeasurementSheet:
    person = ctx.store.get_user(person_id)
    m = ctx.store.get_measurements(person_id) or Measurements(user_id=person_id)
    needs = ctx.store.get_costume_needs(access.show.show_id, person_id)
    by = ctx.store.get_user(m.updated_by) if m.updated_by and m.updated_by != person_id else None
    part = ctx.store.load_show(access.show.show_id)
    return MeasurementSheet(
        user_id=person_id,
        name=person.name if person else None,
        role=role,
        parts=[c.name for c in part.characters if person_id in c.cast_user_ids],
        measurements=m,
        needs=Needs(
            needs=needs.needs if needs else None,
            photos=photo_views(ctx, access.show.theater_id, needs.photo_ids) if needs else [],
            updated_at=needs.updated_at if needs else None,
        ),
        measured=sum(1 for f in NUMBERED if getattr(m, f) is not None),
        sizes_filled=sum(1 for f in SIZES if getattr(m, f) is not None),
        updated_by_name=(by.name or by.email) if by else None,
        can_edit=access.show.status != "archived" or person_id == user.user_id,
    )


def get_sheet(ctx: Ctx, user: User, show_id: str, person_id: str) -> MeasurementSheet:
    access, role = _access(ctx, user, show_id, person_id)
    return _sheet(ctx, access, user, person_id, role)


class SaveSheetBody(Model):
    """Leave a field out to keep it; send null to clear it."""

    height: Size = None  # type: ignore[valid-type]
    weight: Size = None  # type: ignore[valid-type]
    shoe: Size = None  # type: ignore[valid-type]
    suit_dress: Size = None  # type: ignore[valid-type]
    shirt: Size = None  # type: ignore[valid-type]
    trouser: Size = None  # type: ignore[valid-type]
    bra: Size = None  # type: ignore[valid-type]
    hat: Size = None  # type: ignore[valid-type]
    head: Inches | None = None
    neck: Inches | None = None
    chest: Inches | None = None
    underbust: Inches | None = None
    waist: Inches | None = None
    hip: Inches | None = None
    below_knee: Inches | None = None
    inseam: Inches | None = None
    outseam: Inches | None = None
    nape_to_waist: Inches | None = None
    nape_to_floor: Inches | None = None
    nape_to_shoulder: Inches | None = None
    to_elbow: Inches | None = None
    to_wrist: Inches | None = None
    across_shoulders: Inches | None = None
    waist_to_floor: Inches | None = None
    notes: optional_text(1000) = None  # type: ignore[valid-type]
    # For this show only.
    needs: optional_text(2000) = None  # type: ignore[valid-type]
    needs_photo_ids: list[str] | None = Field(default=None, max_length=20)


def save_sheet(ctx: Ctx, user: User, show_id: str, person_id: str, body: SaveSheetBody) -> MeasurementSheet:
    access, role = _access(ctx, user, show_id, person_id)
    if person_id != user.user_id:
        access.require_open()
    fields = body.model_fields_set
    stamp = now_iso()
    person_fields = fields & {*SIZES, *NUMBERED, "notes"}
    if person_fields:
        m = ctx.store.get_measurements(person_id) or Measurements(user_id=person_id)
        update: dict[str, object] = {f: getattr(body, f) for f in person_fields}
        for f in NUMBERED:
            if isinstance(update.get(f), float):
                # Quarter inches are as fine as a tape measure reads.
                update[f] = round(float(update[f]) * 4) / 4  # type: ignore[arg-type]
        ctx.store.put_measurements(
            m.model_copy(update={**update, "updated_at": stamp, "updated_by": user.user_id})
        )
    if fields & {"needs", "needs_photo_ids"}:
        old = ctx.store.get_costume_needs(show_id, person_id)
        photo_ids = (
            check_photo_ids(body.needs_photo_ids)
            if body.needs_photo_ids is not None
            else (old.photo_ids if old else [])
        )
        ctx.store.put_costume_needs(
            CostumeNeeds(
                show_id=show_id,
                user_id=person_id,
                needs=body.needs if "needs" in fields else (old.needs if old else None),
                photo_ids=photo_ids,
                updated_at=stamp,
            )
        )
        if old:
            drop_photos(ctx, access.show.theater_id, [p for p in old.photo_ids if p not in photo_ids])
    return _sheet(ctx, access, user, person_id, role)


class SheetRow(Model):
    user_id: str
    name: str | None = None
    role: ShowRole
    parts: list[str] = []
    measured: int
    sizes_filled: int
    has_notes: bool = False
    has_needs: bool = False
    updated_at: str | None = None


def list_sheets(ctx: Ctx, user: User, show_id: str) -> list[SheetRow]:
    """Everyone in the cast, with how far along their form is. Costume access only."""
    access = readable_show(ctx, show_id, user)
    if "costume" not in edit_kinds(access):
        raise Forbidden("Only people with costume access can see measurements")
    part = ctx.store.load_show(show_id)
    people = [m for m in part.members if m.role == "cast"]
    ids = [m.user_id for m in people]
    names = {u.user_id: u.name for u in ctx.store.get_users(ids)}
    sheets = {m.user_id: m for m in ctx.store.get_many_measurements(ids)}
    needs = {n.user_id: n for n in ctx.store.list_costume_needs(show_id)}
    rows = []
    for p in people:
        m = sheets.get(p.user_id)
        rows.append(
            SheetRow(
                user_id=p.user_id,
                name=names.get(p.user_id),
                role=p.role,
                parts=[c.name for c in part.characters if p.user_id in c.cast_user_ids],
                measured=sum(1 for f in NUMBERED if m and getattr(m, f) is not None),
                sizes_filled=sum(1 for f in SIZES if m and getattr(m, f) is not None),
                has_notes=bool(m and m.notes),
                has_needs=bool(p.user_id in needs and (needs[p.user_id].needs or needs[p.user_id].photo_ids)),
                updated_at=m.updated_at if m else None,
            )
        )
    order = {c.char_id: i for i, c in enumerate(part.characters)}
    first_part = {
        p.user_id: min(
            (order[c.char_id] for c in part.characters if p.user_id in c.cast_user_ids), default=999
        )
        for p in people
    }
    rows.sort(key=lambda r: (first_part[r.user_id], (r.name or "").lower()))
    return rows
