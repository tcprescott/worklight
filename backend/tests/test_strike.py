from typing import Any

from tests.client import DIRECTOR, Client, join
from tests.fakes import FakeMailer
from tests.test_public_api import _as, _key
from tests.test_schedule import _show

TEMPLATE = [
    {"area": "Set", "text": "Drop the flats"},
    {"area": "Set", "text": "Pull screws, bin hardware"},
    {"area": "Props", "text": "Return borrowed props"},
    {"area": "Space", "text": "Final walkthrough with the venue"},
]


def _theater(call: Client, show: dict[str, Any]) -> str:
    return str(call.ok(DIRECTOR, "GET", f"/api/shows/{show['id']}")["show"]["theaterId"])


def _strike(call: Client, show: dict[str, Any]) -> dict[str, Any]:
    """Company template, then a strike call the day after closing, which copies it into the show."""
    theater = _theater(call, show)
    saved = call.ok(DIRECTOR, "PUT", f"/api/theaters/{theater}/strike-template", {"tasks": TEMPLATE})
    assert [t["text"] for t in saved["tasks"]] == [t["text"] for t in TEMPLATE]
    made = call.ok(
        DIRECTOR,
        "POST",
        f"{show['base']}/calls",
        {"date": "2026-12-07", "start": "10:00", "end": "14:00", "type": "strike"},
    )
    assert made["groups"] == ["everyone"]
    return made


