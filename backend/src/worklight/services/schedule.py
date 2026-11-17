"""The rehearsal schedule: calls with timed scene blocks, who each call needs, conflict warnings, scene
suggestions, and publishing.

Staff edit a working copy of each call. Publishing a range copies the working copy to the published one,
which is all that cast and crew (and other shows) ever see."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

from pydantic import Field, model_validator

from worklight import clock
from worklight.calendar import availability_on, show_days
from worklight.ids import new_id, now_iso
from worklight.models import (
    Block,
    Call,
    CallContent,
    CallGroup,
    CallType,
    DateConflict,
    Membership,
    Model,
    Scene,
    Show,
    User,
    WeeklyConflict,
)
from worklight.services.base import (
    Ctx,
    Invalid,
    IsoDate,
    NotFound,
    OptionalTime,
    Time,
    editable_show,
    optional_text,
    readable_show,
)
from worklight.services.breakdown import scene_minutes
from worklight.store import ShowPartition

# How much each kind of conflict counts against a scene when ranking what to rehearse.
WEIGHTS = {"hard": 10, "elsewhere": 10, "soft": 3, "partial": 1}


# ---- Times ----------------------------------------------------------------------------------------


def to_minutes(hhmm: str) -> int:
    hour, minute = hhmm.split(":")
    return int(hour) * 60 + int(minute)


def from_minutes(total: int) -> str:
    total = max(0, min(total, 24 * 60 - 1))
    return f"{total // 60:02d}:{total % 60:02d}"


def _overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return a_start < b_end and b_start < a_end


@dataclass(frozen=True)
class TimedSlice:
    block: Block
    start: str
    end: str


def timed_blocks(content: CallContent) -> list[TimedSlice]:
    """Blocks with their times: each starts where the one before ends, unless it has its own start."""
    out = []
    cursor = to_minutes(content.start)
    for block in content.blocks:
        begin = to_minutes(block.start) if block.start else cursor
        out.append(TimedSlice(block, from_minutes(begin), from_minutes(begin + block.minutes)))
        cursor = begin + block.minutes
    return out


def content_of(call: Call) -> CallContent:
    return CallContent.model_validate(call.model_dump(include=set(CallContent.model_fields)))


# ---- Who a call needs ------------------------------------------------------------------------------


@dataclass
class Called:
    """One person's part of a call: when they're needed and for what."""

    start: str
    end: str
    scene_ids: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    # Called for the whole call rather than particular blocks.
    whole: bool = False

    def widen(self, start: str, end: str) -> None:
        self.start = min(self.start, start)
        self.end = max(self.end, end)


@dataclass
class ShowCast:
    """What it takes to work out who's in what, loaded once per show."""

    show: Show
    members: dict[str, Membership]
    scenes: dict[str, Scene]
    # scene id -> user ids of everyone playing a character in it
    scene_people: dict[str, list[str]]
    # scene id -> user id -> character name they play in it
    parts: dict[str, dict[str, str]]

    @classmethod
    def load(cls, show: Show, part: ShowPartition, members: list[Membership]) -> "ShowCast":
        chars = {c.char_id: c for c in part.characters}
        scene_people: dict[str, list[str]] = {s.scene_id: [] for s in part.scenes}
        parts: dict[str, dict[str, str]] = {s.scene_id: {} for s in part.scenes}
        for a in sorted(part.appearances, key=lambda a: chars[a.char_id].order if a.char_id in chars else 0):
            char = chars.get(a.char_id)
            if not char or a.scene_id not in scene_people:
                continue
            for uid in char.cast_user_ids:
                if uid not in scene_people[a.scene_id]:
                    scene_people[a.scene_id].append(uid)
                parts[a.scene_id].setdefault(uid, char.name)
        return cls(
            show=show,
            members={m.user_id: m for m in members},
            scenes={s.scene_id: s for s in part.scenes},
            scene_people=scene_people,
            parts=parts,
        )

    def scene_label(self, scene_id: str) -> str:
        scene = self.scenes.get(scene_id)
        return f"{scene.number} {scene.name}" if scene else "Scene"

    def block_label(self, block: Block) -> str:
        if block.label:
            return block.label
        return ", ".join(self.scene_label(s) for s in block.scene_ids) or "Rehearsal"

    def block_people(self, block: Block) -> list[str]:
        out: list[str] = []
        for scene_id in block.scene_ids:
            out.extend(u for u in self.scene_people.get(scene_id, []) if u not in out)
        out.extend(u for u in block.user_ids if u not in out and u in self.members)
        return out

    def group_people(self, content: CallContent) -> list[str]:
        out = []
        for m in self.members.values():
            crewish = m.role in ("crew", "staff")
            if (
                "everyone" in content.groups
                or ("cast" in content.groups and m.role == "cast")
                or ("crew" in content.groups and crewish)
                or (m.department and m.department in content.departments)
                or m.user_id in content.user_ids
            ):
                out.append(m.user_id)
        return out

    def called(self, content: CallContent) -> dict[str, Called]:
        """Everyone this call needs, with the window each is needed for."""
        if content.cancelled:
            return {}
        out: dict[str, Called] = {}
        for uid in self.group_people(content):
            m = self.members[uid]
            start = content.crew_start if content.crew_start and m.role != "cast" else content.start
            out[uid] = Called(start=start, end=content.end, whole=True, labels=[content.title or ""])
        for piece in timed_blocks(content):
            label = self.block_label(piece.block)
            for uid in self.block_people(piece.block):
                if uid in out:
                    entry = out[uid]
                    if not entry.whole:
                        entry.widen(piece.start, piece.end)
                        entry.labels.append(label)
                else:
                    entry = out[uid] = Called(start=piece.start, end=piece.end, labels=[label])
                entry.scene_ids.extend(s for s in piece.block.scene_ids if s not in entry.scene_ids)
        for entry in out.values():
            entry.labels = [label for label in entry.labels if label]
        return out


