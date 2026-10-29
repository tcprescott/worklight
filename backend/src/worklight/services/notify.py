"""Telling people about their calls: calendar feeds, the day-before reminder, and change emails on publish."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from worklight import clock, ics, mailer
from worklight.ids import new_token, now_iso
from worklight.models import CallContent, Model, Show, User
from worklight.services.base import Ctx, NotFound
from worklight.services.schedule import Called, MyCall, ShowCast, _load_cast, my_calls

REMINDER_LEAD = timedelta(hours=24)


# ---- Calendar feeds -------------------------------------------------------------------------------


class CalendarLinks(Model):
    # https URL to paste into Google Calendar or Outlook.
    url: str
    # webcal:// URL that opens Apple Calendar (and most phone calendars) straight to "Subscribe".
    webcal_url: str


def _links(ctx: Ctx, token: str) -> CalendarLinks:
    url = ctx.link(f"/api/public/calendar/{token}.ics")
    return CalendarLinks(url=url, webcal_url="webcal://" + url.split("://", 1)[1])


def calendar_links(ctx: Ctx, user: User, rotate: bool = False) -> CalendarLinks:
    """The person's private feed of every call that needs them. Rotating kills the old link."""
    current = ctx.store.get_user(user.user_id) or user
    if current.calendar_token and not rotate:
        return _links(ctx, current.calendar_token)
    if current.calendar_token:
        ctx.store.delete_feed(current.calendar_token)
    token = new_token()
    ctx.store.put_feed(token, user.user_id)
    ctx.store.put_user(current.model_copy(update={"calendar_token": token}))
    return _links(ctx, token)


def _event(ctx: Ctx, c: MyCall) -> ics.Event:
    what = ", ".join(c.labels) or c.title or c.type.capitalize()
    details = [f"Called {mailer.pretty_time(c.start)} to {mailer.pretty_time(c.end)}: {what}"]
    if (c.start, c.end) != (c.call_start, c.call_end):
        details.append(f"Full call {mailer.pretty_time(c.call_start)} to {mailer.pretty_time(c.call_end)}")
    if c.bring:
        details.append(f"Bring: {c.bring}")
    if c.note:
        details.append(c.note)
    where = ", ".join(x for x in (c.location, c.address) if x) or None
    return ics.Event(
        uid=f"{c.call_id}@worklight",
        day=c.date,
        start=c.start,
        end=c.end,
        timezone=c.timezone,
        summary=f"{c.show_name}: {what}",
        sequence=c.sequence,
        location=where,
        description="\n".join(details),
        cancelled=c.cancelled,
        url=ctx.link(f"/shows/{c.show_id}/calls"),
    )


def feed(ctx: Ctx, token: str) -> str:
    """Public: the feed is found by its unguessable token, so calendar apps need no sign-in."""
    user_id = ctx.store.get_feed_user_id(token)
    user = ctx.store.get_user(user_id) if user_id else None
    if not user or user.calendar_token != token:
        raise NotFound("This calendar link has been replaced. Get the new one in Worklight.")
    calls = my_calls(ctx, user, include_past=True)
    return ics.calendar("Worklight calls", (_event(ctx, c) for c in calls))


def call_ics(ctx: Ctx, user: User, call_id: str) -> str:
    """One call, for "Add to calendar"."""
    call = next((c for c in my_calls(ctx, user, include_past=True) if c.call_id == call_id), None)
    if not call:
        raise NotFound("Call not found")
    return ics.calendar(call.show_name, [_event(ctx, call)])


# ---- The day-before reminder ---------------------------------------------------------------------


def _starts_at(day: str, hhmm: str, timezone: str) -> datetime:
    return datetime.fromisoformat(f"{day}T{hhmm}").replace(tzinfo=ZoneInfo(timezone)).astimezone(UTC)


