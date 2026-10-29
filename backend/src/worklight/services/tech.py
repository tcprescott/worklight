"""Tech week and performance attendance: who's in the building, stage-door check-in, and running late."""

import secrets
from zoneinfo import ZoneInfo

from pydantic import Field

from worklight import clock, mailer
from worklight.ids import now_iso
from worklight.models import CheckIn, CheckInStatus, Model, ShowRole, User
from worklight.services.base import (
    Ctx,
    Forbidden,
    Invalid,
    IsoDate,
    NotFound,
    editable_show,
    optional_text,
    readable_show,
)
from worklight.services.schedule import Called, ShowCast, _load_cast, content_of, to_minutes

ATTENDANCE_TYPES = ("tech", "dress", "performance")


def local_now(timezone: str) -> tuple[str, str]:
    """Today's date and the time now, where the show is."""
    now = clock.now().astimezone(ZoneInfo(timezone))
    return now.date().isoformat(), now.strftime("%H:%M")


class AttendanceNight(Model):
    date: str
    call_id: str
    title: str | None = None
    start: str
    crew_start: str | None = None


class AttendancePerson(Model):
    user_id: str
    name: str | None = None
    role: ShowRole
    # The character(s) they play, or their crew title or department.
    label: str | None = None


class Attendance(Model):
    nights: list[AttendanceNight]
    people: list[AttendancePerson]
    checkins: list[CheckIn]
    # Today, when today is one of the nights.
    tonight: str | None = None
    # The code on the stage door sign. Scanning it opens /shows/<id>/door?code=<code>.
    door_code: str


def _nights(ctx: Ctx, show_id: str) -> list[AttendanceNight]:
    out = []
    for call in ctx.store.list_calls(show_id):
        if call.cancelled or call.type not in ATTENDANCE_TYPES:
            continue
        out.append(
            AttendanceNight(
                date=call.date,
                call_id=call.call_id,
                title=call.title,
                start=call.start,
                crew_start=call.crew_start,
            )
        )
    return out


def _labels(ctx: Ctx, show_id: str) -> dict[str, str]:
    out: dict[str, list[str]] = {}
    for c in sorted(ctx.store.load_show(show_id).characters, key=lambda c: c.order):
        for uid in c.cast_user_ids:
            out.setdefault(uid, []).append(c.name)
    return {uid: ", ".join(names) for uid, names in out.items()}


def get_attendance(ctx: Ctx, user: User, show_id: str) -> Attendance:
    access = readable_show(ctx, show_id, user, "schedule:edit")
    show = access.show
    if not show.door_code and show.status != "archived":
        show = show.model_copy(update={"door_code": secrets.token_urlsafe(9)})
        ctx.store.put_show(show)
    nights = _nights(ctx, show_id)
    members = ctx.store.list_members(show_id)
    names = {u.user_id: u.name for u in ctx.store.get_users(m.user_id for m in members)}
    parts = _labels(ctx, show_id)
    order = {"cast": 0, "crew": 1, "staff": 2}
    people = [
        AttendancePerson(
            user_id=m.user_id,
            name=names.get(m.user_id),
            role=m.role,
            label=parts.get(m.user_id) or m.title or m.department,
        )
        for m in members
    ]
    people.sort(key=lambda p: (order[p.role], (p.name or "").lower()))
    today, _ = local_now(show.timezone)
    return Attendance(
        nights=nights,
        people=people,
        checkins=ctx.store.list_checkins(show_id),
        tonight=today if any(n.date == today for n in nights) else None,
        door_code=show.door_code or "",
    )


class MarkBody(Model):
    # null clears the square back to "not yet".
    status: CheckInStatus | None


def mark(ctx: Ctx, user: User, show_id: str, day: str, user_id: str, body: MarkBody) -> CheckIn | None:
    """Staff fix a square: on time, late, absent, or back to not yet."""
    editable_show(ctx, show_id, user, "schedule:edit")
    if not ctx.store.get_membership(show_id, user_id):
        raise NotFound("That person isn't in this show")
    existing = next((c for c in ctx.store.list_checkins(show_id, day) if c.user_id == user_id), None)
    if body.status is None and not (existing and existing.running_late_minutes):
        ctx.store.delete_checkin(show_id, day, user_id)
        return None
    stamp = now_iso()
    checkin = (existing or CheckIn(show_id=show_id, date=day, user_id=user_id, updated_at=stamp)).model_copy(
        update={
            "status": body.status,
            "by_self": False,
            "arrived_at": stamp if body.status in ("on_time", "late") else None,
            "updated_at": stamp,
        }
    )
    ctx.store.put_checkin(checkin)
    return checkin


