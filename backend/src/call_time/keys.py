"""Single-table key layout. See the spec's data model section.

THEATER#<id>   META              theater
THEATER#<id>   SHOW#<showId>     show
THEATER#<id>   ADMIN#<userId>    theater admin       (GSI1: USER#<userId> / THEATER#<id>)
SHOW#<showId>  META              pointer to the show's theater
SHOW#<showId>  MEMBER#<userId>   show membership     (GSI1: USER#<userId> / SHOW#<showId>)
USER#<id>      PROFILE           user
EMAIL#<email>  USER              email -> userId lookup
INVITE#<token> META              pending invite (TTL)
MAGIC#<email>  META              pending magic-link code hash (TTL)
"""

import re

Key = dict[str, str]

SHOW_PREFIX = "SHOW#"
THEATER_PREFIX = "THEATER#"
MEMBER_PREFIX = "MEMBER#"
ADMIN_PREFIX = "ADMIN#"


def normalize_email(email: str) -> str:
    return email.strip().lower()


_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_email(value: object) -> bool:
    return isinstance(value, str) and len(value) <= 254 and bool(_EMAIL_PATTERN.match(value.strip()))


def user_gsi(user_id: str) -> str:
    return f"USER#{user_id}"


def theater(theater_id: str) -> Key:
    return {"PK": f"THEATER#{theater_id}", "SK": "META"}


def theater_admin(theater_id: str, user_id: str) -> Key:
    return {
        "PK": f"THEATER#{theater_id}",
        "SK": f"ADMIN#{user_id}",
        "GSI1PK": user_gsi(user_id),
        "GSI1SK": f"THEATER#{theater_id}",
    }


def show(theater_id: str, show_id: str) -> Key:
    return {"PK": f"THEATER#{theater_id}", "SK": f"SHOW#{show_id}"}


def show_pointer(show_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": "META"}


def member(show_id: str, user_id: str) -> Key:
    return {
        "PK": f"SHOW#{show_id}",
        "SK": f"MEMBER#{user_id}",
        "GSI1PK": user_gsi(user_id),
        "GSI1SK": f"SHOW#{show_id}",
    }


def user(user_id: str) -> Key:
    return {"PK": f"USER#{user_id}", "SK": "PROFILE"}


def email(address: str) -> Key:
    return {"PK": f"EMAIL#{normalize_email(address)}", "SK": "USER"}


def invite(token: str) -> Key:
    return {"PK": f"INVITE#{token}", "SK": "META"}


def magic_link(address: str) -> Key:
    return {"PK": f"MAGIC#{normalize_email(address)}", "SK": "META"}


def primary(key: Key) -> Key:
    """Just PK and SK, for Get/Delete calls."""
    return {"PK": key["PK"], "SK": key["SK"]}
