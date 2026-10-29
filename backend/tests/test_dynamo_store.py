"""DynamoStore against moto's DynamoDB, with the same table shape the stack creates."""

from collections.abc import Iterator

import boto3
import pytest
from call_time.models import Invite, MagicLinkRecord, Membership, Show, Theater, User
from call_time.store import DynamoStore
from moto import mock_aws


@pytest.fixture
def dynamo(monkeypatch: pytest.MonkeyPatch) -> Iterator[DynamoStore]:
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("dynamodb")
        string = "S"
        client.create_table(
            TableName="calltime",
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": n, "AttributeType": string} for n in ("PK", "SK", "GSI1PK", "GSI1SK")
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "GSI1",
                    "KeySchema": [
                        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                        {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
        yield DynamoStore("calltime", client)


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


def test_invites_are_accepted_once(dynamo: DynamoStore) -> None:
    invite = Invite(
        token="tok",
        show_id="s1",
        theater_id="t1",
        email="a@example.org",
        role="cast",
        invited_by="u1",
        created_at=NOW,
        expires_at=2_000_000_000,
    )
    dynamo.put_invite(invite)
    assert dynamo.get_invite("tok") == invite
    cast = Membership(show_id="s1", theater_id="t1", user_id="u2", role="cast", joined_at=NOW)
    dynamo.accept_invite(invite, cast)
    assert dynamo.get_invite("tok") is None
    assert dynamo.get_membership("s1", "u2") == cast
    with pytest.raises(dynamo.db.exceptions.TransactionCanceledException):
        dynamo.accept_invite(invite, cast)


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
