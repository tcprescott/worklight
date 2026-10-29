"""Conflicts belong to the person, not the show: entered once, seen by every show they're in."""

from typing import Literal

from pydantic import Field, model_validator

from worklight import clock
from worklight.calendar import no_conflicts_from, show_days
from worklight.ids import now_iso
from worklight.models import (
    ConflictLevel,
    DateAnswer,
    DateConflict,
    MemberConflicts,
    Model,
    MyConflicts,
    User,
    WeeklyConflict,
)
from worklight.services.base import Ctx, IsoDate, OptionalTime, optional_text, readable_show


def get_my_conflicts(ctx: Ctx, user: User) -> MyConflicts:
    weekly, dates = ctx.store.get_conflicts(user.user_id)
    return MyConflicts(weekly=weekly, dates=dates)


class _Times(Model):
    arrive: OptionalTime = None
    leave: OptionalTime = None
    note: optional_text(200) = None  # type: ignore[valid-type]

    def _check_partial(self, level: str) -> None:
        if level == "partial" and not (self.arrive or self.leave):
            raise ValueError("a partial conflict needs an arrive or leave time")
        if self.arrive and self.leave and self.leave <= self.arrive:
            raise ValueError("leave must be after arrive")


class WeeklyBody(_Times):
    level: ConflictLevel

    @model_validator(mode="after")
    def _valid(self) -> "WeeklyBody":
        self._check_partial(self.level)
        return self


class DateBody(_Times):
    level: DateAnswer

    @model_validator(mode="after")
    def _valid(self) -> "DateBody":
        self._check_partial(self.level)
        return self


class WeeklyItem(WeeklyBody):
    weekday: int = Field(ge=0, le=6)


class DateItem(DateBody):
    date: IsoDate


def _weekly(user: User, weekday: int, body: WeeklyBody) -> WeeklyConflict:
    partial = body.level == "partial"
    return WeeklyConflict(
        user_id=user.user_id,
        weekday=weekday,
        level=body.level,
        arrive=body.arrive if partial else None,
        leave=body.leave if partial else None,
        note=body.note,
        updated_at=now_iso(),
    )


def _dated(user: User, day: str, body: DateBody) -> DateConflict:
    partial = body.level == "partial"
    return DateConflict(
        user_id=user.user_id,
        date=day,
        level=body.level,
        arrive=body.arrive if partial else None,
        leave=body.leave if partial else None,
        note=body.note,
        updated_at=now_iso(),
    )


def put_weekly(ctx: Ctx, user: User, weekday: int, body: WeeklyBody) -> WeeklyConflict:
    conflict = _weekly(user, weekday, body)
    ctx.store.put_weekly_conflict(conflict)
    return conflict


def delete_weekly(ctx: Ctx, user: User, weekday: int) -> None:
    ctx.store.delete_weekly_conflict(user.user_id, weekday)


def put_date(ctx: Ctx, user: User, day: str, body: DateBody) -> DateConflict:
    conflict = _dated(user, day, body)
    ctx.store.put_date_conflict(conflict)
    return conflict


def delete_date(ctx: Ctx, user: User, day: str) -> None:
    ctx.store.delete_date_conflict(user.user_id, day)


class SaveConflictsBody(Model):
    """Saves several answers at once, as the guided setup does at the end."""

    weekly: list[WeeklyItem] = Field(default=[], max_length=7)
    dates: list[DateItem] = Field(default=[], max_length=400)
    # Weekdays not listed in weekly lose their rule.
    replace_weekly: bool = False
    # Dates to clear back to "no answer".
    clear_dates: list[IsoDate] = Field(default=[], max_length=400)
    # Also mark conflicts as sent to these shows (or all of your shows with "all").
    submit_to: list[str] | Literal["all"] = []


def save_conflicts(ctx: Ctx, user: User, body: SaveConflictsBody) -> MyConflicts:
    existing_weekly, _ = ctx.store.get_conflicts(user.user_id)
    weekdays = {w.weekday for w in body.weekly}
    if body.replace_weekly:
        for w in existing_weekly:
            if w.weekday not in weekdays:
                ctx.store.delete_weekly_conflict(user.user_id, w.weekday)
    for item in body.weekly:
        ctx.store.put_weekly_conflict(_weekly(user, item.weekday, item))
    for d in body.clear_dates:
        ctx.store.delete_date_conflict(user.user_id, d)
    for answer in body.dates:
        ctx.store.put_date_conflict(_dated(user, answer.date, answer))
    if body.submit_to:
        submit(ctx, user, None if body.submit_to == "all" else body.submit_to)
    return get_my_conflicts(ctx, user)


def submit(ctx: Ctx, user: User, show_ids: list[str] | None) -> list[str]:
    """Marks conflicts as sent: the person's shows (all active ones when show_ids is None) see them as in."""
    memberships = ctx.store.list_memberships(user.user_id)
    shows = {s.show_id: s for s in ctx.store.get_shows((m.theater_id, m.show_id) for m in memberships)}
    stamp = now_iso()
    done = []
    for m in memberships:
        show = shows.get(m.show_id)
        if not show or show.status == "archived":
            continue
        if show_ids is not None and m.show_id not in show_ids:
            continue
        ctx.store.put_membership(
            m.model_copy(
                update={
                    "conflicts_submitted_at": stamp,
                    # Sending conflicts means they've arrived, whichever way they signed in.
                    "status": "joined",
                    "joined_at": m.joined_at or stamp,
                    "invite_token": None if m.status == "invited" else m.invite_token,
                }
            )
        )
        if m.status == "invited" and m.invite_token:
            ctx.store.delete_invite(m.invite_token)
        done.append(m.show_id)
    return done


# ---- What a person's shows need from them -----------------------------------------------------


class ShowDayView(Model):
    show_id: str
    date: str
    kind: Literal["rehearsal", "tech", "performance"]
    start: str | None = None
    end: str | None = None
    # Tech week and performances: everyone is expected.
    no_conflicts: bool = False


def my_days(ctx: Ctx, user: User) -> list[ShowDayView]:
    """Every date any of my active shows needs me, in date order, for the conflicts page."""
    memberships = ctx.store.list_memberships(user.user_id)
    shows = ctx.store.get_shows((m.theater_id, m.show_id) for m in memberships)
    out: list[ShowDayView] = []
    today = clock.today().isoformat()
    for show in shows:
        if show.status == "archived":
            continue
        lock = no_conflicts_from(show)
        for day in show_days(show):
            if day.date < today:
                continue
            out.append(
                ShowDayView(
                    show_id=show.show_id,
                    date=day.date,
                    kind=day.kind,
                    start=day.start,
                    end=day.end,
                    no_conflicts=bool(lock and day.date >= lock),
                )
            )
    out.sort(key=lambda d: (d.date, d.start or ""))
    return out


def show_conflicts(ctx: Ctx, user: User, show_id: str) -> list[MemberConflicts]:
    """Staff view: everyone's conflicts that touch this show's dates."""
    access = readable_show(ctx, show_id, user, "conflicts:read-all")
    show = access.show
    out = []
    for m in ctx.store.list_members(show_id):
        weekly, dates = ctx.store.get_conflicts(m.user_id)
        out.append(
            MemberConflicts(
                user_id=m.user_id,
                weekly=weekly,
                dates=[d for d in dates if show.start_date <= d.date <= show.end_date],
            )
        )
    return out
