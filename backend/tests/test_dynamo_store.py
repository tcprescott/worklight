"""DynamoStore against moto's DynamoDB, with the same table shape the stack creates."""

import pytest

from worklight.models import (
    Act,
    Appearance,
    Character,
    DateConflict,
    Invite,
    MagicLinkRecord,
    Membership,
    RehearsalSlot,
    Scene,
    Show,
    Theater,
    User,
    WeeklyConflict,
)
from worklight.store import DynamoStore


@pytest.fixture
def dynamo(store: DynamoStore) -> DynamoStore:
    return store


NOW = "2026-10-29T12:00:00.000Z"


def test_users_are_unique_by_email(dynamo: DynamoStore) -> None:
    assert dynamo.create_user(User(user_id="u1", email="Sam@Example.org", created_at=NOW)) == "u1"
    assert dynamo.create_user(User(user_id="u2", email="sam@example.org", created_at=NOW)) == "u1"
    assert dynamo.get_user_id_by_email("SAM@example.org") == "u1"
    dynamo.update_user_name("u1", "Sam")
    assert [u.name for u in dynamo.get_users(["u1", "u1", "missing"])] == ["Sam"]


def test_theaters_shows_and_memberships_round_trip(dynamo: DynamoStore) -> None:
    dynamo.create_theater(Theater(theater_id="t1", name="Riverside", plan="free", created_at=NOW), "u1")
    assert dynamo.list_admin_theater_ids("u1") == ["t1"]
    assert dynamo.is_theater_admin("t1", "u1")
    assert not dynamo.is_theater_admin("t1", "u2")

    show = Show(
        show_id="s1",
        theater_id="t1",
        name="Our Town",
        timezone="America/Chicago",
        start_date="2026-11-02",
        end_date="2027-01-17",
        created_at=NOW,
    )
    director = Membership(
        show_id="s1", theater_id="t1", user_id="u1", role="staff", title="Director", joined_at=NOW
    )
    dynamo.create_show(show, director)
    assert dynamo.get_show("s1") == show
    assert dynamo.get_show("nope") is None
    assert dynamo.get_shows([("t1", "s1")]) == [show]
    assert dynamo.list_memberships("u1") == [director]
    assert dynamo.list_members("s1") == [director]


def test_invites_round_trip(dynamo: DynamoStore) -> None:
    invite = Invite(
        token="tok",
        show_id="s1",
        theater_id="t1",
        user_id="u2",
        email="a@example.org",
        invited_by="u1",
        created_at=NOW,
        expires_at=2_000_000_000,
    )
    dynamo.put_invite(invite)
    assert dynamo.get_invite("tok") == invite
    dynamo.delete_invite("tok")
    assert dynamo.get_invite("tok") is None


def test_show_partition_loads_breakdown_in_order(dynamo: DynamoStore) -> None:
    dynamo.put_act(Act(act_id="a2", show_id="s1", name="Act Two", order=2))
    dynamo.put_act(Act(act_id="a1", show_id="s1", name="Act One", order=1))
    dynamo.put_scene(
        Scene(scene_id="x", show_id="s1", act_id="a1", number="1.1", name="Palace", order=1, eighths=35)
    )
    dynamo.put_character(Character(char_id="c1", show_id="s1", name="Hermia", order=1, cast_user_ids=["u2"]))
    dynamo.put_appearance(Appearance(show_id="s1", scene_id="x", char_id="c1"))
    part = dynamo.load_show("s1")
    assert [a.name for a in part.acts] == ["Act One", "Act Two"]
    assert part.scenes[0].eighths == 35
    assert part.characters[0].cast_user_ids == ["u2"]
    assert part.appearances == [Appearance(show_id="s1", scene_id="x", char_id="c1")]
    dynamo.delete_scene("s1", "x", part.appearances)
    assert dynamo.load_show("s1").appearances == []


def test_conflicts_are_stored_per_person(dynamo: DynamoStore) -> None:
    dynamo.put_weekly_conflict(
        WeeklyConflict(user_id="u1", weekday=2, level="partial", arrive="19:45", updated_at=NOW)
    )
    dynamo.put_date_conflict(DateConflict(user_id="u1", date="2026-11-06", level="hard", updated_at=NOW))
    weekly, dates = dynamo.get_conflicts("u1")
    assert weekly[0].arrive == "19:45"
    assert dates[0].level == "hard"
    assert dynamo.get_conflicts("u2") == ([], [])
    dynamo.delete_date_conflict("u1", "2026-11-06")
    assert dynamo.get_conflicts("u1")[1] == []


def test_show_settings_round_trip_with_numbers(dynamo: DynamoStore) -> None:
    show = Show(
        show_id="s9",
        theater_id="t1",
        name="S",
        timezone="UTC",
        start_date="2026-11-02",
        end_date="2026-12-01",
        minutes_per_page=7.5,
        slots=[RehearsalSlot(weekday=0, start="19:00", end="21:30")],
        created_at=NOW,
    )
    dynamo.create_show(show, Membership(show_id="s9", theater_id="t1", user_id="u1", role="staff"))
    assert dynamo.get_show("s9") == show


def test_magic_link_codes_are_consumed_once(dynamo: DynamoStore) -> None:
    dynamo.put_magic_link(
        MagicLinkRecord(email="Pat@Example.org", code_hash="h1", created_at=1, expires_at=2)
    )
    assert dynamo.get_magic_link("pat@example.org") == MagicLinkRecord(
        email="pat@example.org", code_hash="h1", created_at=1, expires_at=2
    )
    assert not dynamo.consume_magic_link("pat@example.org", "other")
    assert dynamo.consume_magic_link("pat@example.org", "h1")
    assert not dynamo.consume_magic_link("pat@example.org", "h1")
