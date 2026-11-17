from datetime import UTC, datetime

import pytest

from tests.client import DIRECTOR, Client
from tests.fakes import FakeMailer
from tests.test_schedule import _show
from worklight import clock
from worklight.services.base import Ctx
from worklight.services.notify import send_reminders
from worklight.store import DynamoStore

WEEK = {"from": "2026-11-09", "to": "2026-11-15"}


def test_publishing_emails_each_person_their_calls_then_changes(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    made = call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s2"]})
    mailer.sent.clear()
    result = call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", WEEK)
    assert result["notified"] == 3
    maya = next(m for m in mailer.sent if m.to == "maya@example.org")
    assert maya.subject == "Our Town: your calls"
    assert "Monday, November 9, 7:00 PM to 7:50 PM: 1.1 Theseus's palace" in maya.text

    # Bottom's scene moves later; only George hears about it... and Maya, whose block is now shorter.
    mailer.sent.clear()
    blocks = call.ok(DIRECTOR, "GET", f"{base}/schedule?from=2026-11-09&to=2026-11-09")["days"][0]["calls"][
        0
    ]["blocks"]
    call.ok(
        DIRECTOR,
        "PATCH",
        f"{base}/calls/{made['callId']}",
        {
            "blocks": [
                {"blockId": blocks[0]["blockId"], "sceneIds": [show["s1"]], "minutes": 50},
                {"blockId": blocks[1]["blockId"], "sceneIds": [show["s2"]], "start": "20:30"},
            ]
        },
    )
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", WEEK)
    assert [m.to for m in mailer.sent] == ["george@example.org"]
    assert "(changed)" in mailer.sent[0].text and mailer.sent[0].subject == "Our Town: schedule update"

    # People who turn change emails off don't get them.
    call.ok("george@example.org", "PATCH", "/api/me", {"prefs": {"changeEmails": False}})
    mailer.sent.clear()
    call.ok(DIRECTOR, "DELETE", f"{base}/calls/{made['callId']}")
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", WEEK)
    assert sorted(m.to for m in mailer.sent) == ["jay@example.org", "maya@example.org"]
    assert "(cancelled)" in mailer.sent[0].text


def test_day_before_reminders_go_once(
    call: Client, mailer: FakeMailer, store: DynamoStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    show = _show(call, mailer)
    call.ok(DIRECTOR, "POST", f"{show['base']}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    call.ok(DIRECTOR, "POST", f"{show['base']}/schedule/publish", WEEK)
    call.ok("jay@example.org", "PATCH", "/api/me", {"prefs": {"emailReminders": False}})
    ctx = Ctx(store=store, mailer=mailer, app_url="https://worklight.test")
    mailer.sent.clear()

    # 7:00 PM Monday in Chicago is 01:00 UTC Tuesday. Two days out: nothing yet.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 8, 0, 30, tzinfo=UTC))
    assert send_reminders(ctx) == 0
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 9, 1, 30, tzinfo=UTC))
    assert send_reminders(ctx) == 1
    assert mailer.sent[0].to == "maya@example.org"
    assert mailer.sent[0].subject == "Tomorrow: Our Town at 7:00 PM"
    assert send_reminders(ctx) == 0


def test_calendar_feed(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    made = call.ok(DIRECTOR, "POST", f"{show['base']}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    call.ok(DIRECTOR, "PATCH", f"{show['base']}/calls/{made['callId']}", {"bring": "Script, pencil"})
    call.ok(DIRECTOR, "POST", f"{show['base']}/schedule/publish", WEEK)

    links = call.ok("maya@example.org", "GET", "/api/me/calendar")
    assert links["webcalUrl"].startswith("webcal://worklight.test/api/public/calendar/")
    assert call.ok("maya@example.org", "GET", "/api/me/calendar") == links
    path = links["url"].removeprefix("https://worklight.test")
    status, body = call(None, "GET", path)
    assert status == 200, (path, body)
    assert "BEGIN:VCALENDAR" in body and "\r\n" in body
    assert f"UID:{made['callId']}@worklight" in body
    # 7:00 PM Chicago is 01:00 UTC the next day; Maya's block ends at 7:50.
    assert "DTSTART:20261110T010000Z" in body and "DTEND:20261110T015000Z" in body
    assert "SUMMARY:Our Town: 1.1 Theseus's palace" in body
    assert "Bring: Script\\, pencil" in body

    status, one = call("maya@example.org", "GET", f"/api/me/calls/{made['callId']}.ics")
    assert status == 200 and one.count("BEGIN:VEVENT") == 1

    new = call.ok("maya@example.org", "POST", "/api/me/calendar/rotate")
    assert new["url"] != links["url"]
    assert call(None, "GET", path)[0] == 404


def test_callboard(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    mailer.sent.clear()
    cast_notice = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/notices",
        {"title": "Off-book dates", "body": "Act 1 by Nov 16.", "audience": "cast", "pinned": True},
    )
    assert sorted(m.to for m in mailer.sent) == ["george@example.org", "jay@example.org", "maya@example.org"]
    call.ok(
        DIRECTOR,
        "POST",
        f"{base}/notices",
        {"title": "Set build", "body": "Saturday.", "audience": "crew", "email": False},
    )
    call.ok(DIRECTOR, "POST", f"{base}/notices", {"title": "Welcome", "body": "Hi all."})

    maya = call.ok("maya@example.org", "GET", f"{base}/notices")
    assert [n["title"] for n in maya["notices"]] == ["Off-book dates", "Welcome"]
    assert maya["unread"] == 2 and maya["canPost"] is False
    assert "readCount" not in maya["notices"][0]
    sam = call.ok("sam@example.org", "GET", f"{base}/notices")
    assert [n["title"] for n in sam["notices"]] == ["Welcome", "Set build"]

    call.ok("maya@example.org", "POST", f"{base}/notices/read", {"noticeIds": [cast_notice["noticeId"]]})
    assert call.ok("maya@example.org", "GET", f"{base}/notices")["unread"] == 1
    staff = call.ok(DIRECTOR, "GET", f"{base}/notices")
    pinned = staff["notices"][0]
    assert (pinned["title"], pinned["readCount"], pinned["audienceCount"]) == ("Off-book dates", 1, 3)
    assert staff["canPost"] is True

    status, _ = call("maya@example.org", "POST", f"{base}/notices", {"title": "x", "body": "y"})
    assert status == 403
    call.ok(DIRECTOR, "PATCH", f"{base}/notices/{cast_notice['noticeId']}", {"pinned": False})
    call.ok(DIRECTOR, "DELETE", f"{base}/notices/{cast_notice['noticeId']}")
    assert [n["title"] for n in call.ok("maya@example.org", "GET", f"{base}/notices")["notices"]] == [
        "Welcome"
    ]


def test_ics_lines_fold_at_75_octets_without_splitting_characters() -> None:
    from worklight.ics import _fold

    lines = _fold("DESCRIPTION:" + "é" * 100)
    assert all(len(line.encode()) <= 75 for line in lines)
    assert all(line.startswith(" ") for line in lines[1:])
    assert "".join(line.removeprefix(" ") for line in lines) == "DESCRIPTION:" + "é" * 100
