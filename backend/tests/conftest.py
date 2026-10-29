from collections.abc import Iterator
from datetime import date

import boto3
import pytest
from moto import mock_aws

from tests.client import Client
from tests.fakes import FakeMailer
from worklight import clock
from worklight.localdb import create_table
from worklight.store import DynamoStore


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> Iterator[DynamoStore]:
    """DynamoStore against moto's DynamoDB, with the same table shape the stack creates."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("dynamodb")
        create_table(client)
        yield DynamoStore("worklight", client)


@pytest.fixture
def mailer() -> FakeMailer:
    return FakeMailer()


@pytest.fixture
def call(store: DynamoStore, mailer: FakeMailer) -> Client:
    return Client(store, mailer)


@pytest.fixture(autouse=True)
def _today(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests run on 2026-10-29, the week before the sample show's first rehearsal."""
    monkeypatch.setattr(clock, "today", lambda: date(2026, 10, 29))
