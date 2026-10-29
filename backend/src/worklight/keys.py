"""Single-table key layout. See the spec's data model section.

THEATER#<id>   META              theater
THEATER#<id>   SHOW#<showId>     show
THEATER#<id>   ADMIN#<userId>    theater admin       (GSI1: USER#<userId> / THEATER#<id>)
SHOW#<showId>  META              pointer to the show's theater
SHOW#<showId>  MEMBER#<userId>   show membership     (GSI1: USER#<userId> / SHOW#<showId>)
SHOW#<showId>  ACT#<actId>       act
SHOW#<showId>  SCENE#<sceneId>   scene (ordered by its order field)
SHOW#<showId>  CHAR#<charId>     character and who plays it
SHOW#<showId>  APPEAR#<sceneId>#<charId>   one tick in the scenes x characters grid
SHOW#<showId>  CALL#<date>#<callId>       a rehearsal call (working copy + published copy)
SHOW#<showId>  CHECKIN#<date>#<userId>    tech week and performance attendance
SHOW#<showId>  NOTICE#<noticeId>          callboard notice
SHOW#<showId>  READ#<noticeId>#<userId>   who has read a notice
USER#<id>      PROFILE           user
USER#<id>      CONFLICT#WEEKLY#<weekday>   usual-week conflict rule
USER#<id>      CONFLICT#DATE#<date>        answer for one date
EMAIL#<email>  USER              email -> userId lookup
INVITE#<token> META              pending invite (TTL)
MAGIC#<email>  META              pending magic-link code hash (TTL)
FEED#<token>   META              calendar feed token -> userId
"""

import re

Key = dict[str, str]

SHOW_PREFIX = "SHOW#"
THEATER_PREFIX = "THEATER#"
MEMBER_PREFIX = "MEMBER#"
ADMIN_PREFIX = "ADMIN#"
ACT_PREFIX = "ACT#"
SCENE_PREFIX = "SCENE#"
CHAR_PREFIX = "CHAR#"
APPEAR_PREFIX = "APPEAR#"
CONFLICT_PREFIX = "CONFLICT#"
CALL_PREFIX = "CALL#"
CHECKIN_PREFIX = "CHECKIN#"
NOTICE_PREFIX = "NOTICE#"
READ_PREFIX = "READ#"


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


def act(show_id: str, act_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"ACT#{act_id}"}


def scene(show_id: str, scene_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"SCENE#{scene_id}"}


def character(show_id: str, char_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"CHAR#{char_id}"}


def appearance(show_id: str, scene_id: str, char_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"APPEAR#{scene_id}#{char_id}"}


def call(show_id: str, date: str, call_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"CALL#{date}#{call_id}"}


def notice(show_id: str, notice_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"NOTICE#{notice_id}"}


def notice_read(show_id: str, notice_id: str, user_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"READ#{notice_id}#{user_id}"}


def feed(token: str) -> Key:
    return {"PK": f"FEED#{token}", "SK": "META"}


def checkin(show_id: str, date: str, user_id: str) -> Key:
    return {"PK": f"SHOW#{show_id}", "SK": f"CHECKIN#{date}#{user_id}"}


def weekly_conflict(user_id: str, weekday: int) -> Key:
    return {"PK": f"USER#{user_id}", "SK": f"CONFLICT#WEEKLY#{weekday}"}


def date_conflict(user_id: str, date: str) -> Key:
    return {"PK": f"USER#{user_id}", "SK": f"CONFLICT#DATE#{date}"}


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
