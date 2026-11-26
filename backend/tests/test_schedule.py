from datetime import UTC, datetime
from typing import Any

import pytest

from tests.client import DIRECTOR, Client, join, set_up_show
from tests.fakes import FakeMailer
from worklight import clock

MIDSUMMER = {
    "slots": [{"weekday": d, "start": "19:00", "end": "21:30"} for d in (0, 1, 2, 3)],
    "techStart": "2026-11-29",
    "openingDate": "2026-12-04",
    "endDate": "2026-12-06",
    "minutesPerPage": 8,
}


def _show(call: Client, mailer: FakeMailer) -> dict[str, Any]:
    """Midsummer with two scenes: 1.1 (Hermia, Lysander) and 1.2 (Bottom)."""
    _, show_id = set_up_show(call, **MIDSUMMER)
    base = f"/api/shows/{show_id}"
    maya = join(call, mailer, show_id, "maya@example.org", name="Maya Chen")
    jay = join(call, mailer, show_id, "jay@example.org", name="Jay Patel")
    george = join(call, mailer, show_id, "george@example.org", name="George Haddad")
    sam = join(call, mailer, show_id, "sam@example.org", role="crew", department="Lighting")
    act = call.ok(DIRECTOR, "POST", f"{base}/acts", {"name": "Act 1"})
    chars = {
        name: call.ok(DIRECTOR, "POST", f"{base}/characters", {"name": name, "castUserIds": [uid]})["charId"]
        for name, uid in (("Hermia", maya), ("Lysander", jay), ("Bottom", george))
    }
    s1 = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/scenes",
        {
            "actId": act["actId"],
            "name": "Theseus's palace",
            "eighths": 48,
            "characterIds": [chars["Hermia"], chars["Lysander"]],
        },
    )["sceneId"]
    s2 = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/scenes",
        {"actId": act["actId"], "name": "Quince's house", "eighths": 24, "characterIds": [chars["Bottom"]]},
    )["sceneId"]
    return {
        "id": show_id,
        "base": base,
        "maya": maya,
        "jay": jay,
        "george": george,
        "sam": sam,
        "s1": s1,
        "s2": s2,
    }


def test_blocks_fill_in_times_and_call_only_whos_in_them(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    # Monday Nov 9: drag 1.1 then 1.2 onto the night; the call comes from the usual hours.
    first = call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    assert (first["start"], first["end"], first["type"]) == ("19:00", "21:30", "rehearsal")
    call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s2"]})

    week = call.ok(DIRECTOR, "GET", f"{base}/schedule?from=2026-11-09&to=2026-11-15")
    assert week["editing"] is True
    assert [d["date"] for d in week["days"]] == ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]
    night = week["days"][0]["calls"][0]
    # 6 pages at 8 minutes a page is 50 min (rounded to 5); 3 pages is 25.
    assert [(b["start"], b["end"]) for b in night["blocks"]] == [("19:00", "19:50"), ("19:50", "20:15")]
    assert night["freeMinutes"] == 75
    assert night["calledCount"] == 3
    assert night["status"] == "draft"

    # Cast see nothing until it's published.
    assert (
        call.ok("maya@example.org", "GET", f"{base}/schedule?from=2026-11-09&to=2026-11-15")["days"][0][
            "calls"
        ]
        == []
    )
    assert call.ok("maya@example.org", "GET", "/api/me/calls") == []

    result = call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", {"from": "2026-11-09", "to": "2026-11-15"})
    assert result["published"] == 1

    maya_calls = call.ok("maya@example.org", "GET", "/api/me/calls")
    assert [(c["date"], c["start"], c["end"], c["labels"]) for c in maya_calls] == [
        ("2026-11-09", "19:00", "19:50", ["1.1 Theseus's palace"])
    ]
    george_calls = call.ok("george@example.org", "GET", "/api/me/calls")
    assert (george_calls[0]["start"], george_calls[0]["end"]) == ("19:50", "20:15")
    assert call.ok("sam@example.org", "GET", "/api/me/calls") == []

    days = call.ok("maya@example.org", "GET", "/api/me/days")
    assert next(d for d in days if d["date"] == "2026-11-09")["called"] is True


