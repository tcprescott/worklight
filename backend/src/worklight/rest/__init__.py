"""REST routes: thin adapters over worklight.services."""

from collections.abc import Callable

from worklight.models import User

UserDep = Callable[..., User]
