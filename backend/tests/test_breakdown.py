from tests.client import DIRECTOR, Client, join, set_up_show
from tests.fakes import FakeMailer
from worklight.models import Scene, Show
from worklight.services.breakdown import scene_minutes


def test_builds_acts_scenes_and_the_character_grid(call: Client, mailer: FakeMailer) -> None:
    _, show_id = set_up_show(call)
    base = f"/api/shows/{show_id}"
    one = call.ok(DIRECTOR, "POST", f"{base}/acts", {"name": "Act One"})
    two = call.ok(DIRECTOR, "POST", f"{base}/acts", {"name": "Act Two"})
    wood = call.ok(
        DIRECTOR, "POST", f"{base}/scenes", {"actId": two["actId"], "name": "The wood", "eighths": 72}
    )
    palace = call.ok(
        DIRECTOR, "POST", f"{base}/scenes", {"actId": one["actId"], "name": "Palace", "eighths": 56}
    )
    house = call.ok(DIRECTOR, "POST", f"{base}/scenes", {"actId": one["actId"], "name": "Quince's house"})
    # Numbers come from the act and position; a scene added to an earlier act slots in before later acts.
    assert [palace["number"], house["number"], wood["number"]] == ["1.1", "1.2", "2.1"]

    maya = join(call, mailer, show_id, "maya@example.org")
    hermia = call.ok(DIRECTOR, "POST", f"{base}/characters", {"name": "Hermia", "castUserIds": [maya]})
    fairies = call.ok(DIRECTOR, "POST", f"{base}/characters", {"name": "Fairies", "ensemble": True})
    assert call(DIRECTOR, "PUT", f"{base}/scenes/{palace['sceneId']}/characters/{hermia['charId']}")[0] == 204
    call.ok(DIRECTOR, "PUT", f"{base}/scenes/{wood['sceneId']}/characters/{fairies['charId']}")
    call.ok(DIRECTOR, "PUT", f"{base}/scenes/{wood['sceneId']}/characters/{hermia['charId']}")
    call.ok(DIRECTOR, "DELETE", f"{base}/scenes/{wood['sceneId']}/characters/{hermia['charId']}")

    bd = call.ok("maya@example.org", "GET", f"{base}/breakdown")
    assert [s["name"] for s in bd["scenes"]] == ["Palace", "Quince's house", "The wood"]
    assert sorted((a["sceneId"], a["charId"]) for a in bd["appearances"]) == sorted(
        [(palace["sceneId"], hermia["charId"]), (wood["sceneId"], fairies["charId"])]
    )

    # Cast can look but not touch.
    assert call("maya@example.org", "POST", f"{base}/acts", {"name": "Act Three"})[0] == 403

    # Deleting a character clears its grid ticks.
    call.ok(DIRECTOR, "DELETE", f"{base}/characters/{fairies['charId']}")
    assert len(call.ok(DIRECTOR, "GET", f"{base}/breakdown")["appearances"]) == 1

    # Deleting an act deletes its scenes.
    call.ok(DIRECTOR, "DELETE", f"{base}/acts/{one['actId']}")
    bd = call.ok(DIRECTOR, "GET", f"{base}/breakdown")
    assert [s["name"] for s in bd["scenes"]] == ["The wood"]
    assert bd["appearances"] == []


def test_edits_and_reorders(call: Client) -> None:
    _, show_id = set_up_show(call)
    base = f"/api/shows/{show_id}"
    act = call.ok(DIRECTOR, "POST", f"{base}/acts", {"name": "Act One"})
    a = call.ok(DIRECTOR, "POST", f"{base}/scenes", {"actId": act["actId"], "name": "A"})
    b = call.ok(DIRECTOR, "POST", f"{base}/scenes", {"actId": act["actId"], "name": "B"})
    edited = call.ok(
        DIRECTOR, "PATCH", f"{base}/scenes/{a['sceneId']}", {"name": "Fight", "minutesOverride": 45}
    )
    assert (edited["name"], edited["minutesOverride"]) == ("Fight", 45)
    cleared = call.ok(DIRECTOR, "PATCH", f"{base}/scenes/{a['sceneId']}", {"minutesOverride": None})
    assert "minutesOverride" not in cleared

    bd = call.ok(DIRECTOR, "POST", f"{base}/reorder/scenes", {"ids": [b["sceneId"], a["sceneId"]]})
    assert [s["name"] for s in bd["scenes"]] == ["B", "Fight"]
    assert call(DIRECTOR, "POST", f"{base}/reorder/scenes", {"ids": [b["sceneId"]]})[0] == 400
    assert call(DIRECTOR, "POST", f"{base}/characters", {"name": "X", "castUserIds": ["stranger"]}) == (
        400,
        {"error": "castUserIds can only name people in this show"},
    )


def test_scene_minutes_follow_the_pace_with_a_floor_and_override() -> None:
    show = Show(
        show_id="s",
        theater_id="t",
        name="S",
        timezone="UTC",
        start_date="2026-11-02",
        end_date="2026-12-01",
        minutes_per_page=8,
        created_at="now",
    )
    scene = Scene(scene_id="x", show_id="s", act_id="a", number="1.1", name="N", order=1, eighths=8 * 7)
    assert scene_minutes(scene, show) == 55  # 56 rounded to 5
    assert scene_minutes(scene.model_copy(update={"eighths": 4}), show) == 20
    assert scene_minutes(scene.model_copy(update={"minutes_override": 90}), show) == 90
