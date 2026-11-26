"""Attendance on every call: absences reported ahead, "I'm here" check-in, and the stage manager's board."""

import math
from datetime import date as Date
from zoneinfo import ZoneInfo

from pydantic import Field, model_validator

from worklight import clock, mailer
from worklight.ids import now_iso
from worklight.models import (
    AbsenceKind,
    CallContent,
    CheckIn,
    CheckInLocation,
    CheckInStatus,
    Model,
    ShowRole,
    User,
)
from worklight.services.base import (
    Ctx,
    Forbidden,
    Invalid,
    IsoDate,
    NotFound,
    OptionalTime,
    editable_show,
    optional_text,
    readable_show,
)
from worklight.services.schedule import Called, ShowCast, _load_cast, content_of, from_minutes, to_minutes

# Tech, dress and performances count before they're published: everyone is called to them.
ALWAYS_CALLED = ("tech", "dress", "performance")
# "I'm here" opens this long before someone's own call time.
CHECK_IN_EARLY_MINUTES = 30
# Further than this from the venue (after allowing for the phone's own uncertainty) is "not here yet".
FAR_METERS = 800
# A location fix vaguer than this can't tell us anything, so it counts as unknown.
USELESS_ACCURACY_METERS = 2000


def local_now(timezone: str) -> tuple[str, str]:
    """Today's date and the time now, where the show is."""
    now = clock.now().astimezone(ZoneInfo(timezone))
    return now.date().isoformat(), now.strftime("%H:%M")


def _content(call_type: str, published: CallContent | None, draft: CallContent) -> CallContent | None:
    if published:
        return published
    return draft if call_type in ALWAYS_CALLED else None


def _called_by_day(
    ctx: Ctx, show_id: str, cast: ShowCast
) -> dict[str, tuple[list["NightCall"], dict[str, Called]]]:
    """Each date with calls: the calls, and everyone called that day with their whole window."""
    out: dict[str, tuple[list[NightCall], dict[str, Called]]] = {}
    for call in ctx.store.list_calls(show_id):
        content = _content(call.type, call.published, content_of(call))
        if not content or content.cancelled:
            continue
        calls, people = out.setdefault(content.date, ([], {}))
        calls.append(
            NightCall(call_id=call.call_id, type=content.type, title=content.title, start=content.start)
        )
        for uid, entry in cast.called(content).items():
            if uid in people:
                people[uid].widen(entry.start, entry.end)
            else:
                people[uid] = Called(start=entry.start, end=entry.end)
    return out


# ---- The board ------------------------------------------------------------------------------------


class NightCall(Model):
    call_id: str
    type: str
    title: str | None = None
    start: str


class CalledPerson(Model):
    user_id: str
    # Their own window that day, across every call they're in.
    start: str
    end: str


class AttendanceNight(Model):
    """One day with calls on it. Attendance is kept per person per day."""

    date: str
    start: str
    end: str
    calls: list[NightCall]
    called: list[CalledPerson]


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
    # user id -> name of staff who said "Got it" to something.
    seen_names: dict[str, str] = {}
    # Today, when today has calls.
    tonight: str | None = None
    # Today where the show is, so "coming up" means the same thing on every phone.
    today: str
    # Whether staff have saved where the venue is, for the "I'm here" location check.
    venue_set: bool = False


def _labels(ctx: Ctx, show_id: str) -> dict[str, str]:
    out: dict[str, list[str]] = {}
    for c in sorted(ctx.store.load_show(show_id).characters, key=lambda c: c.order):
        for uid in c.cast_user_ids:
            out.setdefault(uid, []).append(c.name)
    return {uid: ", ".join(names) for uid, names in out.items()}


