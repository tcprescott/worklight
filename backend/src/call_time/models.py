"""Domain records and API shapes. Fields are camelCase on the wire and in DynamoDB."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Plan = Literal["free", "paid"]
ShowRole = Literal["staff", "cast", "crew"]
TheaterRole = Literal["admin"]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def to_item(self) -> dict[str, object]:
        """The record as stored in DynamoDB (and sent to the browser): camelCase, no empty fields."""
        return self.model_dump(by_alias=True, exclude_none=True)


class Theater(Model):
    theater_id: str
    name: str
    plan: Plan
    created_at: str


class Show(Model):
    show_id: str
    theater_id: str
    name: str
    venue: str | None = None
    # IANA timezone, e.g. "America/Chicago". Every call time is shown in this zone.
    timezone: str
    # First rehearsal and closing performance, YYYY-MM-DD.
    start_date: str
    end_date: str
    created_at: str


class Membership(Model):
    show_id: str
    theater_id: str
    user_id: str
    role: ShowRole
    # Free text such as "Director", "Stage manager", "Lights".
    title: str | None = None
    joined_at: str


class User(Model):
    user_id: str
    email: str
    name: str | None = None
    created_at: str


class Invite(Model):
    token: str
    show_id: str
    theater_id: str
    email: str
    role: ShowRole
    title: str | None = None
    invited_by: str
    created_at: str
    # Epoch seconds; DynamoDB TTL removes the item after this.
    expires_at: int


class MagicLinkRecord(Model):
    email: str
    code_hash: str
    created_at: int
    expires_at: int


class MyShow(Model):
    show: Show
    role: ShowRole
    title: str | None = None


class MyTheater(Model):
    theater: Theater
    role: TheaterRole


class Me(Model):
    """What the signed-in user sees on their home page."""

    user: User
    theaters: list[MyTheater]
    shows: list[MyShow]


class ShowView(Model):
    show: Show
    role: ShowRole
    title: str | None = None


class Member(Model):
    user_id: str
    name: str | None = None
    # Only staff see email addresses.
    email: str | None = None
    role: ShowRole
    title: str | None = None


class InviteSent(Model):
    email: str
    role: ShowRole
    title: str | None = None
    expires_at: int


class InviteAccepted(Model):
    show_id: str
    role: ShowRole
