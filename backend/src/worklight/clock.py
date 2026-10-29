"""The current date, in one place so tests and the dev server can pin it."""

from datetime import date


def today() -> date:
    return date.today()
