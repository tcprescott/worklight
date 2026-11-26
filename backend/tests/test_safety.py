from datetime import UTC, datetime

import pytest

from tests.client import DIRECTOR, Client, join, set_up_show
from tests.fakes import FakeMailer
from worklight import clock

MAYA = "maya@example.org"
JESS = "jess@example.org"  # stage manager
DEV = "dev@example.org"  # assistant stage manager
ROSA = "rosa@example.org"

MAYA_INFO = {
    "minor": True,
    "contacts": [
        {"name": "Ada Okafor", "relationship": "Mother", "phone": "555-0142", "guardian": True},
    ],
    "pickups": [{"name": "Grace Lin", "note": "Neighbor"}],
    "medical": {"allergies": "Peanuts (EpiPen in backpack)", "conditions": " "},
}


def _company(call: Client, mailer: FakeMailer) -> dict[str, str]:
    _, show_id = set_up_show(call)
    return {
        "show": show_id,
        "base": f"/api/shows/{show_id}",
        "maya": join(call, mailer, show_id, MAYA, name="Maya Okafor"),
        "jess": join(call, mailer, show_id, JESS, role="staff", title="Stage manager"),
        "dev": join(call, mailer, show_id, DEV, role="staff", title="ASM"),
        "rosa": join(call, mailer, show_id, ROSA),
    }


def test_people_keep_their_own_info_and_blank_medical_is_dropped(call: Client) -> None:
    assert call.ok(MAYA, "GET", "/api/me/safety")["contacts"] == []
    saved = call.ok(MAYA, "PUT", "/api/me/safety", MAYA_INFO)
    assert saved["medical"] == {"allergies": "Peanuts (EpiPen in backpack)"}
    assert saved["pickups"][0]["name"] == "Grace Lin"

    # Pickups only mean something for a minor.
    adult = call.ok(MAYA, "PUT", "/api/me/safety", {**MAYA_INFO, "minor": False, "medical": {"other": ""}})
    assert adult["pickups"] == [] and "medical" not in adult

    call.ok(MAYA, "DELETE", "/api/me/safety")
    assert call.ok(MAYA, "GET", "/api/me/safety")["contacts"] == []


def test_all_staff_see_contacts_but_only_medical_access_opens_notes(call: Client, mailer: FakeMailer) -> None:
    c = _company(call, mailer)
    call.ok(MAYA, "PUT", "/api/me/safety", MAYA_INFO)

    page = call.ok(DEV, "GET", f"{c['base']}/safety")
    maya = next(m for m in page["members"] if m["userId"] == c["maya"])
    assert maya["minor"] and maya["hasMedical"] and maya["contacts"][0]["phone"] == "555-0142"
    assert "medical" not in maya
    assert page["medicalAccess"] is False
    # Rosa has nothing on file, so she shows as missing info.
    assert next(m for m in page["members"] if m["userId"] == c["rosa"])["contacts"] == []

    assert call(DEV, "GET", f"{c['base']}/safety/{c['maya']}/medical")[0] == 403
    assert call(MAYA, "GET", f"{c['base']}/safety")[0] == 403
    assert call("stranger@example.org", "GET", f"{c['base']}/safety")[0] == 403

    # The director created the show, so has medical access.
    notes = call.ok(DIRECTOR, "GET", f"{c['base']}/safety/{c['maya']}/medical")
    assert notes["medical"]["allergies"].startswith("Peanuts")


