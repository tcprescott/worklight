"""Line notes: private notes for each actor after a run (dropped lines, paraphrases, called for line...).

Staff, and crew that staff mark as note-takers, file notes into a set for one run. The set stays a draft
until staff release it; then each actor with notes gets one email and push, and sees only their own notes.
Staff can see who has opened theirs. Actors only read: there's nothing for them to tick off or reply to.
"""

import re
from typing import Annotated

from pydantic import Field

from worklight import mailer
from worklight.ids import new_id, now_iso
from worklight.models import (
    Character,
    LineNote,
    LineNoteKind,
    LineNoteRead,
    LineNoteSet,
    Membership,
    Model,
    Scene,
    User,
)
from worklight.push import PushMessage
from worklight.services.base import (
    Conflict,
    Ctx,
    Forbidden,
    Invalid,
    IsoDate,
    NotFound,
    ShowAccess,
    maybe_text,
    optional_text,
    readable_show,
    text,
)
from worklight.services.push import deliver
from worklight.store import ShowPartition

MAX_NOTES_PER_SET = 500
KIND_LABELS: dict[LineNoteKind, str] = {
    "dropped": "Dropped line",
    "paraphrase": "Paraphrase",
    "added": "Added words",
    "called": "Called for line",
    "jumped": "Jumped cue",
    "late": "Late entrance",
    "other": "Note",
}


# ---- Who can do what ------------------------------------------------------------------------------


def _is_note_taker(access: ShowAccess) -> bool:
    m = access.membership
    return bool(m and m.role == "crew" and m.note_taker)


def can_take(access: ShowAccess) -> bool:
    return access.can("notes:release") or _is_note_taker(access)


def _taker(ctx: Ctx, show_id: str, user: User) -> ShowAccess:
    access = readable_show(ctx, show_id, user).require_open()
    if not can_take(access):
        raise Forbidden("Only staff and note-takers can take line notes")
    return access


def _editable_set(ctx: Ctx, access: ShowAccess, set_id: str) -> LineNoteSet:
    """Note-takers can change a set until it's released; staff can change it after (actors see "updated")."""
    note_set = ctx.store.get_line_note_set(access.show.show_id, set_id)
    if not note_set:
        raise NotFound("Those line notes weren't found")
    if note_set.released_at and not access.can("notes:release"):
        raise Forbidden("These notes have been released; ask staff to change them")
    return note_set


# ---- Views ----------------------------------------------------------------------------------------


class CastOption(Model):
    """Someone notes can be for: a cast member and the parts they play, in script order."""

    user_id: str
    name: str | None = None
    characters: list[str] = []
    char_ids: list[str] = []


class LineNoteView(LineNote):
    actor_name: str | None = None
    char_name: str | None = None
    # e.g. "1.2 Quince's house".
    scene_label: str | None = None
    kind_label: str
    # Changed after the set went out to the actor.
    updated_after_release: bool = False


class LineNoteSetSummary(LineNoteSet):
    taken_by_name: str | None = None
    note_count: int = 0
    actor_count: int = 0
    # The actor looking: when they first opened it.
    opened_at: str | None = None


class ActorStatus(Model):
    user_id: str
    name: str | None = None
    characters: list[str] = []
    note_count: int
    opened_at: str | None = None


class LineNotesHome(Model):
    # Staff: every set. Note-takers: sets not yet released. Cast: released sets with notes for them.
    sets: list[LineNoteSetSummary]
    can_take: bool
    can_release: bool
    # For the actor chips (takers only).
    cast: list[CastOption] = []


class LineNoteSetDetail(Model):
    set: LineNoteSetSummary
    # Cast see only their own; takers see them all.
    notes: list[LineNoteView]
    # Staff only, once released: who has opened their notes.
    actors: list[ActorStatus] = []
    can_edit: bool
    can_release: bool


def _cast(part: ShowPartition, names: dict[str, str | None]) -> list[CastOption]:
    by_user: dict[str, list[Character]] = {}
    for c in part.characters:
        for uid in c.cast_user_ids:
            by_user.setdefault(uid, []).append(c)
    members = [m for m in part.members if m.role == "cast"]
    order = {c.char_id: i for i, c in enumerate(part.characters)}
    big = len(order) + 1

    def first_part(m: Membership) -> tuple[int, str]:
        chars = by_user.get(m.user_id, [])
        return (min((order[c.char_id] for c in chars), default=big), names.get(m.user_id) or "")

    return [
        CastOption(
            user_id=m.user_id,
            name=names.get(m.user_id),
            characters=[c.name for c in by_user.get(m.user_id, [])],
            char_ids=[c.char_id for c in by_user.get(m.user_id, [])],
        )
        for m in sorted(members, key=first_part)
    ]