def test_strike_call_copies_the_company_template(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    made = _strike(call, show)
    checklist = call.ok(DIRECTOR, "GET", f"{show['base']}/strike")
    assert checklist["areas"] == ["Set", "Props", "Space"]
    assert [t["text"] for t in checklist["tasks"]] == [t["text"] for t in TEMPLATE]
    assert checklist["unassignedCount"] == 4 and checklist["doneCount"] == 0
    assert checklist["calls"][0]["callId"] == made["callId"] and checklist["canEdit"] is True

    # Changing the template later doesn't touch the show's copy, and a second strike call doesn't re-copy.
    theater = _theater(call, show)
    call.ok(DIRECTOR, "PUT", f"/api/theaters/{theater}/strike-template", {"tasks": TEMPLATE[:1]})
    call.ok(
        DIRECTOR,
        "POST",
        f"{show['base']}/calls",
        {"date": "2026-12-08", "start": "10:00", "end": "12:00", "type": "strike"},
    )
    assert len(call.ok(DIRECTOR, "GET", f"{show['base']}/strike")["tasks"]) == 4
    assert call.ok(DIRECTOR, "GET", f"/api/theaters/{theater}/strike-template")["tasks"] == TEMPLATE[:1]

    # Only company admins edit the template; strike can't be weeks after closing.
    assert call("sam@example.org", "GET", f"/api/theaters/{theater}/strike-template")[0] == 403
    status, err = call(
        DIRECTOR,
        "POST",
        f"{show['base']}/calls",
        {"date": "2027-01-30", "start": "10:00", "end": "12:00", "type": "strike"},
    )
    assert status == 400 and "after closing" in err["error"]
    # Other calls still have to be by closing night.
    assert (
        call(
            DIRECTOR,
            "POST",
            f"{show['base']}/calls",
            {"date": "2026-12-07", "start": "10:00", "end": "12:00"},
        )[0]
        == 400
    )


def test_tasks_are_assigned_to_crew_and_ticked_off_by_them(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    _strike(call, show)
    riley = join(call, mailer, show["id"], "riley@example.org", role="crew", name="Riley Park")
    tasks = call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"]
    flats, screws, props = tasks[0]["taskId"], tasks[1]["taskId"], tasks[2]["taskId"]

    # Cast can't be given strike tasks; crew can, several to a task.
    status, err = call(DIRECTOR, "PATCH", f"{base}/strike/tasks/{flats}", {"assigneeIds": [show["maya"]]})
    assert status == 400 and "crew and staff" in err["error"]
    call.ok(DIRECTOR, "PATCH", f"{base}/strike/tasks/{flats}", {"assigneeIds": [show["sam"], riley]})
    call.ok(DIRECTOR, "PATCH", f"{base}/strike/tasks/{props}", {"assigneeIds": [riley]})

    # A new task goes at the end of its area.
    added = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/strike/tasks",
        {"area": "Set", "text": "Stack lumber", "assigneeIds": [riley]},
    )
    listed = call.ok(DIRECTOR, "GET", f"{base}/strike")
    assert [t["text"] for t in listed["tasks"]][:3] == [
        "Drop the flats",
        "Pull screws, bin hardware",
        "Stack lumber",
    ]
    assert listed["tasks"][0]["assignees"] == [
        {"userId": show["sam"]},
        {"userId": riley, "name": "Riley Park"},
    ]

    # Sam sees only Sam's tasks, with who they share it with.
    mine = call.ok("sam@example.org", "GET", f"{base}/strike")
    assert [t["taskId"] for t in mine["tasks"]] == [flats]
    assert mine["canEdit"] is False and mine["tasks"][0]["canCheck"] is True
    # Strike isn't published yet, so Sam doesn't see the call.
    assert mine["calls"] == []

    # Sam ticks it off, but can't edit it, or tick off someone else's task.
    done = call.ok("sam@example.org", "PATCH", f"{base}/strike/tasks/{flats}", {"done": True})
    assert done["doneBy"] == show["sam"] and done["doneAt"]
    assert call("sam@example.org", "PATCH", f"{base}/strike/tasks/{flats}", {"text": "x"})[0] == 403
    assert call("sam@example.org", "PATCH", f"{base}/strike/tasks/{screws}", {"done": True})[0] == 403
    assert call("sam@example.org", "DELETE", f"{base}/strike/tasks/{added['taskId']}")[0] == 403
    assert call.ok("maya@example.org", "GET", f"{base}/strike")["tasks"] == []
    call.ok("riley@example.org", "PATCH", f"{base}/strike/tasks/{props}", {"done": True})

    staff = call.ok(DIRECTOR, "GET", f"{base}/strike")
    assert staff["doneCount"] == 2 and staff["unassignedCount"] == 2
    assert next(t for t in staff["tasks"] if t["taskId"] == props)["doneByName"] == "Riley Park"

    # Un-ticking clears it; staff can delete.
    call.ok("sam@example.org", "PATCH", f"{base}/strike/tasks/{flats}", {"done": False})
    call.ok(DIRECTOR, "DELETE", f"{base}/strike/tasks/{added['taskId']}")
    after = call.ok(DIRECTOR, "GET", f"{base}/strike")
    assert after["doneCount"] == 1 and len(after["tasks"]) == 4


def test_empty_checklist_can_copy_the_template(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    status, err = call(DIRECTOR, "POST", f"{base}/strike/copy-template")
    assert status == 400 and "empty" in err["error"]
    assert call.ok(DIRECTOR, "GET", f"{base}/strike")["templateAvailable"] is False
    theater = _theater(call, show)
    call.ok(DIRECTOR, "PUT", f"/api/theaters/{theater}/strike-template", {"tasks": TEMPLATE})
    assert call.ok(DIRECTOR, "GET", f"{base}/strike")["templateAvailable"] is True
    copied = call.ok(DIRECTOR, "POST", f"{base}/strike/copy-template")
    assert len(copied["tasks"]) == 4


def test_strike_over_mcp(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    _strike(call, show)
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
        assert not body["result"].get("isError"), body
        return body["result"]["content"][0]["text"]

    import json

    checklist = json.loads(tool("get_strike_checklist", show_id=show["id"]))
    task = checklist["tasks"][0]["taskId"]
    tool("update_strike_task", show_id=show["id"], task_id=task, assignee_ids=[show["sam"]], done=True)
    after = json.loads(tool("get_strike_checklist", show_id=show["id"]))
    assert after["doneCount"] == 1 and after["tasks"][0]["assigneeIds"] == [show["sam"]]