def _load_cast(ctx: Ctx, show: Show) -> tuple[ShowCast, ShowPartition]:
    part = ctx.store.load_show(show.show_id)
    return ShowCast.load(show, part, ctx.store.list_members(show.show_id)), part


# ---- Called elsewhere ------------------------------------------------------------------------------


def _elsewhere(
    ctx: Ctx, show: Show, user_ids: Iterable[str], start: str, end: str
) -> dict[str, list[tuple[str, str, str, str]]]:
    """user id -> (date, start, end, other show's name) for every published call another show has them in."""
    wanted = set(user_ids)
    other_shows: dict[str, tuple[str, str]] = {}
    for uid in wanted:
        for m in ctx.store.list_memberships(uid):
            if m.show_id != show.show_id:
                other_shows[m.show_id] = (m.theater_id, m.show_id)
    out: dict[str, list[tuple[str, str, str, str]]] = {}
    for other in ctx.store.get_shows(other_shows.values()):
        if other.status == "archived":
            continue
        calls = [c for c in ctx.store.list_calls(other.show_id, start, end) if c.published]
        if not calls:
            continue
        cast, _ = _load_cast(ctx, other)
        for c in calls:
            assert c.published
            for uid, entry in cast.called(c.published).items():
                if uid in wanted:
                    out.setdefault(uid, []).append((c.published.date, entry.start, entry.end, other.name))
    return out


# ---- Warnings --------------------------------------------------------------------------------------

WarningKind = Literal["hard", "soft", "partial", "elsewhere"]


class Warning(Model):
    """Someone a block or call needs who can't make all of it."""

    user_id: str
    name: str | None = None
    # The character they play in this block, when it's a scene.
    part: str | None = None
    kind: WarningKind
    # For partial conflicts: when they get there or have to go.
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None