def _page_key(note: LineNote) -> tuple[int, str, str]:
    match = re.match(r"\d+", note.page or "")
    return (int(match.group()) if match else 1_000_000, note.page or "", note.created_at)


def _scene_label(scene: Scene | None) -> str | None:
    return f"{scene.number} {scene.name}".strip() if scene else None


def _note_views(
    notes: list[LineNote], part: ShowPartition, names: dict[str, str | None], released_at: str | None
) -> list[LineNoteView]:
    chars = {c.char_id: c for c in part.characters}
    scenes = {s.scene_id: s for s in part.scenes}
    return [
        LineNoteView(
            **n.model_dump(),
            actor_name=names.get(n.actor_id),
            char_name=chars[n.char_id].name if n.char_id in chars else None,
            scene_label=_scene_label(scenes.get(n.scene_id or "")),
            kind_label=KIND_LABELS[n.kind],
            updated_after_release=bool(released_at and n.updated_at > released_at),
        )
        for n in sorted(notes, key=_page_key)
    ]


def _summary(
    s: LineNoteSet,
    notes: list[LineNote],
    names: dict[str, str | None],
    opened_at: str | None = None,
) -> LineNoteSetSummary:
    return LineNoteSetSummary(
        **s.model_dump(),
        taken_by_name=names.get(s.created_by),
        note_count=len(notes),
        actor_count=len({n.actor_id for n in notes}),
        opened_at=opened_at,
    )


def _names(ctx: Ctx, part: ShowPartition) -> dict[str, str | None]:
    return {u.user_id: u.name for u in ctx.store.get_users({m.user_id for m in part.members})}


def get_home(ctx: Ctx, user: User, show_id: str) -> LineNotesHome:
    access = readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    names = _names(ctx, part)
    staff = access.can("notes:release")
    taker = can_take(access)
    opened = {r.set_id: r.at for r in part.line_note_reads if r.user_id == user.user_id}
    sets = []
    for s in part.line_note_sets:
        notes = [n for n in part.line_notes if n.set_id == s.set_id]
        if staff or (taker and not s.released_at):
            sets.append(_summary(s, notes, names))
        elif s.released_at:
            mine = [n for n in notes if n.actor_id == user.user_id]
            if mine:
                sets.append(_summary(s, mine, names, opened.get(s.set_id)))
    sets.sort(key=lambda s: (s.date, s.created_at), reverse=True)
    open_show = access.show.status != "archived"
    return LineNotesHome(
        sets=sets,
        can_take=taker and open_show,
        can_release=staff and open_show,
        cast=_cast(part, names) if taker else [],
    )


def get_set(ctx: Ctx, user: User, show_id: str, set_id: str) -> LineNoteSetDetail:
    """One set. An actor opening their released notes is recorded, so staff can see it was read."""
    access = readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    note_set = next((s for s in part.line_note_sets if s.set_id == set_id), None)
    staff = access.can("notes:release")
    taker = can_take(access)
    if not note_set or (not staff and not (taker and not note_set.released_at) and not note_set.released_at):
        raise NotFound("Those line notes weren't found")
    names = _names(ctx, part)
    notes = [n for n in part.line_notes if n.set_id == set_id]
    reads = {r.user_id: r.at for r in part.line_note_reads if r.set_id == set_id}
    open_show = access.show.status != "archived"
    if staff or (taker and not note_set.released_at):
        actors = []
        if staff:
            per_actor: dict[str, int] = {}
            for n in notes:
                per_actor[n.actor_id] = per_actor.get(n.actor_id, 0) + 1
            cast = {c.user_id: c for c in _cast(part, names)}
            actors = sorted(
                (
                    ActorStatus(
                        user_id=uid,
                        name=names.get(uid),
                        characters=cast[uid].characters if uid in cast else [],
                        note_count=count,
                        opened_at=reads.get(uid),
                    )
                    for uid, count in per_actor.items()
                ),
                key=lambda a: (a.name or "").lower(),
            )
        return LineNoteSetDetail(
            set=_summary(note_set, notes, names),
            notes=_note_views(notes, part, names, note_set.released_at),
            actors=actors,
            can_edit=open_show and (staff or not note_set.released_at),
            can_release=open_show and staff and not note_set.released_at,
        )
    mine = [n for n in notes if n.actor_id == user.user_id]
    if not mine:
        raise NotFound("Those line notes weren't found")
    opened_at = reads.get(user.user_id)
    if not opened_at:
        opened_at = now_iso()
        ctx.store.put_line_note_read(
            LineNoteRead(show_id=show_id, set_id=set_id, user_id=user.user_id, at=opened_at)
        )
    return LineNoteSetDetail(
        set=_summary(note_set, mine, names, opened_at),
        notes=_note_views(mine, part, names, note_set.released_at),
        can_edit=False,
        can_release=False,
    )


