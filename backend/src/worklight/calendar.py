"""Which dates a show needs people on, and how a person's conflicts apply to them."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from worklight.models import DateConflict, RehearsalSlot, Show, WeeklyConflict

DayKind = Literal["rehearsal", "tech", "performance"]


@dataclass(frozen=True)
class ShowDay:
    date: str
    kind: DayKind
    start: str | None
    end: str | None


def _dates(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def show_days(show: Show) -> list[ShowDay]:
    """Rehearsal dates from the usual nights (minus skipped ones) up to tech, then every day of tech week,
    then performances from opening night through closing."""
    first, last = date.fromisoformat(show.start_date), date.fromisoformat(show.end_date)
    tech = date.fromisoformat(show.tech_start) if show.tech_start else None
    opening = date.fromisoformat(show.opening_date) if show.opening_date else None
    slots: dict[int, RehearsalSlot] = {s.weekday: s for s in show.slots}
    skipped = set(show.skipped_dates)
    days: list[ShowDay] = []
    for d in _dates(first, last):
        iso = d.isoformat()
        slot = slots.get(d.weekday())
        if opening and d >= opening:
            days.append(ShowDay(iso, "performance", None, None))
        elif tech and d >= tech:
            days.append(ShowDay(iso, "tech", None, None))
        elif slot and iso not in skipped:
            days.append(ShowDay(iso, "rehearsal", slot.start, slot.end))
    return days


def no_conflicts_from(show: Show) -> str | None:
    """Tech week and performances are "no conflicts allowed"."""
    return show.tech_start or show.opening_date


@dataclass(frozen=True)
class Availability:
    level: Literal["free", "hard", "soft", "partial"]
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None
    # True when this comes from an answer for that exact date rather than a weekly rule.
    explicit: bool = False


def availability_on(day: str, weekly: list[WeeklyConflict], dates: list[DateConflict]) -> Availability:
    for d in dates:
        if d.date == day:
            return Availability(d.level, d.arrive, d.leave, d.note, explicit=True)
    weekday = date.fromisoformat(day).weekday()
    for w in weekly:
        if w.weekday == weekday:
            return Availability(w.level, w.arrive, w.leave, w.note)
    return Availability("free")