def test_warnings_flag_conflicts_inside_each_block(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    call.ok(
        "maya@example.org",
        "PUT",
        "/api/me/conflicts/dates/2026-11-09",
        {"level": "partial", "arrive": "19:45"},
    )
    call.ok("jay@example.org", "PUT", "/api/me/conflicts/weekly/0", {"level": "soft"})
    call.ok("george@example.org", "PUT", "/api/me/conflicts/dates/2026-11-09", {"level": "hard"})
    call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s2"]})
    blocks = call.ok(DIRECTOR, "GET", f"{base}/schedule?from=2026-11-09&to=2026-11-09")["days"][0]["calls"][
        0
    ]["blocks"]
    first = {w["part"]: (w["kind"], w.get("arrive")) for w in blocks[0]["warnings"]}
    assert first == {"Hermia": ("partial", "19:45"), "Lysander": ("soft", None)}
    assert [(w["part"], w["kind"]) for w in blocks[1]["warnings"]] == [("Bottom", "hard")]

    ranked = call.ok(
        DIRECTOR, "GET", f"{base}/schedule/suggestions?date=2026-11-10&from=2026-11-09&to=2026-11-15"
    )
    # Tuesday: nobody has conflicts and both were done Monday, so it falls back to script order.
    assert [(s["sceneId"], s["score"], s["nightsInRange"], s["lastRehearsed"]) for s in ranked["scenes"]] == [
        (show["s1"], 0, 1, "2026-11-09"),
        (show["s2"], 0, 1, "2026-11-09"),
    ]
    monday = call.ok(DIRECTOR, "GET", f"{base}/schedule/suggestions?date=2026-11-09")
    assert [s["score"] for s in monday["scenes"]] == [4, 10]
    assert monday["freeMinutes"] == 75


def test_another_shows_call_is_a_hard_called_elsewhere(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    _, carol = set_up_show(call, "dana@example.org", name="A Christmas Carol")
    join(call, mailer, carol, "maya@example.org", sender="dana@example.org")
    call.ok(
        "dana@example.org",
        "POST",
        f"/api/shows/{carol}/calls",
        {"date": "2026-11-09", "start": "19:30", "end": "21:00", "groups": ["everyone"]},
    )
    call.ok(DIRECTOR, "POST", f"{show['base']}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})

    def warnings() -> list[Any]:
        week = call.ok(DIRECTOR, "GET", f"{show['base']}/schedule?from=2026-11-09&to=2026-11-09")
        return week["days"][0]["calls"][0]["blocks"][0]["warnings"]

    # A draft call in another show doesn't count yet.
    assert warnings() == []
    call.ok(
        "dana@example.org",
        "POST",
        f"/api/shows/{carol}/schedule/publish",
        {"from": "2026-11-09", "to": "2026-11-09"},
    )
    (w,) = warnings()
    assert (w["part"], w["kind"]) == ("Hermia", "elsewhere")
    assert "Carol" not in str(w)

    # Maya herself sees which show called her.
    days = call.ok("maya@example.org", "GET", "/api/me/days")
    monday = next(d for d in days if d["date"] == "2026-11-09" and d["showId"] == show["id"])
    assert monday["calledBy"] == "A Christmas Carol"


def test_republishing_bumps_the_sequence_and_cancels(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    made = call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    span = {"from": "2026-11-09", "to": "2026-11-15"}
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", span)
    assert call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", span)["published"] == 0

    call.ok(DIRECTOR, "PATCH", f"{base}/calls/{made['callId']}", {"bring": "A pencil", "end": "21:00"})
    view = call.ok(DIRECTOR, "GET", f"{base}/schedule?from=2026-11-09&to=2026-11-09")["days"][0]["calls"][0]
    assert view["unpublishedChanges"] is True
    # Cast still see the old copy.
    assert call.ok("maya@example.org", "GET", "/api/me/calls")[0].get("bring") is None
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", span)
    mine = call.ok("maya@example.org", "GET", "/api/me/calls")[0]
    assert (mine["bring"], mine["sequence"]) == ("A pencil", 1)

    call.ok(DIRECTOR, "DELETE", f"{base}/calls/{made['callId']}")
    assert call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", span)["cancelled"] == 1
    mine = call.ok("maya@example.org", "GET", "/api/me/calls")[0]
    assert (mine["cancelled"], mine["sequence"]) == (True, 2)

    # A draft nobody saw just goes.
    draft = call.ok(DIRECTOR, "POST", f"{base}/calls", {"date": "2026-11-10"})
    call.ok(DIRECTOR, "DELETE", f"{base}/calls/{draft['callId']}")
    assert (
        call.ok(DIRECTOR, "GET", f"{base}/schedule?from=2026-11-10&to=2026-11-10")["days"][0]["calls"] == []
    )


def test_call_rules(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    status, err = call(DIRECTOR, "POST", f"{base}/calls", {"date": "2026-11-07"})
    assert status == 400 and "start and end" in err["error"]
    status, _ = call(
        DIRECTOR, "POST", f"{base}/calls", {"date": "2027-03-01", "start": "19:00", "end": "20:00"}
    )
    assert status == 400
    status, _ = call(
        DIRECTOR, "POST", f"{base}/calls", {"date": "2026-11-09", "start": "21:00", "end": "20:00"}
    )
    assert status == 400
    status, _ = call(
        DIRECTOR, "POST", f"{base}/calls", {"date": "2026-11-09", "blocks": [{"sceneIds": ["nope"]}]}
    )
    assert status == 400
    status, _ = call("maya@example.org", "POST", f"{base}/calls", {"date": "2026-11-09"})
    assert status == 403
    status, _ = call("maya@example.org", "GET", f"{base}/schedule/suggestions?date=2026-11-09")
    assert status == 403


def test_tech_week_calls_and_attendance(
    call: Client, mailer: FakeMailer, monkeypatch: pytest.MonkeyPatch
) -> None:
    show = _show(call, mailer)
    base = show["base"]
    call.ok(
        DIRECTOR,
        "PATCH",
        f"/api/shows/{show['id']}/members/{show['sam']}",
        {"title": "Stage manager", "role": "staff"},
    )
    made = call.ok(
        DIRECTOR, "POST", f"{base}/tech-calls", {"start": "18:00", "end": "22:00", "crewStart": "17:30"}
    )
    assert [c["title"] for c in made][:2] == ["Tech night 1", "Tech night 2"]
    assert [c["type"] for c in made][-3:] == ["performance"] * 3
    assert len(made) == 8
    # Running it again doesn't duplicate.
    assert call.ok(DIRECTOR, "POST", f"{base}/tech-calls", {"start": "18:00", "end": "22:00"}) == []
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", {"from": "2026-11-29", "to": "2026-12-06"})

    sam_call = call.ok("sam@example.org", "GET", "/api/me/calls")[0]
    assert (sam_call["start"], sam_call["labels"]) == ("17:30", ["Tech night 1"])
    assert call.ok("maya@example.org", "GET", "/api/me/calls")[0]["start"] == "18:00"

    # Staff standing in the hall save where it is.
    hall = {"lat": 41.8789, "lng": -87.6359}
    call.ok(DIRECTOR, "PUT", f"{base}/venue-location", hall)

    # 5:20 PM in Chicago on Nov 29: too early for "I'm here" (opens 5:30 for a 6:00 call).
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 29, 23, 20, tzinfo=UTC))
    status, body = call("maya@example.org", "POST", f"{base}/check-in", hall)
    assert status == 400 and "5:30 PM" in body["error"]

    # 6:10 PM.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 30, 0, 10, tzinfo=UTC))
    board = call.ok(DIRECTOR, "GET", f"{base}/attendance")
    assert board["tonight"] == "2026-11-29" and board["venueSet"]
    assert len(board["nights"]) == 8
    assert {p["userId"] for p in board["nights"][0]["called"]} >= {show["maya"], show["sam"]}
    assert {p["label"] for p in board["people"]} >= {"Hermia", "Stage manager"}

    # Four miles away is refused; no location at all checks in with a flag.
    status, body = call("maya@example.org", "POST", f"{base}/check-in", {"lat": 41.93, "lng": -87.6359})
    assert status == 400 and "4 miles" in body["error"]
    arrived = call.ok("maya@example.org", "POST", f"{base}/check-in", {**hall, "accuracy": 30})
    assert (arrived["checkin"]["status"], arrived["minutesLate"]) == ("late", 10)
    assert arrived["checkin"]["location"] == "confirmed"
    jay = call.ok("jay@example.org", "POST", f"{base}/check-in", {})
    assert jay["checkin"]["location"] == "unknown"

    # George says he can't come tomorrow or Tuesday; stage management gets one email.
    mailer.sent.clear()
    reported = call.ok(
        "george@example.org",
        "POST",
        f"{base}/absences",
        {"dates": ["2026-11-30", "2026-12-01"], "kind": "absent", "note": "parking"},
    )
    assert [r["date"] for r in reported] == ["2026-11-30", "2026-12-01"]
    assert [m.to for m in mailer.sent] == ["sam@example.org"]
    assert "George Haddad can't come Mon Nov 30 and Tue Dec 1" in mailer.sent[0].subject
    status, _ = call(
        "george@example.org", "POST", f"{base}/absences", {"dates": ["2026-11-20"], "kind": "absent"}
    )
    assert status == 400
    status, _ = call(
        "george@example.org", "POST", f"{base}/absences", {"dates": ["2026-12-02"], "kind": "late"}
    )
    assert status == 400
    call.ok(
        "george@example.org",
        "POST",
        f"{base}/absences",
        {"dates": ["2026-11-29"], "kind": "late", "time": "18:30"},
    )

    mine = call.ok("george@example.org", "GET", f"{base}/my-attendance")
    assert [(c["date"], c["report"]) for c in mine["checkins"]] == [
        ("2026-11-29", "late"),
        ("2026-11-30", "absent"),
        ("2026-12-01", "absent"),
    ]
    assert "seenByName" not in mine["checkins"][1]
    call.ok("sam@example.org", "POST", f"{base}/attendance/2026-11-30/{show['george']}/seen")
    mine = call.ok("george@example.org", "GET", f"{base}/my-attendance")
    assert mine["checkins"][1]["seenByName"]
    call.ok("george@example.org", "DELETE", f"{base}/absences/2026-12-01")
    mine = call.ok("george@example.org", "GET", f"{base}/my-attendance")
    assert [c["date"] for c in mine["checkins"]] == ["2026-11-29", "2026-11-30"]

    call.ok(DIRECTOR, "PUT", f"{base}/attendance/2026-11-29/{show['george']}", {"status": "absent"})
    call.ok(DIRECTOR, "PUT", f"{base}/attendance/2026-11-29/{show['maya']}", {"status": None})
    marks = {
        c["userId"]: c
        for c in call.ok(DIRECTOR, "GET", f"{base}/attendance")["checkins"]
        if c["date"] == "2026-11-29"
    }
    assert marks[show["george"]]["status"] == "absent" and marks[show["george"]]["report"] == "late"
    assert show["maya"] not in marks

    # The company home counts reports nobody has said "Got it" to (just tonight's, now).
    theater_id = call.ok(DIRECTOR, "GET", f"/api/shows/{show['id']}")["show"]["theaterId"]
    summary = call.ok(DIRECTOR, "GET", f"/api/theaters/{theater_id}")["shows"][0]
    assert summary["unseenReports"] == 1

    status, _ = call("maya@example.org", "GET", f"{base}/attendance")
    assert status == 403
