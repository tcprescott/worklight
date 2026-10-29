"""iCalendar (RFC 5545) for calendar feeds and one-off "add to calendar" downloads."""

from collections.abc import Iterable
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from worklight.ids import now_iso

PRODID = "-//Worklight//Rehearsal calls//EN"


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> list[str]:
    """Lines longer than 75 octets continue on the next line after a space."""
    out: list[str] = []
    raw = line.encode()
    while len(raw) > (limit := 75 if not out else 74):
        cut = limit
        # Don't split a UTF-8 character.
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(raw[:cut].decode())
        raw = raw[cut:]
    out.append(raw.decode())
    return [out[0], *(" " + part for part in out[1:])]


def _utc(day: str, hhmm: str, timezone: str) -> str:
    local = datetime.fromisoformat(f"{day}T{hhmm}").replace(tzinfo=ZoneInfo(timezone))
    return local.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _stamp(iso: str | None = None) -> str:
    moment = datetime.fromisoformat((iso or now_iso()).replace("Z", "+00:00"))
    return moment.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


class Event:
    def __init__(
        self,
        uid: str,
        day: str,
        start: str,
        end: str,
        timezone: str,
        summary: str,
        sequence: int = 0,
        location: str | None = None,
        description: str | None = None,
        cancelled: bool = False,
        url: str | None = None,
    ) -> None:
        self.uid = uid
        self.day = day
        self.start = start
        self.end = end
        self.timezone = timezone
        self.summary = summary
        self.sequence = sequence
        self.location = location
        self.description = description
        self.cancelled = cancelled
        self.url = url

    def lines(self) -> list[str]:
        out = [
            "BEGIN:VEVENT",
            f"UID:{self.uid}",
            f"DTSTAMP:{_stamp()}",
            f"DTSTART:{_utc(self.day, self.start, self.timezone)}",
            f"DTEND:{_utc(self.day, self.end, self.timezone)}",
            f"SEQUENCE:{self.sequence}",
            f"SUMMARY:{_escape(self.summary)}",
            f"STATUS:{'CANCELLED' if self.cancelled else 'CONFIRMED'}",
        ]
        if self.location:
            out.append(f"LOCATION:{_escape(self.location)}")
        if self.description:
            out.append(f"DESCRIPTION:{_escape(self.description)}")
        if self.url:
            out.append(f"URL:{self.url}")
        out.append("END:VEVENT")
        return out


def calendar(name: str, events: Iterable[Event]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(name)}",
        # Ask calendar apps to check back hourly.
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for event in events:
        lines.extend(event.lines())
    lines.append("END:VCALENDAR")
    return "".join(f"{folded}\r\n" for line in lines for folded in _fold(line))