@dataclass
class _Checker:
    """Checks people against a date and a window, with conflicts loaded once per person."""

    ctx: Ctx
    cast: ShowCast
    names: dict[str, str | None]
    elsewhere: dict[str, list[tuple[str, str, str, str]]]
    _conflicts: dict[str, tuple[list[WeeklyConflict], list[DateConflict]]] = field(default_factory=dict)

    def warning(self, uid: str, day: str, start: str, end: str, part: str | None) -> Warning | None:
        for d, s, e, _ in self.elsewhere.get(uid, []):
            if d == day and _overlaps(start, end, s, e):
                return Warning(user_id=uid, name=self.names.get(uid), part=part, kind="elsewhere")
        if uid not in self._conflicts:
            self._conflicts[uid] = self.ctx.store.get_conflicts(uid)
        weekly, dates = self._conflicts[uid]
        avail = availability_on(day, weekly, dates)
        if avail.level in ("hard", "soft"):
            return Warning(
                user_id=uid, name=self.names.get(uid), part=part, kind=avail.level, note=avail.note
            )
        if avail.level == "partial":
            late = avail.arrive is not None and avail.arrive > start
            early = avail.leave is not None and avail.leave < end
            if late or early:
                return Warning(
                    user_id=uid,
                    name=self.names.get(uid),
                    part=part,
                    kind="partial",
                    arrive=avail.arrive if late else None,
                    leave=avail.leave if early else None,
                    note=avail.note,
                )
        return None


def _checker(ctx: Ctx, cast: ShowCast, start: str, end: str) -> _Checker:
    ids = list(cast.members)
    names = {u.user_id: u.name for u in ctx.store.get_users(ids)}
    return _Checker(ctx, cast, names, _elsewhere(ctx, cast.show, ids, start, end))


# ---- Views -----------------------------------------------------------------------------------------


class TimedBlock(Block):
    start: str
    end: str
    # The block has its own start time rather than following the one before.
    fixed_start: bool = False
    warnings: list[Warning] = []


class CallView(Model):
    call_id: str
    date: str
    start: str
    end: str
    type: CallType
    title: str | None = None
    location: str | None = None
    bring: str | None = None
    note: str | None = None
    groups: list[CallGroup] = []
    departments: list[str] = []
    user_ids: list[str] = []
    crew_start: str | None = None
    cancelled: bool = False
    blocks: list[TimedBlock] = []
    status: Literal["draft", "published"]
    # Staff only: the working copy differs from what cast and crew see.
    unpublished_changes: bool = False
    published_at: str | None = None
    # Whole-call people (groups, departments, extras) who can't make it.
    warnings: list[Warning] = []
    # How many people this call needs.
    called_count: int = 0
    # Minutes between the end of the last block and the end of the call.
    free_minutes: int = 0


class ScheduleDay(Model):
    date: str
    kind: Literal["rehearsal", "tech", "performance", "extra"]
    # The usual hours for that night, from the show's rehearsal nights.
    start: str | None = None
    end: str | None = None
    no_conflicts: bool = False
    calls: list[CallView] = []


class ScheduleView(Model):
    start: str
    end: str
    days: list[ScheduleDay]
    # True for staff, who see working copies and warnings; others see the published schedule.
    editing: bool


def _call_view(call: Call, content: CallContent, cast: ShowCast, check: _Checker | None) -> CallView:
    blocks = []
    for piece in timed_blocks(content):
        warnings: list[Warning] = []
        if check and not content.cancelled:
            for uid in cast.block_people(piece.block):
                part = next(
                    (cast.parts[s][uid] for s in piece.block.scene_ids if uid in cast.parts.get(s, {})), None
                )
                if w := check.warning(uid, content.date, piece.start, piece.end, part):
                    warnings.append(w)
        blocks.append(
            TimedBlock.model_validate(
                {
                    **piece.block.model_dump(),
                    "start": piece.start,
                    "end": piece.end,
                    "fixed_start": piece.block.start is not None,
                    "warnings": warnings,
                }
            )
        )
    called = cast.called(content)
    whole_warnings: list[Warning] = []
    if check and not content.cancelled:
        for uid, entry in called.items():
            if entry.whole and (w := check.warning(uid, content.date, entry.start, entry.end, None)):
                whole_warnings.append(w)
    last_end = to_minutes(blocks[-1].end) if blocks else to_minutes(content.start)
    return CallView(
        **content.model_dump(exclude={"blocks"}),
        call_id=call.call_id,
        blocks=blocks,
        status=call.status,
        unpublished_changes=check is not None and content_of(call) != call.published,
        published_at=call.published_at,
        warnings=whole_warnings,
        called_count=len(called),
        free_minutes=max(0, to_minutes(content.end) - last_end),
    )


