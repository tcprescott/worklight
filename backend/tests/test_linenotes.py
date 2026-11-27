import json
from typing import Any

from tests.client import DIRECTOR, Client, join
from tests.fakes import FakeMailer
from tests.test_public_api import _as, _key
from tests.test_schedule import _show


def _chars(call: Client, show: dict[str, Any]) -> dict[str, str]:
    breakdown = call.ok(DIRECTOR, "GET", f"{show['base']}/breakdown")
    return {c["name"]: c["charId"] for c in breakdown["characters"]}


def _set(call: Client, show: dict[str, Any], who: str = DIRECTOR) -> str:
    made = call.ok(who, "POST", f"{show['base']}/notes", {"date": "2026-11-25", "title": "Run of Act I"})
    assert "releasedAt" not in made
    return str(made["setId"])


def test_notes_stay_private_until_released(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    chars = _chars(call, show)
    set_id = _set(call, show)
    notes = f"{base}/notes/{set_id}/notes"
    added = call.ok(
        DIRECTOR,
        "POST",
        notes,
        {
            "notes": [
                # By part: the actor comes from the cast list.
                {
                    "charId": chars["Bottom"],
                    "kind": "paraphrase",
                    "page": "12",
                    "sceneId": show["s2"],
                    "scriptText": "to gleek upon occasion",
                    "saidText": "to joke on occasion",
                },
                {"actorId": show["maya"], "kind": "dropped", "page": "3", "scriptText": "O hell!"},
                {"actorId": show["maya"], "kind": "late", "page": "10a", "comment": "Missed the door"},
            ]
        },
    )
    assert [n["actorId"] for n in added] == [show["george"], show["maya"], show["maya"]]

    # Drafts: actors see nothing yet, and get nothing.
    sent_before = len(mailer.sent)
    assert call.ok("maya@example.org", "GET", f"{base}/notes")["sets"] == []
    assert call("maya@example.org", "GET", f"{base}/notes/{set_id}")[0] == 404
    assert (
        call("maya@example.org", "POST", notes, {"notes": [{"actorId": show["jay"], "kind": "dropped"}]})[0]
        == 403
    )

    detail = call.ok(DIRECTOR, "GET", f"{base}/notes/{set_id}")
    assert detail["canRelease"] is True and detail["set"]["noteCount"] == 3
    # Page order, with numbers before letters.
    assert [n["page"] for n in detail["notes"]] == ["3", "10a", "12"]
    assert detail["notes"][2]["sceneLabel"].endswith("Quince's house")

    released = call.ok(DIRECTOR, "POST", f"{base}/notes/{set_id}/release")
    assert released["actorCount"] == 2
    new = mailer.sent[sent_before:]
    assert sorted(e.to for e in new) == ["george@example.org", "maya@example.org"]
    maya_mail = next(e for e in new if e.to == "maya@example.org")
    assert "2 line notes" in maya_mail.text and "O hell" not in maya_mail.text
    assert call(DIRECTOR, "POST", f"{base}/notes/{set_id}/release")[0] == 409

    # Maya sees only her own two notes, and opening them is recorded for staff.
    home = call.ok("maya@example.org", "GET", f"{base}/notes")
    assert [s["noteCount"] for s in home["sets"]] == [2] and home["canTake"] is False
    mine = call.ok("maya@example.org", "GET", f"{base}/notes/{set_id}")
    assert {n["actorId"] for n in mine["notes"]} == {show["maya"]} and mine["canEdit"] is False
    assert call.ok("jay@example.org", "GET", f"{base}/notes")["sets"] == []
    assert call("jay@example.org", "GET", f"{base}/notes/{set_id}")[0] == 404

    actors = {a["userId"]: a for a in call.ok(DIRECTOR, "GET", f"{base}/notes/{set_id}")["actors"]}
    assert actors[show["maya"]]["openedAt"] and "openedAt" not in actors[show["george"]]
    assert actors[show["maya"]]["characters"] == ["Hermia"]

    # Staff can still fix a note after release; the actor sees it marked as updated.
    note_id = next(n["noteId"] for n in mine["notes"] if n["kind"] == "dropped")
    call.ok(DIRECTOR, "PATCH", f"{notes}/{note_id}", {"comment": "Second time this week"})
    again = call.ok("maya@example.org", "GET", f"{base}/notes/{set_id}")
    assert next(n for n in again["notes"] if n["noteId"] == note_id)["updatedAfterRelease"] is True


def test_crew_note_taker_files_drafts_but_cannot_release(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    # Sam (crew) can't take notes until staff say so.
    assert call("sam@example.org", "POST", f"{base}/notes", {"date": "2026-11-25", "title": "Run"})[0] == 403
    member = call.ok(DIRECTOR, "PATCH", f"{base}/members/{show['sam']}", {"noteTaker": True})
    assert member["noteTaker"] is True
    # Only crew can be note-takers.
    assert call(DIRECTOR, "PATCH", f"{base}/members/{show['maya']}", {"noteTaker": True})[0] == 400

    set_id = _set(call, show, "sam@example.org")
    home = call.ok("sam@example.org", "GET", f"{base}/notes")
    assert home["canTake"] is True and home["canRelease"] is False
    assert [c["characters"] for c in home["cast"]] == [["Hermia"], ["Lysander"], ["Bottom"]]
    call.ok(
        "sam@example.org",
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"actorId": show["jay"], "kind": "called", "page": "4"}]},
    )
    # Notes only go to cast.
    status, err = call(
        "sam@example.org",
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"actorId": show["sam"], "kind": "called"}]},
    )
    assert status == 400 and "cast" in err["error"]
    assert call("sam@example.org", "POST", f"{base}/notes/{set_id}/release")[0] == 403
    call.ok(DIRECTOR, "POST", f"{base}/notes/{set_id}/release")

    # Once released, the note-taker no longer sees the set or can change it.
    assert call.ok("sam@example.org", "GET", f"{base}/notes")["sets"] == []
    assert call("sam@example.org", "DELETE", f"{base}/notes/{set_id}")[0] == 403

    # Moving Sam to cast ends note-taking.
    call.ok(DIRECTOR, "PATCH", f"{base}/members/{show['sam']}", {"role": "cast"})
    members = {m["userId"]: m for m in call.ok(DIRECTOR, "GET", f"{base}/members")}
    assert members[show["sam"]]["noteTaker"] is False