def get_attendance(ctx: Ctx, user: User, show_id: str) -> Attendance:
    access = readable_show(ctx, show_id, user, "schedule:edit")
    show = access.show
    cast, _ = _load_cast(ctx, show)
    nights = []
    for day, (calls, who) in sorted(_called_by_day(ctx, show_id, cast).items()):
        called = sorted(
            (CalledPerson(user_id=uid, start=c.start, end=c.end) for uid, c in who.items()),
            key=lambda p: p.start,
        )
        nights.append(
            AttendanceNight(
                date=day,
                start=min((c.start for c in calls), default="00:00"),
                end=max((p.end for p in called), default="23:59"),
                calls=sorted(calls, key=lambda c: c.start),
                called=called,
            )
        )
    members = ctx.store.list_members(show_id)
    checkins = ctx.store.list_checkins(show_id)
    seen_ids = {c.seen_by for c in checkins if c.seen_by}
    names = {u.user_id: u.name for u in ctx.store.get_users({m.user_id for m in members} | seen_ids)}
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
        checkins=checkins,
        seen_names={uid: names.get(uid) or "Staff" for uid in seen_ids},
        tonight=today if any(n.date == today for n in nights) else None,
        today=today,
        venue_set=show.venue_lat is not None and show.venue_lng is not None,
    )


def _existing(ctx: Ctx, show_id: str, day: str, user_id: str) -> CheckIn | None:
    return next((c for c in ctx.store.list_checkins(show_id, day) if c.user_id == user_id), None)


class MarkBody(Model):
    # null clears the square back to "not yet".
    status: CheckInStatus | None


def mark(ctx: Ctx, user: User, show_id: str, day: str, user_id: str, body: MarkBody) -> CheckIn | None:
    """Staff fix a square: on time, late, absent, or back to not yet."""
    editable_show(ctx, show_id, user, "schedule:edit")
    if not ctx.store.get_membership(show_id, user_id):
        raise NotFound("That person isn't in this show")
    existing = _existing(ctx, show_id, day, user_id)
    if body.status is None and not (existing and existing.report):
        ctx.store.delete_checkin(show_id, day, user_id)
        return None
    stamp = now_iso()
    here = body.status in ("on_time", "late")
    checkin = (existing or CheckIn(show_id=show_id, date=day, user_id=user_id, updated_at=stamp)).model_copy(
        update={
            "status": body.status,
            "by_self": False,
            "location": None,
            "arrived_at": (existing.arrived_at if existing and existing.arrived_at else stamp)
            if here
            else None,
            "updated_at": stamp,
        }
    )
    ctx.store.put_checkin(checkin)
    return checkin


def mark_seen(ctx: Ctx, user: User, show_id: str, day: str, user_id: str) -> CheckIn:
    """Staff tap "Got it" on what someone told them, so that person knows it landed."""
    editable_show(ctx, show_id, user, "schedule:edit")
    existing = _existing(ctx, show_id, day, user_id)
    if not existing or not existing.report:
        raise NotFound("There's no report to say Got it to")
    if existing.seen_by:
        return existing
    stamp = now_iso()
    checkin = existing.model_copy(update={"seen_by": user.user_id, "seen_at": stamp, "updated_at": stamp})
    ctx.store.put_checkin(checkin)
    return checkin


# ---- Venue location -------------------------------------------------------------------------------


class VenueLocationBody(Model):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


def set_venue_location(ctx: Ctx, user: User, show_id: str, body: VenueLocationBody | None) -> None:
    """Staff standing in the rehearsal room save where it is (or clear it, with None)."""
    show = editable_show(ctx, show_id, user, "schedule:edit").show
    ctx.store.put_show(
        show.model_copy(
            update={"venue_lat": body.lat if body else None, "venue_lng": body.lng if body else None}
        )
    )


def distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance, which is plenty for "is this phone at the theater"."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---- The person's side ----------------------------------------------------------------------------


def _my_day(ctx: Ctx, show_id: str, user_id: str, day: str) -> Called | None:
    """Someone's window on one day, across every call they're in (None when they aren't called)."""
    show = ctx.store.get_show(show_id)
    assert show
    cast, _ = _load_cast(ctx, show)
    best: Called | None = None
    for call in ctx.store.list_calls(show_id, day, day):
        content = _content(call.type, call.published, content_of(call))
        if not content:
            continue
        entry = cast.called(content).get(user_id)
        if not entry:
            continue
        if best is None:
            best = Called(start=entry.start, end=entry.end)
        else:
            best.widen(entry.start, entry.end)
    return best


class CheckInBody(Model):
    # Where the phone says it is. Left out when the person said no or the phone couldn't tell.
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    # The phone's own uncertainty, in meters.
    accuracy: float | None = Field(default=None, ge=0)


class CheckInResult(Model):
    checkin: CheckIn
    # Their call time today.
    call_start: str
    minutes_late: int = 0