def _week_bounds(start: str | None, end: str | None) -> tuple[str, str]:
    """Defaults to the Monday-to-Sunday week holding today."""
    if start and end:
        if end < start:
            raise Invalid("to must be on or after from")
        if (date.fromisoformat(end) - date.fromisoformat(start)).days > 62:
            raise Invalid("Ask for at most two months at a time")
        return start, end
    first = date.fromisoformat(start) if start else clock.today()
    if not start:
        first -= timedelta(days=first.weekday())
    return first.isoformat(), (first + timedelta(days=6)).isoformat()


def get_schedule(ctx: Ctx, user: User, show_id: str, start: str | None, end: str | None) -> ScheduleView:
    access = readable_show(ctx, show_id, user)
    show = access.show
    start, end = _week_bounds(start, end)
    editing = access.can("schedule:edit")
    cast, _ = _load_cast(ctx, show)
    check = _checker(ctx, cast, start, end) if editing else None
    lock = show.tech_start or show.opening_date
    days: dict[str, ScheduleDay] = {}
    for d in show_days(show):
        if start <= d.date <= end:
            days[d.date] = ScheduleDay(
                date=d.date,
                kind=d.kind,
                start=d.start,
                end=d.end,
                no_conflicts=bool(lock and d.date >= lock),
            )
    for call in ctx.store.list_calls(show_id, start, end):
        if editing:
            content: CallContent | None = content_of(call)
        else:
            content = call.published
            if not content or content.cancelled:
                continue
        assert content is not None
        day = days.setdefault(content.date, ScheduleDay(date=content.date, kind="extra"))
        day.calls.append(_call_view(call, content, cast, check))
    for day in days.values():
        day.calls.sort(key=lambda c: c.start)
    return ScheduleView(start=start, end=end, days=[days[k] for k in sorted(days)], editing=editing)


# ---- Scene suggestions -----------------------------------------------------------------------------


class SceneSuggestion(Model):
    scene_id: str
    minutes: int
    # Lower is better: hard conflicts and calls elsewhere count 10, soft 3, partial 1.
    score: int
    # How many calls in the range already rehearse it.
    nights_in_range: int
    last_rehearsed: str | None = None
    warnings: list[Warning] = []
    # Fits in the time left that night.
    fits: bool = True


class Suggestions(Model):
    date: str
    start: str | None = None
    end: str | None = None
    free_minutes: int | None = None
    scenes: list[SceneSuggestion]


def suggest_scenes(
    ctx: Ctx, user: User, show_id: str, day: str, start: str | None, end: str | None
) -> Suggestions:
    """Every scene ranked for one night: who'd be missing, then the least rehearsed first."""
    access = readable_show(ctx, show_id, user, "schedule:edit")
    show = access.show
    start, end = _week_bounds(start, end)
    cast, part = _load_cast(ctx, show)
    usual = next((d for d in show_days(show) if d.date == day), None)
    calls = ctx.store.list_calls(show_id)
    tonight = [content_of(c) for c in calls if c.date == day and not c.cancelled]
    window_start = min([c.start for c in tonight] or [usual.start if usual and usual.start else "00:00"])
    window_end = max([c.end for c in tonight] or [usual.end if usual and usual.end else "23:59"])
    free: int | None = None
    if tonight or (usual and usual.start):
        booked = sum(b.minutes for c in tonight for b in c.blocks)
        free = max(0, to_minutes(window_end) - to_minutes(window_start) - booked)
    check = _checker(ctx, cast, day, day)
    in_range: dict[str, int] = {}
    last: dict[str, str] = {}
    for c in calls:
        if c.cancelled:
            continue
        for b in c.blocks:
            for sid in b.scene_ids:
                if start <= c.date <= end:
                    in_range[sid] = in_range.get(sid, 0) + 1
                if c.date < day and c.date > last.get(sid, ""):
                    last[sid] = c.date
    out = []
    for scene in part.scenes:
        warnings = []
        for uid in cast.scene_people.get(scene.scene_id, []):
            if w := check.warning(uid, day, window_start, window_end, cast.parts[scene.scene_id].get(uid)):
                warnings.append(w)
        minutes = scene_minutes(scene, show)
        out.append(
            SceneSuggestion(
                scene_id=scene.scene_id,
                minutes=minutes,
                score=sum(WEIGHTS[w.kind] for w in warnings),
                nights_in_range=in_range.get(scene.scene_id, 0),
                last_rehearsed=last.get(scene.scene_id),
                warnings=warnings,
                fits=free is None or minutes <= free,
            )
        )
    out.sort(
        key=lambda s: (s.score, s.nights_in_range, s.last_rehearsed or "", cast.scenes[s.scene_id].order)
    )
    return Suggestions(
        date=day,
        start=window_start if tonight or usual else None,
        end=window_end if tonight or usual else None,
        free_minutes=free,
        scenes=out,
    )


