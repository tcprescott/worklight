from tests.client import DIRECTOR, Client, join, set_up_show
from tests.fakes import FakeMailer
from worklight.calendar import availability_on, show_days
from worklight.models import DateConflict, RehearsalSlot, Show, WeeklyConflict

MIDSUMMER = {
    "slots": [{"weekday": d, "start": "19:00", "end": "21:30"} for d in (0, 1, 2, 3)]
    + [{"weekday": 5, "start": "10:00", "end": "13:00"}],
    "skippedDates": ["2026-11-26"],
    "techStart": "2026-11-29",
    "openingDate": "2026-12-04",
}


def test_show_days_cover_rehearsals_then_tech_then_performances() -> None:
    show = Show(
        show_id="s",
        theater_id="t",
        name="S",
        timezone="UTC",
        start_date="2026-11-02",
        end_date="2026-12-06",
        slots=[RehearsalSlot(weekday=0, start="19:00", end="21:30")],
        skipped_dates=["2026-11-09"],
        tech_start="2026-11-29",
        opening_date="2026-12-04",
        created_at="now",
    )
    days = show_days(show)
    assert [d.date for d in days if d.kind == "rehearsal"] == ["2026-11-02", "2026-11-16", "2026-11-23"]
    assert [d.date for d in days if d.kind == "tech"] == [
        f"2026-{x}" for x in ("11-29", "11-30", "12-01", "12-02", "12-03")
    ]
    assert [d.date for d in days if d.kind == "performance"] == ["2026-12-04", "2026-12-05", "2026-12-06"]


def test_a_date_answer_wins_over_the_weekly_rule() -> None:
    weekly = [WeeklyConflict(user_id="u", weekday=2, level="partial", arrive="19:45", updated_at="now")]
    dates = [DateConflict(user_id="u", date="2026-11-11", level="free", updated_at="now")]
    assert availability_on("2026-11-04", weekly, dates).arrive == "19:45"
    assert availability_on("2026-11-11", weekly, dates).level == "free"
    assert availability_on("2026-11-05", weekly, dates).level == "free"


def test_conflicts_belong_to_the_person_across_shows(call: Client, mailer: FakeMailer) -> None:
    _, midsummer = set_up_show(call, **MIDSUMMER)
    _, carol = set_up_show(call, "dana@example.org")
    join(call, mailer, midsummer, "maya@example.org")
    join(call, mailer, carol, "maya@example.org", sender="dana@example.org")

    saved = call.ok(
        "maya@example.org",
        "POST",
        "/api/me/conflicts",
        {
            "weekly": [{"weekday": 2, "level": "partial", "arrive": "19:45"}],
            "dates": [{"date": "2026-11-06", "level": "hard"}, {"date": "2026-11-18", "level": "soft"}],
            "submitTo": "all",
        },
    )
    assert [d["date"] for d in saved["dates"]] == ["2026-11-06", "2026-11-18"]

    # Both shows' staff see the same conflicts, and both count Maya as in.
    for staff, show_id in ((DIRECTOR, midsummer), ("dana@example.org", carol)):
        rows = call.ok(staff, "GET", f"/api/shows/{show_id}/conflicts")
        maya = next(r for r in rows if r["weekly"])
        assert maya["weekly"][0]["arrive"] == "19:45"
        assert len(maya["dates"]) == 2
        member = next(
            m
            for m in call.ok(staff, "GET", f"/api/shows/{show_id}/members")
            if m["email"] == "maya@example.org"
        )
        assert "conflictsSubmittedAt" in member

    # Cast don't see other people's conflicts.
    assert call("maya@example.org", "GET", f"/api/shows/{midsummer}/conflicts")[0] == 403


def test_single_answers_save_and_clear(call: Client) -> None:
    assert (
        call.ok(
            "a@example.org",
            "PUT",
            "/api/me/conflicts/dates/2026-11-12",
            {"level": "partial", "arrive": "19:45"},
        )["arrive"]
        == "19:45"
    )
    call.ok("a@example.org", "PUT", "/api/me/conflicts/weekly/1", {"level": "hard"})
    assert call("a@example.org", "PUT", "/api/me/conflicts/dates/2026-11-13", {"level": "partial"}) == (
        400,
        {"error": "a partial conflict needs an arrive or leave time"},
    )
    assert call("a@example.org", "PUT", "/api/me/conflicts/weekly/9", {"level": "hard"})[0] == 400
    call.ok("a@example.org", "DELETE", "/api/me/conflicts/dates/2026-11-12")
    mine = call.ok("a@example.org", "GET", "/api/me/conflicts")
    assert (mine["dates"], [w["weekday"] for w in mine["weekly"]]) == ([], [1])

    # The guided setup replaces the usual week wholesale.
    call.ok("a@example.org", "POST", "/api/me/conflicts", {"weekly": [], "replaceWeekly": True})
    assert call.ok("a@example.org", "GET", "/api/me/conflicts")["weekly"] == []


def test_my_days_lists_what_each_active_show_needs(call: Client, mailer: FakeMailer) -> None:
    _, show_id = set_up_show(call, **(MIDSUMMER | {"endDate": "2026-12-06"}))
    join(call, mailer, show_id, "maya@example.org")
    days = call.ok("maya@example.org", "GET", "/api/me/days")
    rehearsals = [d for d in days if d["kind"] == "rehearsal"]
    assert rehearsals[0] == {
        "showId": show_id,
        "date": "2026-11-02",
        "kind": "rehearsal",
        "start": "19:00",
        "end": "21:30",
        "noConflicts": False,
    }
    assert "2026-11-26" not in {d["date"] for d in days}
    assert all(d["noConflicts"] for d in days if d["date"] >= "2026-11-29")

    call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/archive")
    assert call.ok("maya@example.org", "GET", "/api/me/days") == []