def self_check_in(ctx: Ctx, user: User, show_id: str, body: CheckInBody) -> CheckInResult:
    """The "I'm here" button: from half an hour before their call until it ends, at the venue."""
    access = editable_show(ctx, show_id, user, "conflicts:edit-own")
    show = access.show
    if not access.membership:
        raise Forbidden("Only people in the show can check in")
    day, now = local_now(show.timezone)
    mine = _my_day(ctx, show_id, user.user_id, day)
    if not mine:
        raise Invalid("You're not called today.")
    opens = to_minutes(mine.start) - CHECK_IN_EARLY_MINUTES
    if to_minutes(now) < opens:
        raise Invalid(
            f"Check-in opens at {mailer.pretty_time(from_minutes(opens))}, half an hour before your call."
        )
    if to_minutes(now) > to_minutes(mine.end):
        raise Invalid("Your call is over for today. Ask stage management if you need to be marked here.")

    location: CheckInLocation | None = None
    if show.venue_lat is not None and show.venue_lng is not None:
        located = (
            body.lat is not None
            and body.lng is not None
            and (body.accuracy is None or body.accuracy <= USELESS_ACCURACY_METERS)
        )
        if located:
            assert body.lat is not None and body.lng is not None
            away = distance_meters(show.venue_lat, show.venue_lng, body.lat, body.lng) - (body.accuracy or 0)
            if away > FAR_METERS:
                miles = max(1, round(away / 1609))
                raise Invalid(
                    f"You look about {miles} mile{'s' if miles != 1 else ''} from the venue. "
                    "Check in when you get there, or tell stage management you're running late."
                )
            location = "confirmed"
        else:
            location = "unknown"

    late = max(0, to_minutes(now) - to_minutes(mine.start))
    existing = _existing(ctx, show_id, day, user.user_id)
    if existing and existing.arrived_at:
        # Tapping twice keeps the first arrival.
        return CheckInResult(checkin=existing, call_start=mine.start, minutes_late=late)
    stamp = now_iso()
    checkin = (
        existing or CheckIn(show_id=show_id, date=day, user_id=user.user_id, updated_at=stamp)
    ).model_copy(
        update={
            "status": "late" if late > 0 else "on_time",
            "by_self": True,
            "location": location,
            "arrived_at": stamp,
            "updated_at": stamp,
        }
    )
    ctx.store.put_checkin(checkin)
    return CheckInResult(checkin=checkin, call_start=mine.start, minutes_late=late)


class AbsenceBody(Model):
    # Every date the report covers. Each must be a day they're called, today or later.
    dates: list[IsoDate] = Field(min_length=1, max_length=60)
    kind: AbsenceKind
    # Arriving by (late) or leaving at (leave_early). Not used for "absent".
    time: OptionalTime = None
    note: optional_text(300) = None  # type: ignore[valid-type]

    @model_validator(mode="after")
    def _time_when_needed(self) -> "AbsenceBody":
        if self.kind != "absent" and not self.time:
            raise ValueError("Say what time you'll arrive or leave")
        return self


def _what(kind: str, time: str | None, days: list[tuple[str, Called]]) -> str:
    """ "can't come Tue Dec 8 and Thu Dec 10", reading on from the person's name."""

    def day_name(d: str) -> str:
        x = Date.fromisoformat(d)
        return f"{x.strftime('%a %b')} {x.day}"

    names = [day_name(d) for d, _ in days]
    when = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    if kind == "absent":
        return f"can't come {when}"
    assert time
    if kind == "late":
        return f"will be late {when}, arriving about {mailer.pretty_time(time)}"
    return f"will leave early {when}, at {mailer.pretty_time(time)}"