def send_reminders(ctx: Ctx) -> int:
    """Run hourly: emails everyone called for each published call starting in the next 24 hours, once."""
    now = clock.now()
    sent = 0
    for show in ctx.store.all_shows():
        if show.status == "archived":
            continue
        local_today = now.astimezone(ZoneInfo(show.timezone)).date()
        upcoming = [
            c
            for c in ctx.store.list_calls(
                show.show_id, local_today.isoformat(), (local_today + timedelta(days=2)).isoformat()
            )
            if c.published and not c.published.cancelled and not c.reminded_at
        ]
        if not upcoming:
            continue
        cast, _ = _load_cast(ctx, show)
        users: dict[str, User] = {}
        for call in upcoming:
            content = call.published
            assert content
            starts = _starts_at(content.date, content.start, show.timezone)
            if not (starts - REMINDER_LEAD <= now < starts):
                continue
            called = cast.called(content)
            missing = [u for u in called if u not in users]
            users.update({u.user_id: u for u in ctx.store.get_users(missing)})
            for uid, entry in called.items():
                person = users.get(uid)
                if not person or not person.prefs.email_reminders:
                    continue
                ctx.mailer.send(
                    mailer.call_reminder_email(
                        to=person.email,
                        show_name=show.name,
                        day=content.date,
                        start=entry.start,
                        end=entry.end,
                        what=", ".join(entry.labels) or content.title or "Rehearsal",
                        where=content.location or show.venue,
                        bring=content.bring,
                        url=ctx.link(f"/shows/{show.show_id}/calls"),
                    )
                )
                sent += 1
            ctx.store.put_call(call.model_copy(update={"reminded_at": now_iso()}))
    return sent


# ---- Change emails on publish ---------------------------------------------------------------------


def _line(content: CallContent, entry: Called, what: str) -> str:
    times = f"{mailer.pretty_time(entry.start)} to {mailer.pretty_time(entry.end)}"
    when = f"{mailer.pretty_date(content.date)}, {times}"
    label = ", ".join(entry.labels) or content.title or "Rehearsal"
    return f"{when}: {label}{what}"


def schedule_published(ctx: Ctx, show: Show, changes: list[tuple[CallContent | None, CallContent]]) -> int:
    """After a publish: one email per person whose upcoming calls were added, changed or cancelled.

    changes holds (published copy before, published copy now) for each call the publish touched."""
    cast, _ = _load_cast(ctx, show)
    today = clock.today().isoformat()
    lines: dict[str, list[tuple[str, str]]] = {}
    first_time: dict[str, bool] = {}
    for before, after in sorted(changes, key=lambda pair: (pair[1].date, pair[1].start)):
        if after.date < today:
            continue
        was = cast.called(before) if before else {}
        if after.cancelled:
            for uid, entry in was.items():
                lines.setdefault(uid, []).append((after.date, _line(after, entry, " (cancelled)")))
                first_time[uid] = False
            continue
        now = cast.called(after)
        for uid, entry in now.items():
            old = was.get(uid)
            if old is None:
                lines.setdefault(uid, []).append((after.date, _line(after, entry, "")))
                first_time.setdefault(uid, before is None)
                first_time[uid] = first_time[uid] and before is None
            elif (old.start, old.end, old.labels) != (entry.start, entry.end, entry.labels) or (
                before
                and (before.location, before.bring, before.note) != (after.location, after.bring, after.note)
            ):
                lines.setdefault(uid, []).append((after.date, _line(after, entry, " (changed)")))
                first_time[uid] = False
        for uid, entry in was.items():
            if uid not in now:
                lines.setdefault(uid, []).append(
                    (after.date, _line(after, entry, " (you're no longer called)"))
                )
                first_time[uid] = False
    if not lines:
        return 0
    sent = 0
    for person in ctx.store.get_users(list(lines)):
        if not person.prefs.change_emails:
            continue
        ctx.mailer.send(
            mailer.schedule_update_email(
                to=person.email,
                show_name=show.name,
                lines=[text for _, text in lines[person.user_id]],
                first=first_time.get(person.user_id, False),
                url=ctx.link(f"/shows/{show.show_id}/calls"),
            )
        )
        sent += 1
    return sent


__all__ = [
    "CalendarLinks",
    "ShowCast",
    "calendar_links",
    "call_ics",
    "feed",
    "schedule_published",
    "send_reminders",
]
