import pytest

from tests.fakes import FakeMailer, MemoryStore


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def mailer() -> FakeMailer:
    return FakeMailer()