# ---- Editing calls ---------------------------------------------------------------------------------


class BlockBody(Model):
    block_id: str | None = None
    scene_ids: list[str] = Field(default=[], max_length=20)
    label: optional_text(80) = None  # type: ignore[valid-type]
    # Leave out to use the scenes' rehearsal time (or 30 minutes for a label like "Warm-up").
    minutes: int | None = Field(default=None, ge=5, le=600)
    start: OptionalTime = None
    user_ids: list[str] = Field(default=[], max_length=200)

    @model_validator(mode="after")
    def _something(self) -> "BlockBody":
        if not self.scene_ids and not self.label:
            raise ValueError("a block needs a scene or a label")
        return self


class _CallFields(Model):
    type: CallType | None = None
    title: optional_text(120) = None  # type: ignore[valid-type]
    location: optional_text(200) = None  # type: ignore[valid-type]
    bring: optional_text(200) = None  # type: ignore[valid-type]
    note: optional_text(2000) = None  # type: ignore[valid-type]
    blocks: list[BlockBody] | None = Field(default=None, max_length=40)
    groups: list[CallGroup] | None = None
    departments: list[str] | None = Field(default=None, max_length=20)
    user_ids: list[str] | None = Field(default=None, max_length=300)
    crew_start: OptionalTime = None


class CreateCallBody(_CallFields):
    date: IsoDate
    # Leave out on a rehearsal night to use the show's usual hours.
    start: OptionalTime = None
    end: OptionalTime = None


class UpdateCallBody(_CallFields):
    date: IsoDate | None = None
    start: OptionalTime = None
    end: OptionalTime = None
    cancelled: bool | None = None


def _blocks(cast: ShowCast, show: Show, bodies: list[BlockBody]) -> list[Block]:
    out = []
    for b in bodies:
        unknown = [s for s in b.scene_ids if s not in cast.scenes]
        if unknown:
            raise Invalid("sceneIds can only name scenes in this show")
        if any(u not in cast.members for u in b.user_ids):
            raise Invalid("userIds can only name people in this show")
        minutes = b.minutes or sum(scene_minutes(cast.scenes[s], show) for s in b.scene_ids) or 30
        out.append(
            Block(
                block_id=b.block_id or new_id(),
                start=b.start,
                minutes=minutes,
                scene_ids=list(dict.fromkeys(b.scene_ids)),
                label=b.label,
                user_ids=list(dict.fromkeys(b.user_ids)),
            )
        )
    return out


def _check_content(cast: ShowCast, content: CallContent) -> None:
    show = cast.show
    if not show.start_date <= content.date <= show.end_date:
        raise Invalid("Calls have to fall between the first rehearsal and closing night")
    if content.end <= content.start:
        raise Invalid("A call has to end after it starts")
    if content.crew_start and content.crew_start >= content.end:
        raise Invalid("Crew call has to be before the call ends")
    if any(u not in cast.members for u in content.user_ids):
        raise Invalid("userIds can only name people in this show")


def _find_call(ctx: Ctx, show_id: str, call_id: str) -> Call:
    call = next((c for c in ctx.store.list_calls(show_id) if c.call_id == call_id), None)
    if not call:
        raise NotFound("Call not found")
    return call