def report_absence(ctx: Ctx, user: User, show_id: str, body: AbsenceBody) -> list[CheckIn]:
    """An actor tells stage management ahead of time: can't come, late, or leaving early."""
    access = editable_show(ctx, show_id, user, "conflicts:edit-own")
    show = access.show
    if not access.membership:
        raise Forbidden("Only people in the show can report an absence")
    today, now = local_now(show.timezone)
    days: list[tuple[str, Called]] = []
    for day in sorted(set(body.dates)):
        mine = _my_day(ctx, show_id, user.user_id, day)
        if not mine:
            raise Invalid(f"You're not called on {mailer.pretty_date(day)}.")
        if day < today or (day == today and to_minutes(now) > to_minutes(mine.end)):
            raise Invalid(f"Your call on {mailer.pretty_date(day)} is already over.")
        days.append((day, mine))
    stamp = now_iso()
    saved = []
    for day, _ in days:
        existing = _existing(ctx, show_id, day, user.user_id)
        checkin = (
            existing or CheckIn(show_id=show_id, date=day, user_id=user.user_id, updated_at=stamp)
        ).model_copy(
            update={
                "report": body.kind,
                "report_time": body.time if body.kind != "absent" else None,
                "note": body.note,
                "reported_at": stamp,
                # A changed report needs a fresh "Got it".
                "seen_by": None,
                "seen_at": None,
                "updated_at": stamp,
            }
        )
        ctx.store.put_checkin(checkin)
        saved.append(checkin)
    what = _what(body.kind, body.time, days)
    for to in _stage_managers(ctx, show_id, exclude=user.user_id):
        ctx.mailer.send(
            mailer.absence_report_email(
                to=to,
                show_name=show.name,
                person_name=user.name or user.email,
                what=what,
                note=body.note,
                url=ctx.link(f"/shows/{show_id}/attendance"),
            )
        )
    return saved


def take_back(ctx: Ctx, user: User, show_id: str, day: str) -> None:
    """Never mind: they can make it after all."""
    access = editable_show(ctx, show_id, user, "conflicts:edit-own")
    today, _ = local_now(access.show.timezone)
    if day < today:
        raise Invalid("That call is already over.")
    existing = _existing(ctx, show_id, day, user.user_id)
    if not existing or not existing.report:
        return
    if existing.status is None:
        ctx.store.delete_checkin(show_id, day, user.user_id)
        return
    ctx.store.put_checkin(
        existing.model_copy(
            update={
                "report": None,
                "report_time": None,
                "note": None,
                "reported_at": None,
                "seen_by": None,
                "seen_at": None,
                "updated_at": now_iso(),
            }
        )
    )


class MyCheckIn(Model):
    """What someone told us about one of their days, and whether staff saw it, for My calls."""

    date: str
    status: CheckInStatus | None = None
    arrived_at: str | None = None
    location: CheckInLocation | None = None
    report: AbsenceKind | None = None
    report_time: str | None = None
    note: str | None = None
    seen_by_name: str | None = None
    seen_at: str | None = None


class MyAttendance(Model):
    checkins: list[MyCheckIn]
    today: str
    # "I'm here" opens this many minutes before a call.
    check_in_early_minutes: int = CHECK_IN_EARLY_MINUTES
    # Whether "I'm here" will ask the phone where it is.
    venue_set: bool = False


def my_attendance(ctx: Ctx, user: User, show_id: str) -> MyAttendance:
    access = readable_show(ctx, show_id, user)
    show = access.show
    today, _ = local_now(show.timezone)
    mine = [c for c in ctx.store.list_checkins(show_id) if c.user_id == user.user_id and c.date >= today]
    names = {u.user_id: u.name for u in ctx.store.get_users({c.seen_by for c in mine if c.seen_by})}
    return MyAttendance(
        checkins=[
            MyCheckIn(
                date=c.date,
                status=c.status,
                arrived_at=c.arrived_at,
                location=c.location,
                report=c.report,
                report_time=c.report_time,
                note=c.note,
                seen_by_name=(names.get(c.seen_by) or "Stage management") if c.seen_by else None,
                seen_at=c.seen_at,
            )
            for c in sorted(mine, key=lambda c: c.date)
        ],
        today=today,
        venue_set=show.venue_lat is not None and show.venue_lng is not None,
    )


def _stage_managers(ctx: Ctx, show_id: str, exclude: str) -> list[str]:
    """Emails of the show's stage managers, or all its staff when nobody has that title."""
    staff = [m for m in ctx.store.list_members(show_id) if m.role == "staff" and m.user_id != exclude]

    def is_sm(text: str | None) -> bool:
        return bool(text) and "stage manag" in (text or "").lower()

    picked = [m for m in staff if is_sm(m.title) or is_sm(m.department)] or staff
    return [u.email for u in ctx.store.get_users(m.user_id for m in picked)]