def rotate_door_code(ctx: Ctx, user: User, show_id: str) -> str:
    """A new stage-door code, for when a photo of the sign got around."""
    show = editable_show(ctx, show_id, user, "schedule:edit").show
    code = secrets.token_urlsafe(9)
    ctx.store.put_show(show.model_copy(update={"door_code": code}))
    return code


def _my_call_tonight(ctx: Ctx, show_id: str, user_id: str, day: str) -> tuple[Called, ShowCast] | None:
    show = ctx.store.get_show(show_id)
    assert show
    cast, _ = _load_cast(ctx, show)
    best: Called | None = None
    for call in ctx.store.list_calls(show_id, day, day):
        content = call.published or (content_of(call) if call.type in ATTENDANCE_TYPES else None)
        if not content:
            continue
        entry = cast.called(content).get(user_id)
        if entry and (best is None or entry.start < best.start):
            best = entry
    return (best, cast) if best else None


class CheckInBody(Model):
    code: str = Field(min_length=1, max_length=64)


class CheckInResult(Model):
    checkin: CheckIn
    # Their call time tonight, if they're called.
    call_start: str | None = None
    minutes_late: int = 0


def self_check_in(ctx: Ctx, user: User, show_id: str, body: CheckInBody) -> CheckInResult:
    """Scanning the stage door sign: checks the person in for tonight, on time or late."""
    access = editable_show(ctx, show_id, user, "conflicts:edit-own")
    show = access.show
    if not access.membership:
        raise Forbidden("Only people in the show can sign in at the stage door")
    if not show.door_code or not secrets.compare_digest(body.code, show.door_code):
        raise Invalid("That code is out of date. Scan the sign at the stage door again.")
    day, now = local_now(show.timezone)
    found = _my_call_tonight(ctx, show_id, user.user_id, day)
    start = found[0].start if found else None
    late = max(0, to_minutes(now) - to_minutes(start)) if start else 0
    existing = next((c for c in ctx.store.list_checkins(show_id, day) if c.user_id == user.user_id), None)
    stamp = now_iso()
    checkin = (
        existing or CheckIn(show_id=show_id, date=day, user_id=user.user_id, updated_at=stamp)
    ).model_copy(
        update={
            "status": "late" if late > 0 else "on_time",
            "by_self": True,
            "arrived_at": stamp,
            "updated_at": stamp,
        }
    )
    if existing and existing.arrived_at:
        checkin = existing  # Scanning twice keeps the first arrival.
    else:
        ctx.store.put_checkin(checkin)
    return CheckInResult(checkin=checkin, call_start=start, minutes_late=late)


class RunningLateBody(Model):
    minutes: int = Field(ge=5, le=240)
    note: optional_text(200) = None  # type: ignore[valid-type]
    # Defaults to today where the show is.
    date: IsoDate | None = None


def running_late(ctx: Ctx, user: User, show_id: str, body: RunningLateBody) -> CheckIn:
    """Tells stage management someone's on their way, by email, and shows it on tonight's sign-in."""
    access = editable_show(ctx, show_id, user, "conflicts:edit-own")
    show = access.show
    if not access.membership:
        raise Forbidden("Only people in the show can say they're running late")
    today, _ = local_now(show.timezone)
    day = body.date or today
    found = _my_call_tonight(ctx, show_id, user.user_id, day)
    existing = next((c for c in ctx.store.list_checkins(show_id, day) if c.user_id == user.user_id), None)
    stamp = now_iso()
    checkin = (
        existing or CheckIn(show_id=show_id, date=day, user_id=user.user_id, updated_at=stamp)
    ).model_copy(update={"running_late_minutes": body.minutes, "note": body.note, "updated_at": stamp})
    ctx.store.put_checkin(checkin)
    for to in _stage_managers(ctx, show_id, exclude=user.user_id):
        ctx.mailer.send(
            mailer.running_late_email(
                to=to,
                show_name=show.name,
                person_name=user.name or user.email,
                minutes=body.minutes,
                call_time=found[0].start if found else None,
                note=body.note,
                url=ctx.link(f"/shows/{show_id}/tech"),
            )
        )
    return checkin


def _stage_managers(ctx: Ctx, show_id: str, exclude: str) -> list[str]:
    """Emails of the show's stage managers, or all its staff when nobody has that title."""
    staff = [m for m in ctx.store.list_members(show_id) if m.role == "staff" and m.user_id != exclude]

    def is_sm(text: str | None) -> bool:
        return bool(text) and "stage manag" in (text or "").lower()

    picked = [m for m in staff if is_sm(m.title) or is_sm(m.department)] or staff
    return [u.email for u in ctx.store.get_users(m.user_id for m in picked)]