def my_notes(ctx: Ctx, user: User, show_id: str) -> list[LineNoteSetDetail]:
    """Every released set with notes for the person, newest first, opened as a side effect."""
    home = get_home(ctx, user, show_id)
    return [get_set(ctx, user, show_id, s.set_id) for s in home.sets if s.released_at]


# ---- Sets -----------------------------------------------------------------------------------------


class CreateSetBody(Model):
    date: IsoDate
    title: Annotated[str, text(100)]
    call_id: optional_text(40) = None  # type: ignore[valid-type]


class UpdateSetBody(Model):
    date: IsoDate | None = None
    title: maybe_text(100) = None  # type: ignore[valid-type]


def create_set(ctx: Ctx, user: User, show_id: str, body: CreateSetBody) -> LineNoteSet:
    _taker(ctx, show_id, user)
    stamp = now_iso()
    note_set = LineNoteSet(
        set_id=new_id(),
        show_id=show_id,
        date=body.date,
        title=body.title,
        call_id=body.call_id,
        created_by=user.user_id,
        created_at=stamp,
        updated_at=stamp,
    )
    ctx.store.put_line_note_set(note_set)
    return note_set


def update_set(ctx: Ctx, user: User, show_id: str, set_id: str, body: UpdateSetBody) -> LineNoteSet:
    access = _taker(ctx, show_id, user)
    note_set = _editable_set(ctx, access, set_id)
    fields = {k: getattr(body, k) for k in body.model_fields_set if getattr(body, k) is not None}
    note_set = note_set.model_copy(update={**fields, "updated_at": now_iso()})
    ctx.store.put_line_note_set(note_set)
    return note_set


def delete_set(ctx: Ctx, user: User, show_id: str, set_id: str) -> None:
    access = _taker(ctx, show_id, user)
    _editable_set(ctx, access, set_id)
    ctx.store.delete_line_note_set(show_id, set_id)


# ---- Notes ----------------------------------------------------------------------------------------


class NoteFields(Model):
    # Who it's for. Can be left out when char_id names a part with one person in it.
    actor_id: str | None = None
    char_id: str | None = None
    kind: LineNoteKind
    page: optional_text(10) = None  # type: ignore[valid-type]
    scene_id: str | None = None
    script_text: optional_text(1000) = None  # type: ignore[valid-type]
    said_text: optional_text(1000) = None  # type: ignore[valid-type]
    comment: optional_text(1000) = None  # type: ignore[valid-type]


class AddNotesBody(Model):
    notes: list[NoteFields] = Field(min_length=1, max_length=100)


class UpdateNoteBody(Model):
    actor_id: str | None = None
    char_id: str | None = None
    kind: LineNoteKind | None = None
    page: optional_text(10) = None  # type: ignore[valid-type]
    scene_id: str | None = None
    script_text: optional_text(1000) = None  # type: ignore[valid-type]
    said_text: optional_text(1000) = None  # type: ignore[valid-type]
    comment: optional_text(1000) = None  # type: ignore[valid-type]


def _resolve(part: ShowPartition, actor_id: str | None, char_id: str | None, scene_id: str | None) -> str:
    """Checks who the note is for and what it points at. Returns the actor's user id."""
    cast = {m.user_id for m in part.members if m.role == "cast"}
    char = next((c for c in part.characters if c.char_id == char_id), None) if char_id else None
    if char_id and not char:
        raise Invalid("That part isn't in this show")
    if not actor_id:
        if not char:
            raise Invalid("Say who the note is for: an actor or a part")
        players = [u for u in char.cast_user_ids if u in cast]
        if len(players) != 1:
            raise Invalid(
                f"{char.name} is played by {len(players)} people here; say which actor the note is for"
                if players
                else f"Nobody is cast as {char.name} yet"
            )
        actor_id = players[0]
    if actor_id not in cast:
        raise Invalid("Line notes can only go to cast members in this show")
    if char and actor_id not in char.cast_user_ids:
        raise Invalid(f"That actor doesn't play {char.name}")
    if scene_id and not any(s.scene_id == scene_id for s in part.scenes):
        raise Invalid("That scene isn't in this show")
    return actor_id