def test_double_cast_part_needs_an_actor(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    chars = _chars(call, show)
    understudy = join(call, mailer, show["id"], "una@example.org", name="Una Lee")
    call.ok(
        DIRECTOR,
        "PATCH",
        f"{base}/characters/{chars['Hermia']}",
        {"castUserIds": [show["maya"], understudy]},
    )
    set_id = _set(call, show)
    status, err = call(
        DIRECTOR,
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"charId": chars["Hermia"], "kind": "late"}]},
    )
    assert status == 400 and "2 people" in err["error"]
    ok = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"charId": chars["Hermia"], "actorId": understudy, "kind": "late"}]},
    )
    assert ok[0]["actorId"] == understudy
    status, err = call(
        DIRECTOR,
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"charId": chars["Hermia"], "actorId": show["jay"], "kind": "late"}]},
    )
    assert status == 400 and "doesn't play Hermia" in err["error"]


def test_line_notes_over_mcp(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    chars = _chars(call, show)
    key = _key(call, show, "write")

    def tool(name: str, **arguments: Any) -> Any:
        status, body = call(
            None,
            "POST",
            "/mcp",
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
            headers=_as(key),
        )
        assert status == 200, body
        return body["result"]

    home = json.loads(tool("list_line_notes", show_id=show["id"])["content"][0]["text"])
    assert {c["userId"] for c in home["cast"]} == {show["maya"], show["jay"], show["george"]}

    # A bad note doesn't leave an empty set behind.
    bad = tool(
        "add_line_notes",
        show_id=show["id"],
        date="2026-11-25",
        title="Run of Act I",
        notes=[{"charId": "nope", "kind": "dropped"}],
    )
    assert bad["isError"] is True
    assert json.loads(tool("list_line_notes", show_id=show["id"])["content"][0]["text"])["sets"] == []

    filed = json.loads(
        tool(
            "add_line_notes",
            show_id=show["id"],
            date="2026-11-25",
            title="Run of Act I",
            notes=[
                {"char_id": chars["Bottom"], "kind": "dropped", "page": "12", "script_text": "The finch"},
                {"charId": chars["Lysander"], "kind": "jumped", "page": "4"},
            ],
        )["content"][0]["text"]
    )
    set_id = filed["setId"]
    assert [n["actorId"] for n in filed["added"]] == [show["george"], show["jay"]]
    detail = json.loads(tool("get_line_notes", show_id=show["id"], set_id=set_id)["content"][0]["text"])
    assert [n["kindLabel"] for n in detail["notes"]] == ["Jumped cue", "Dropped line"]
    released = json.loads(tool("release_line_notes", show_id=show["id"], set_id=set_id)["content"][0]["text"])
    assert released["actorCount"] == 2