def create_call(ctx: Ctx, user: User, show_id: str, body: CreateCallBody) -> Call:
    show = editable_show(ctx, show_id, user, "schedule:edit").show
    cast, _ = _load_cast(ctx, show)
    usual = next((d for d in show_days(show) if d.date == body.date), None)
    start = body.start or (usual.start if usual else None)
    end = body.end or (usual.end if usual else None)
    if not start or not end:
        raise Invalid("Give a start and end time; this isn't one of the usual rehearsal nights")
    default_type: CallType = "rehearsal"
    if usual and usual.kind == "tech":
        default_type = "tech"
    elif usual and usual.kind == "performance":
        default_type = "performance"
    stamp = now_iso()
    call = Call(
        call_id=new_id(),
        show_id=show_id,
        theater_id=show.theater_id,
        date=body.date,
        start=start,
        end=end,
        type=body.type or default_type,
        title=body.title,
        location=body.location,
        bring=body.bring,
        note=body.note,
        blocks=_blocks(cast, show, body.blocks or []),
        groups=list(dict.fromkeys(body.groups or [])),
        departments=list(dict.fromkeys(body.departments or [])),
        user_ids=list(dict.fromkeys(body.user_ids or [])),
        crew_start=body.crew_start,
        created_at=stamp,
        updated_at=stamp,
    )
    _check_content(cast, call)
    ctx.store.put_call(call)
    return call


def update_call(ctx: Ctx, user: User, show_id: str, call_id: str, body: UpdateCallBody) -> Call:
    show = editable_show(ctx, show_id, user, "schedule:edit").show
    cast, _ = _load_cast(ctx, show)
    call = _find_call(ctx, show_id, call_id)
    fields: dict[str, object] = {}
    for name in body.model_fields_set:
        value = getattr(body, name)
        if name == "blocks":
            fields["blocks"] = _blocks(cast, show, value or [])
        elif name in ("groups", "departments", "user_ids"):
            fields[name] = list(dict.fromkeys(value or []))
        elif name in ("title", "location", "bring", "note", "crew_start") or value is not None:
            fields[name] = value
    updated = call.model_copy(update={**fields, "updated_at": now_iso()})
    Call.model_validate(updated.model_dump())
    _check_content(cast, updated)
    ctx.store.put_call(updated, previous_date=call.date)
    return updated


def delete_call(ctx: Ctx, user: User, show_id: str, call_id: str) -> None:
    """A call nobody has seen is deleted. A published one is cancelled, until the week is published."""
    editable_show(ctx, show_id, user, "schedule:edit")
    call = _find_call(ctx, show_id, call_id)
    if call.published is None:
        ctx.store.delete_call(show_id, call.date, call.call_id)
    else:
        ctx.store.put_call(call.model_copy(update={"cancelled": True, "updated_at": now_iso()}))


class AddSceneBody(Model):
    scene_id: str
    # Leave out to add to that night's call, making one from the usual hours if there isn't one.
    call_id: str | None = None


def add_scene(ctx: Ctx, user: User, show_id: str, day: str, body: AddSceneBody) -> Call:
    """ "Put it here": appends a scene to a night, as dragging a scene onto the week does."""
    editable_show(ctx, show_id, user, "schedule:edit")
    if body.call_id:
        call = _find_call(ctx, show_id, body.call_id)
    else:
        existing = [c for c in ctx.store.list_calls(show_id, day, day) if not c.cancelled]
        if existing:
            call = min(existing, key=lambda c: c.start)
        else:
            call = create_call(ctx, user, show_id, CreateCallBody(date=day))
    blocks = [BlockBody.model_validate(b.model_dump()) for b in call.blocks]
    blocks.append(BlockBody(scene_ids=[body.scene_id]))
    return update_call(ctx, user, show_id, call.call_id, UpdateCallBody(blocks=blocks))


# ---- Publishing ------------------------------------------------------------------------------------


class PublishBody(Model):
    start: IsoDate = Field(alias="from")
    end: IsoDate = Field(alias="to")


class PublishResult(Model):
    published: int
    cancelled: int
    # Calls whose published copy changed, for change notices and calendar updates.
    call_ids: list[str]
    # People emailed about their changed calls.
    notified: int = 0


