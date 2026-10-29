from typing import Literal, get_args

from call_time.models import ShowRole, TheaterRole

ShowAction = Literal[
    "show:read",
    "show:edit",
    "members:read",
    "members:invite",
    "schedule:edit",
    "conflicts:read-all",
    "conflicts:edit-own",
]
TheaterAction = Literal["theater:edit", "shows:create", "billing:manage"]

_SHOW_PERMISSIONS: dict[ShowRole, frozenset[ShowAction]] = {
    "staff": frozenset(get_args(ShowAction)),
    "cast": frozenset({"show:read", "members:read", "conflicts:edit-own"}),
    "crew": frozenset({"show:read", "members:read", "conflicts:edit-own"}),
}

_THEATER_PERMISSIONS: dict[TheaterRole, frozenset[TheaterAction]] = {
    "admin": frozenset(get_args(TheaterAction)),
}

SHOW_ROLES: tuple[ShowRole, ...] = get_args(ShowRole)


def can_on_show(role: ShowRole | None, action: ShowAction) -> bool:
    return role is not None and action in _SHOW_PERMISSIONS[role]


def can_on_theater(role: TheaterRole | None, action: TheaterAction) -> bool:
    return role is not None and action in _THEATER_PERMISSIONS[role]