def test_medical_access_is_granted_by_someone_who_has_it(call: Client, mailer: FakeMailer) -> None:
    c = _company(call, mailer)
    member = f"{c['base']}/members"
    # Dev doesn't have it, so can't hand it out, even to himself.
    assert call(DEV, "PATCH", f"{member}/{c['dev']}", {"medicalAccess": True})[0] == 403
    assert call(DIRECTOR, "PATCH", f"{member}/{c['maya']}", {"medicalAccess": True})[0] == 400

    granted = call.ok(DIRECTOR, "PATCH", f"{member}/{c['jess']}", {"medicalAccess": True})
    assert granted["medicalAccess"] is True
    # Jess can now grant it, and editing a title leaves it alone.
    call.ok(JESS, "PATCH", f"{member}/{c['dev']}", {"medicalAccess": True})
    call.ok(DIRECTOR, "PATCH", f"{member}/{c['dev']}", {"title": "Assistant SM"})
    assert call.ok(DEV, "GET", f"{c['base']}/safety")["medicalAccess"] is True

    # Moving someone off staff takes it away.
    call.ok(DIRECTOR, "PATCH", f"{member}/{c['dev']}", {"role": "crew"})
    call.ok(DIRECTOR, "PATCH", f"{member}/{c['dev']}", {"role": "staff"})
    members = call.ok(DIRECTOR, "GET", member)
    assert next(m for m in members if m["userId"] == c["dev"])["medicalAccess"] is False
    # Cast don't see who has it.
    assert all("medicalAccess" not in m for m in call.ok(MAYA, "GET", member))


def test_every_look_is_logged_for_the_person(call: Client, mailer: FakeMailer) -> None:
    c = _company(call, mailer)
    call.ok(MAYA, "PUT", "/api/me/safety", MAYA_INFO)
    call.ok(DEV, "GET", f"{c['base']}/safety")
    call.ok(DEV, "GET", f"{c['base']}/safety")
    call.ok(DIRECTOR, "GET", f"{c['base']}/safety/{c['maya']}/medical")

    views = call.ok(MAYA, "GET", "/api/me/safety/views")
    assert sorted((v["viewerTitle"], v["view"], v["showName"]) for v in views) == [
        ("ASM", "contacts", "Our Town"),
        ("Director", "medical", "Our Town"),
    ]
    # Rosa has nothing on file, so nothing was shown and nothing is logged.
    assert call.ok(ROSA, "GET", "/api/me/safety/views") == []
    # Staff looking at their own row aren't logged.
    call.ok(JESS, "PUT", "/api/me/safety", {"contacts": [{"name": "Kim", "phone": "555-0101"}]})
    call.ok(JESS, "GET", f"{c['base']}/safety")
    assert call.ok(JESS, "GET", "/api/me/safety/views") == []


def test_access_ends_when_the_show_closes_and_skips_people_who_havent_joined(
    call: Client, mailer: FakeMailer
) -> None:
    c = _company(call, mailer)
    call.ok(DIRECTOR, "POST", f"{c['base']}/invites", {"email": "new@example.org", "role": "cast"})
    call.ok("new@example.org", "PUT", "/api/me/safety", MAYA_INFO)
    ids = {m["userId"] for m in call.ok(DIRECTOR, "GET", f"{c['base']}/safety")["members"]}
    assert c["maya"] in ids and len(ids) == 5

    call.ok(DIRECTOR, "POST", f"{c['base']}/archive")
    assert call(DIRECTOR, "GET", f"{c['base']}/safety")[0] == 409
    assert call(DIRECTOR, "GET", f"{c['base']}/safety/{c['maya']}/medical")[0] == 409


def test_api_keys_never_reach_safety_info(call: Client, mailer: FakeMailer) -> None:
    c = _company(call, mailer)
    status, _ = call(None, "GET", f"/api/v1/shows/{c['show']}/safety")
    assert status in (401, 403, 404)


def test_lists_minors_called_tonight_for_pickup(
    call: Client, mailer: FakeMailer, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = _company(call, mailer)
    call.ok(MAYA, "PUT", "/api/me/safety", MAYA_INFO)
    call.ok(
        DIRECTOR,
        "POST",
        f"{c['base']}/calls",
        {"date": "2026-11-09", "start": "19:00", "end": "21:30", "groups": ["everyone"]},
    )
    call.ok(DIRECTOR, "POST", f"{c['base']}/schedule/publish", {"from": "2026-11-09", "to": "2026-11-09"})
    # 6 PM in Chicago on Monday Nov 9.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 10, 0, 0, tzinfo=UTC))
    page = call.ok(JESS, "GET", f"{c['base']}/safety")
    assert page["tonightDate"] == "2026-11-09"
    assert page["tonight"] == [{"userId": c["maya"], "ends": "21:30"}]
