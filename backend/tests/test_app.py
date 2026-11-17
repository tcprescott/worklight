from typing import Any

import pytest

from tests.client import DIRECTOR, Client, invite, join, set_up_show
from tests.fakes import FakeMailer
from worklight.store import DynamoStore


class TestIdentity:
    def test_rejects_requests_without_a_verified_email(self, call: Client) -> None:
        assert call(None, "GET", "/api/me")[0] == 401
        assert call("a@example.org", "GET", "/api/me", verified=False)[0] == 401

    def test_maps_every_sign_in_method_for_one_email_to_the_same_user(self, call: Client) -> None:
        _, first = call("Sam@Example.org", "GET", "/api/me")
        _, second = call("sam@example.org", "GET", "/api/me")
        assert first["user"]["userId"] == second["user"]["userId"]

    def test_saves_a_display_name(self, call: Client) -> None:
        call("sam@example.org", "PATCH", "/api/me", {"name": "Sam Rivera"})
        assert call("sam@example.org", "GET", "/api/me")[1]["user"]["name"] == "Sam Rivera"


class TestTheatersAndShows:
    def test_makes_the_creator_a_theater_admin_and_the_shows_director(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        me = call.ok(DIRECTOR, "GET", "/api/me")
        assert len(me["theaters"]) == 1
        assert me["shows"][0]["role"] == "staff"
        assert me["shows"][0]["title"] == "Director"
        assert me["shows"][0]["theaterName"] == "Riverside Players"
        assert me["shows"][0]["show"]["showId"] == show_id

    def test_only_lets_theater_admins_create_shows(self, call: Client) -> None:
        theater_id, _ = set_up_show(call)
        status, _ = call(
            "stranger@example.org",
            "POST",
            f"/api/theaters/{theater_id}/shows",
            {
                "name": "Hamlet",
                "timezone": "America/Chicago",
                "startDate": "2026-11-02",
                "endDate": "2026-12-01",
            },
        )
        assert status == 403

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            ({"timezone": "Mars/Olympus"}, "timezone must be an IANA timezone like America/Chicago"),
            ({"startDate": "11/02/2026"}, "startDate must be a date like 2026-11-02"),
            ({"endDate": "2026-10-01"}, "endDate must be on or after startDate"),
            ({"name": "  "}, "name is required"),
            ({"techStart": "2027-03-01"}, "techStart must be between the first rehearsal and closing"),
            (
                {"techStart": "2026-11-20", "openingDate": "2026-11-19"},
                "openingDate must be on or after techStart",
            ),
            (
                {"slots": [{"weekday": 0, "start": "21:00", "end": "19:00"}]},
                "slots must each end after they start",
            ),
            ({"slots": [{"weekday": 0, "start": "7pm", "end": "21:00"}]}, "start must be a time like 19:30"),
        ],
    )
    def test_validates_show_input(self, call: Client, change: dict[str, Any], message: str) -> None:
        theater = call.ok("d@example.org", "POST", "/api/theaters", {"name": "T"})
        base = {
            "name": "S",
            "timezone": "America/Chicago",
            "startDate": "2026-11-02",
            "endDate": "2026-12-01",
        }
        status, body = call(
            "d@example.org", "POST", f"/api/theaters/{theater['theaterId']}/shows", base | change
        )
        assert (status, body) == (400, {"error": message})

    def test_saves_rehearsal_settings_and_edits_them(self, call: Client) -> None:
        _, show_id = set_up_show(
            call,
            venue="Fellowship Hall",
            slots=[
                {"weekday": 0, "start": "19:00", "end": "21:30"},
                {"weekday": 5, "start": "10:00", "end": "13:00"},
            ],
            skippedDates=["2026-11-26", "2026-11-26"],
            techStart="2026-11-29",
            openingDate="2026-12-04",
            minutesPerPage=8,
        )
        show = call.ok(DIRECTOR, "GET", f"/api/shows/{show_id}")["show"]
        assert show["venue"] == "Fellowship Hall"
        assert show["skippedDates"] == ["2026-11-26"]
        assert [s["weekday"] for s in show["slots"]] == [0, 5]

        edited = call.ok(
            DIRECTOR, "PATCH", f"/api/shows/{show_id}", {"venue": "", "conflictDeadline": "2026-10-30"}
        )
        assert "venue" not in edited
        assert edited["conflictDeadline"] == "2026-10-30"
        assert edited["techStart"] == "2026-11-29"

    def test_hides_a_show_from_people_who_arent_in_it(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        assert call("stranger@example.org", "GET", f"/api/shows/{show_id}")[0] == 403
        assert call("stranger@example.org", "GET", "/api/shows/nope")[0] == 404

    def test_leaves_out_empty_fields(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        _, body = call(DIRECTOR, "GET", f"/api/shows/{show_id}")
        assert "venue" not in body["show"]


class TestCompany:
    def test_company_home_lists_shows_with_staff_and_counts(self, call: Client, mailer: FakeMailer) -> None:
        theater_id, show_id = set_up_show(call)
        call.ok(DIRECTOR, "PATCH", "/api/me", {"name": "Jordan Reyes"})
        join(call, mailer, show_id, "a@example.org")
        invite(call, mailer, show_id, "b@example.org")
        invite(call, mailer, show_id, "c@example.org", "crew", department="Costumes")
        view = call.ok(DIRECTOR, "GET", f"/api/theaters/{theater_id}")
        assert view["theater"]["name"] == "Riverside Players"
        assert [a["email"] for a in view["admins"]] == [DIRECTOR]
        summary = view["shows"][0]
        assert (summary["castCount"], summary["crewCount"], summary["waitingCount"]) == (2, 1, 3)
        assert summary["staff"][0]["name"] == "Jordan Reyes"
        assert call("a@example.org", "GET", f"/api/theaters/{theater_id}")[0] == 403

    def test_admins_can_add_and_remove_admins_but_not_the_last_one(
        self, call: Client, mailer: FakeMailer
    ) -> None:
        theater_id, show_id = set_up_show(call)
        admins = call.ok(
            DIRECTOR,
            "POST",
            f"/api/theaters/{theater_id}/admins",
            {"email": "Helen@Example.org", "title": "President"},
        )
        assert sorted(a["email"] for a in admins) == [DIRECTOR, "helen@example.org"]
        assert mailer.sent[-1].to == "helen@example.org"
        # A new admin runs every show in the company.
        assert call.ok("helen@example.org", "GET", f"/api/shows/{show_id}")["viaAdmin"] is True

        helen = next(a["userId"] for a in admins if a["email"] == "helen@example.org")
        me = next(a["userId"] for a in admins if a["email"] == DIRECTOR)
        call.ok("helen@example.org", "DELETE", f"/api/theaters/{theater_id}/admins/{me}")
        assert call("helen@example.org", "DELETE", f"/api/theaters/{theater_id}/admins/{helen}") == (
            400,
            {"error": "A company needs at least one admin"},
        )

    def test_archived_shows_are_read_only_until_restored(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        actor = join(call, mailer, show_id, "a@example.org")
        assert call("a@example.org", "POST", f"/api/shows/{show_id}/archive")[0] == 403
        assert call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/archive")["status"] == "archived"

        # Everyone can still read it, nobody can change it.
        assert call.ok("a@example.org", "GET", f"/api/shows/{show_id}")["show"]["status"] == "archived"
        assert call(DIRECTOR, "PATCH", f"/api/shows/{show_id}", {"name": "X"})[0] == 409
        assert call(DIRECTOR, "POST", f"/api/shows/{show_id}/acts", {"name": "Act One"})[0] == 409
        assert call(DIRECTOR, "POST", f"/api/shows/{show_id}/invites", {"email": "z@example.org"})[0] == 409
        assert call(DIRECTOR, "DELETE", f"/api/shows/{show_id}/members/{actor}")[0] == 409

        assert call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/restore")["status"] == "active"
        call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/acts", {"name": "Act One"})


class TestInvites:
    def test_invite_link_signs_in_and_adds_the_invitee(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        _, token = invite(call, mailer, show_id, "Actor@Example.org", name="Maya Chen")
        assert mailer.sent[-1].to == "actor@example.org"
        assert "Hi Maya" in mailer.sent[-1].text

        # The person is in the show from the moment they're invited, so they can be cast.
        members = call.ok(DIRECTOR, "GET", f"/api/shows/{show_id}/members")
        assert {m["email"]: m["status"] for m in members} == {
            DIRECTOR: "joined",
            "actor@example.org": "invited",
        }

        assert call.ok("actor@example.org", "POST", f"/api/invites/{token}/accept") == {
            "showId": show_id,
            "role": "cast",
        }
        assert call.ok("actor@example.org", "GET", f"/api/shows/{show_id}")["role"] == "cast"
        assert call.ok("actor@example.org", "GET", "/api/me")["user"]["name"] == "Maya Chen"

    def test_preview_is_public_and_names_the_part(
        self, call: Client, mailer: FakeMailer, store: DynamoStore
    ) -> None:
        _, show_id = set_up_show(call)
        call.ok(DIRECTOR, "PATCH", "/api/me", {"name": "Jordan Reyes"})
        hermia = call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/characters", {"name": "Hermia"})
        _, token = invite(call, mailer, show_id, "maya@example.org", characterIds=[hermia["charId"]])
        assert call(None, "GET", f"/api/public/invites/{token}") == (
            200,
            {
                "email": "maya@example.org",
                "showName": "Our Town",
                "theaterName": "Riverside Players",
                "inviterName": "Jordan Reyes",
                "role": "cast",
                "part": "Hermia",
            },
        )
        assert call(None, "GET", "/api/public/invites/nope")[0] == 404

    def test_can_only_be_accepted_once_by_the_invited_address(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        _, token = invite(call, mailer, show_id, "actor@example.org")
        assert call("someone-else@example.org", "POST", f"/api/invites/{token}/accept")[0] == 403
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 200
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 404

    def test_reinviting_replaces_the_old_link(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        _, first = invite(call, mailer, show_id, "actor@example.org")
        _, second = invite(call, mailer, show_id, "actor@example.org")
        assert call("actor@example.org", "POST", f"/api/invites/{first}/accept")[0] == 404
        assert call("actor@example.org", "POST", f"/api/invites/{second}/accept")[0] == 200
        assert call(DIRECTOR, "POST", f"/api/shows/{show_id}/invites", {"email": "actor@example.org"}) == (
            409,
            {"error": "actor@example.org is already in this show"},
        )

    def test_rejects_expired_invites(self, call: Client, mailer: FakeMailer, store: DynamoStore) -> None:
        _, show_id = set_up_show(call)
        _, token = invite(call, mailer, show_id, "actor@example.org")
        stale = store.get_invite(token)
        assert stale
        store.put_invite(stale.model_copy(update={"expires_at": 1}))
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 404

    def test_doesnt_let_cast_invite_people_or_see_email_addresses(
        self, call: Client, mailer: FakeMailer
    ) -> None:
        _, show_id = set_up_show(call)
        join(call, mailer, show_id, "actor@example.org")
        assert (
            call("actor@example.org", "POST", f"/api/shows/{show_id}/invites", {"email": "x@example.org"})[0]
            == 403
        )
        assert all(
            "email" not in m for m in call.ok("actor@example.org", "GET", f"/api/shows/{show_id}/members")
        )

    def test_validates_invite_input(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        path = f"/api/shows/{show_id}/invites"
        assert call(DIRECTOR, "POST", path, {"email": "nope"}) == (
            400,
            {"error": "email must be a valid email address"},
        )
        assert call(DIRECTOR, "POST", path, {"email": "a@b.org", "role": "admin"}) == (
            400,
            {"error": "role must be staff, cast or crew"},
        )


class TestPeople:
    def test_staff_edit_and_remove_members_and_casting_follows(
        self, call: Client, mailer: FakeMailer
    ) -> None:
        _, show_id = set_up_show(call)
        hermia = call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/characters", {"name": "Hermia"})
        maya = join(call, mailer, show_id, "maya@example.org", characterIds=[hermia["charId"]])
        assert call.ok(DIRECTOR, "GET", f"/api/shows/{show_id}/breakdown")["characters"][0][
            "castUserIds"
        ] == [maya]

        updated = call.ok(
            DIRECTOR, "PATCH", f"/api/shows/{show_id}/members/{maya}", {"role": "crew", "department": "Sound"}
        )
        assert (updated["role"], updated["department"]) == ("crew", "Sound")

        assert call(DIRECTOR, "DELETE", f"/api/shows/{show_id}/members/{maya}")[0] == 204
        assert call("maya@example.org", "GET", f"/api/shows/{show_id}")[0] == 403
        assert (
            call.ok(DIRECTOR, "GET", f"/api/shows/{show_id}/breakdown")["characters"][0]["castUserIds"] == []
        )

    def test_remind_resends_invites_and_nudges_people_without_conflicts(
        self, call: Client, mailer: FakeMailer
    ) -> None:
        _, show_id = set_up_show(call, conflictDeadline="2026-10-30")
        join(call, mailer, show_id, "joined@example.org")
        invite(call, mailer, show_id, "invited@example.org")
        done = join(call, mailer, show_id, "done@example.org")
        call.ok("done@example.org", "POST", "/api/me/conflicts", {"submitTo": "all"})
        mailer.sent.clear()

        result = call.ok(DIRECTOR, "POST", f"/api/shows/{show_id}/remind", {})
        assert result == {"invitesResent": 1, "conflictReminders": 1}
        by_to = {e.to: e for e in mailer.sent}
        assert "/join/" in by_to["invited@example.org"].text
        assert "Friday, October 30" in by_to["joined@example.org"].subject
        assert "done@example.org" not in by_to
        assert done


class TestRouting:
    def test_returns_404_and_405_for_unknown_routes_and_methods(self, call: Client) -> None:
        assert call("a@example.org", "GET", "/api/nothing") == (404, {"error": "Not found"})
        assert call("a@example.org", "DELETE", "/api/me") == (405, {"error": "Method not allowed"})

    def test_rejects_bodies_that_arent_json_objects(self, call: Client) -> None:
        assert call("a@example.org", "POST", "/api/theaters", raw_body="not json") == (
            400,
            {"error": "Request body must be a JSON object"},
        )
        assert call("a@example.org", "POST", "/api/theaters", raw_body="[1]")[0] == 400

    def test_responses_are_never_cached(self, call: Client) -> None:
        res = call.handler(
            {
                "version": "2.0",
                "rawPath": "/api/me",
                "rawQueryString": "",
                "headers": {},
                "requestContext": {"http": {"method": "GET", "path": "/api/me", "sourceIp": "203.0.113.1"}},
                "isBase64Encoded": False,
            },
            None,
        )
        assert res["statusCode"] == 401
        assert res["headers"]["cache-control"] == "no-store"