def publish(ctx: Ctx, user: User, show_id: str, body: PublishBody) -> PublishResult:
    from worklight.services.notify import schedule_published

    show = editable_show(ctx, show_id, user, "schedule:edit").show
    if body.end < body.start:
        raise Invalid("to must be on or after from")
    published = cancelled = 0
    changed = []
    changes: list[tuple[CallContent | None, CallContent]] = []
    stamp = now_iso()
    for call in ctx.store.list_calls(show_id, body.start, body.end):
        content = content_of(call)
        if call.published == content:
            continue
        if content.cancelled and call.published is None:
            ctx.store.delete_call(show_id, call.date, call.call_id)
            continue
        ctx.store.put_call(
            call.model_copy(
                update={
                    "published": content,
                    "status": "published",
                    "sequence": call.sequence + (1 if call.published else 0),
                    "published_at": stamp,
                }
            )
        )
        changed.append(call.call_id)
        changes.append((call.published, content))
        if content.cancelled:
            cancelled += 1
        else:
            published += 1
    notified = schedule_published(ctx, show, changes) if changes else 0
    return PublishResult(published=published, cancelled=cancelled, call_ids=changed, notified=notified)


# ---- Tech week ------------------------------------------------------------------------------------


class TechCallsBody(Model):
    """Makes an everyone-called call for each tech and performance night that doesn't have one."""

    start: Time
    end: Time
    # Crew usually come in before cast.
    crew_start: OptionalTime = None
    location: optional_text(200) = None  # type: ignore[valid-type]


def create_tech_calls(ctx: Ctx, user: User, show_id: str, body: TechCallsBody) -> list[Call]:
    show = editable_show(ctx, show_id, user, "schedule:edit").show
    taken = {c.date for c in ctx.store.list_calls(show_id) if not c.cancelled}
    made = []
    night = 0
    for d in show_days(show):
        if d.kind == "rehearsal":
            continue
        if d.kind == "tech":
            night += 1
        if d.date in taken:
            continue
        is_perf = d.kind == "performance"
        made.append(
            create_call(
                ctx,
                user,
                show_id,
                CreateCallBody(
                    date=d.date,
                    start=body.start,
                    end=body.end,
                    crew_start=body.crew_start,
                    type="performance" if is_perf else "tech",
                    title="Performance" if is_perf else f"Tech night {night}",
                    location=body.location,
                    groups=["everyone"],
                ),
            )
        )
    return made


# ---- A person's own calls -------------------------------------------------------------------------


class MyCall(Model):
    show_id: str
    show_name: str
    call_id: str
    date: str
    # Their own times: when their first block starts and their last one ends.
    start: str
    end: str
    # The whole call, for context.
    call_start: str
    call_end: str
    type: CallType
    title: str | None = None
    location: str | None = None
    address: str | None = None
    bring: str | None = None
    note: str | None = None
    # What they're called for, e.g. "2.2 Another part of the wood".
    labels: list[str] = []
    scene_ids: list[str] = []
    cancelled: bool = False
    sequence: int = 0
    timezone: str


def my_calls(ctx: Ctx, user: User, show_id: str | None = None, include_past: bool = False) -> list[MyCall]:
    """Published calls that need me, across my active shows (or one show), from today on."""
    memberships = ctx.store.list_memberships(user.user_id)
    refs = [(m.theater_id, m.show_id) for m in memberships if show_id in (None, m.show_id)]
    today = clock.today().isoformat()
    out = []
    for show in ctx.store.get_shows(refs):
        if show.status == "archived" and show_id is None:
            continue
        calls = [c for c in ctx.store.list_calls(show.show_id) if c.published]
        if not calls:
            continue
        cast, _ = _load_cast(ctx, show)
        for c in calls:
            content = c.published
            assert content is not None
            if content.date < today and not include_past:
                continue
            if content.cancelled:
                # Still show a cancelled call to anyone it would have needed.
                entry = cast.called(content.model_copy(update={"cancelled": False})).get(user.user_id)
            else:
                entry = cast.called(content).get(user.user_id)
            if not entry:
                continue
            out.append(
                MyCall(
                    show_id=show.show_id,
                    show_name=show.name,
                    call_id=c.call_id,
                    date=content.date,
                    start=entry.start,
                    end=entry.end,
                    call_start=content.start,
                    call_end=content.end,
                    type=content.type,
                    title=content.title,
                    location=content.location or show.venue,
                    address=show.address,
                    bring=content.bring,
                    note=content.note,
                    labels=entry.labels,
                    scene_ids=entry.scene_ids,
                    cancelled=content.cancelled,
                    sequence=c.sequence,
                    timezone=show.timezone,
                )
            )
    out.sort(key=lambda m: (m.date, m.start))
    return out
