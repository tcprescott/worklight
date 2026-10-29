"""The current date and time, in one place so tests and the dev server can pin them."""

from datetime import UTC, date, datetime


def today() -> date:
    return date.today()


def now() -> datetime:
    return datetime.now(UTC)