def add_notes(ctx: Ctx, user: User, show_id: str, set_id: str, body: AddNotesBody) -> list[LineNote]:
    access = _taker(ctx, show_id, user)
    _editable_set(ctx, access, set_id)
    part = ctx.store.load_show(show_id)
    existing = sum(1 for n in part.line_notes if n.set_id == set_id)
    if existing + len(body.notes) > MAX_NOTES_PER_SET:
        raise Invalid(f"One set can hold at most {MAX_NOTES_PER_SET} notes")
    stamp = now_iso()
    notes = []
    for f in body.notes:
        actor_id = _resolve(part, f.actor_id, f.char_id, f.scene_id)
        notes.append(
            LineNote(
                **f.model_dump(exclude={"actor_id"}),
                note_id=new_id(),
                show_id=show_id,
                set_id=set_id,
                actor_id=actor_id,
                created_by=user.user_id,
                created_at=stamp,
                updated_at=stamp,
            )
        )
    ctx.store.put_line_notes(notes)
    return notes


def _find_note(ctx: Ctx, show_id: str, set_id: str, note_id: str) -> LineNote:
    note = next((n for n in ctx.store.list_line_notes(show_id, set_id) if n.note_id == note_id), None)
    if not note:
        raise NotFound("Note not found")
    return note


def update_note(
    ctx: Ctx, user: User, show_id: str, set_id: str, note_id: str, body: UpdateNoteBody
) -> LineNote:
    access = _taker(ctx, show_id, user)
    _editable_set(ctx, access, set_id)
    note = _find_note(ctx, show_id, set_id, note_id)
    fields = body.model_fields_set
    update: dict[str, object] = {k: getattr(body, k) for k in fields}
    if "kind" in update and update["kind"] is None:
        del update["kind"]
    if "actor_id" in fields and body.actor_id is None:
        del update["actor_id"]
    merged = note.model_copy(update=update)
    part = ctx.store.load_show(show_id)
    # A new part without a new actor means "whoever plays it".
    actor = merged.actor_id if "actor_id" in update or "char_id" not in fields else None
    merged = merged.model_copy(
        update={"actor_id": _resolve(part, actor, merged.char_id, merged.scene_id), "updated_at": now_iso()}
    )
    ctx.store.put_line_notes([merged])
    return merged


def delete_note(ctx: Ctx, user: User, show_id: str, set_id: str, note_id: str) -> None:
    access = _taker(ctx, show_id, user)
    _editable_set(ctx, access, set_id)
    _find_note(ctx, show_id, set_id, note_id)
    ctx.store.delete_line_note(show_id, set_id, note_id)


# ---- Release --------------------------------------------------------------------------------------


class ReleaseResult(Model):
    set: LineNoteSet
    # Actors who got their notes (by email, push or both).
    actor_count: int


def release_set(ctx: Ctx, user: User, show_id: str, set_id: str) -> ReleaseResult:
    access = readable_show(ctx, show_id, user, "notes:release").require_open()
    show = access.show
    note_set = ctx.store.get_line_note_set(show_id, set_id)
    if not note_set:
        raise NotFound("Those line notes weren't found")
    if note_set.released_at:
        raise Conflict("These notes have already been released")
    notes = ctx.store.list_line_notes(show_id, set_id)
    if not notes:
        raise Invalid("There are no notes to release yet")
    stamp = now_iso()
    note_set = note_set.model_copy(
        update={"released_at": stamp, "released_by": user.user_id, "updated_at": stamp}
    )
    ctx.store.put_line_note_set(note_set)
    counts: dict[str, int] = {}
    for n in notes:
        counts[n.actor_id] = counts.get(n.actor_id, 0) + 1
    url = ctx.link(f"/shows/{show_id}/notes/{set_id}")
    sender = user.name or user.email
    for person in ctx.store.get_users(counts):
        count = counts[person.user_id]
        email = mailer.line_notes_email(
            to=person.email,
            show_name=show.name,
            title=note_set.title,
            date=note_set.date,
            count=count,
            sender=sender,
            url=url,
        )
        message = PushMessage(
            title=f"{show.name} · Line notes",
            body=f"{count} note{'s' if count != 1 else ''} from {note_set.title}",
            url=url,
            tag=f"linenotes-{set_id}",
        )
        deliver(ctx, person, "notices", email, message)
    return ReleaseResult(set=note_set, actor_count=len(counts))
