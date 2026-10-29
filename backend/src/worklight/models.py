"""Domain records and API shapes. Fields are camelCase on the wire and in DynamoDB."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Plan = Literal["free", "paid"]
ShowRole = Literal["staff", "cast", "crew"]
TheaterRole = Literal["admin"]
ShowStatus = Literal["active", "archived"]
MemberStatus = Literal["invited", "joined"]
# hard = can't come, soft = would rather not, partial = arrives late or leaves early.
ConflictLevel = Literal["hard", "soft", "partial"]
# A date answer can also say "free", which overrides a weekly rule for that one date.
DateAnswer = Literal["free", "hard", "soft", "partial"]


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


class RehearsalSlot(Model):
    """A usual rehearsal night: weekday 0 = Monday ... 6 = Sunday, times as HH:MM in the show's timezone."""

    weekday: int = Field(ge=0, le=6)
    start: str
    end: str


class Show(Model):
    show_id: str
    theater_id: str
    name: str
    venue: str | None = None
    address: str | None = None
    # IANA timezone, e.g. "America/Chicago". Every call time is shown in this zone.
    timezone: str
    # First rehearsal and closing performance, YYYY-MM-DD.
    start_date: str
    end_date: str
    # Usual rehearsal nights. Dates are generated from these between startDate and the day before tech.
    slots: list[RehearsalSlot] = []
    # Generated rehearsal dates the director skipped (holidays and the like).
    skipped_dates: list[str] = []
    off_book_date: str | None = None
    # First day of tech week, and opening night. Tech through closing is "no conflicts allowed".
    tech_start: str | None = None
    opening_date: str | None = None
    # Minutes of rehearsal per script page; scene times come from this unless a scene overrides it.
    minutes_per_page: float = 8
    conflict_deadline: str | None = None
    # Printed on the stage door sign; scanning it checks a person in for tonight.
    door_code: str | None = None
    status: ShowStatus = "active"
    archived_at: str | None = None
    created_at: str


class Membership(Model):
    show_id: str
    theater_id: str
    user_id: str
    role: ShowRole
    # Free text such as "Director", "Stage manager", "Lights".
    title: str | None = None
    # Crew and staff are grouped by department, e.g. "Stage management", "Costumes".
    department: str | None = None
    # Invited people are members from the moment they're invited, so they can be cast before they join.
    status: MemberStatus = "joined"
    invite_token: str | None = None
    invited_at: str | None = None
    joined_at: str | None = None
    # When the person last pressed Send on their conflicts for this show.
    conflicts_submitted_at: str | None = None


class NotifyPrefs(Model):
    """What a person wants emailed to them. Calendar feeds and the app are always on."""

    # The day before each call.
    email_reminders: bool = True
    # When a published call of theirs is added, moved, changed or cancelled.
    change_emails: bool = True
    # New notices on the callboard.
    notice_emails: bool = True


class User(Model):
    user_id: str
    email: str
    name: str | None = None
    created_at: str
    prefs: NotifyPrefs = NotifyPrefs()
    # Secret part of the person's calendar feed URL.
    calendar_token: str | None = None


class Invite(Model):
    token: str
    show_id: str
    theater_id: str
    user_id: str
    email: str
    invited_by: str
    created_at: str
    # Epoch seconds; DynamoDB TTL removes the item after this.
    expires_at: int


class MagicLinkRecord(Model):
    email: str
    code_hash: str
    created_at: int
    expires_at: int


# ---- Script breakdown ----------------------------------------------------------------------------


class Act(Model):
    act_id: str
    show_id: str
    name: str
    order: int


class Scene(Model):
    scene_id: str
    show_id: str
    act_id: str
    # Short label shown on cards, e.g. "1.2" or "Opening number".
    number: str
    name: str
    order: int
    # Length in eighths of a page, the way stage managers count ("4 3/8" = 35).
    eighths: int = 0
    # Rehearsal minutes for big dance or fight numbers; otherwise it comes from the page count.
    minutes_override: int | None = None


class Character(Model):
    char_id: str
    show_id: str
    name: str
    order: int
    # The people playing this part. Several for double casting, none until cast.
    cast_user_ids: list[str] = []
    # A group like "Fairies": called as one, the cast list holds everyone in it.
    ensemble: bool = False


class Appearance(Model):
    show_id: str
    scene_id: str
    char_id: str


class Breakdown(Model):
    acts: list[Act]
    scenes: list[Scene]
    characters: list[Character]
    appearances: list[Appearance]


# ---- Conflicts ---------------------------------------------------------------------------------


class WeeklyConflict(Model):
    """A usual-week rule, e.g. "never Tuesdays" or "late on Wednesdays". One per weekday."""

    user_id: str
    weekday: int = Field(ge=0, le=6)
    level: ConflictLevel
    # For partial: arrival and/or leaving time, HH:MM.
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None
    updated_at: str


class DateConflict(Model):
    """An answer for one date. It wins over a weekly rule for that date."""

    user_id: str
    date: str
    level: DateAnswer
    arrive: str | None = None
    leave: str | None = None
    note: str | None = None
    updated_at: str


class MyConflicts(Model):
    weekly: list[WeeklyConflict]
    dates: list[DateConflict]


# ---- Scheduling ----------------------------------------------------------------------------------

CallType = Literal["rehearsal", "music", "choreography", "run", "tech", "dress", "performance"]
CallStatus = Literal["draft", "published"]
# Who a call covers besides the people in its scenes.
CallGroup = Literal["everyone", "cast", "crew"]
CheckInStatus = Literal["on_time", "late", "absent"]


class Block(Model):
    """A timed slice of a call: these scenes (or a label like "Warm-up"), from start for minutes."""

    block_id: str
    # Leave out to start when the block before it ends (the first starts with the call).
    start: str | None = None
    minutes: int
    scene_ids: list[str] = []
    label: str | None = None
    # People called for this block on top of the scenes' cast.
    user_ids: list[str] = []


class CallContent(Model):
    """What a call is. Staff edit a working copy; cast and crew see the copy as of the last publish."""

    date: str
    start: str
    end: str
    type: CallType = "rehearsal"
    title: str | None = None
    location: str | None = None
    bring: str | None = None
    note: str | None = None
    blocks: list[Block] = []
    # Everyone, all cast or all crew, for tech, dress and performances.
    groups: list[CallGroup] = []
    # Departments called (e.g. "Costumes"), for tech calls by department.
    departments: list[str] = []
    # Extra people called for the whole call.
    user_ids: list[str] = []
    # Tech, dress and performances call crew at a different time from cast.
    crew_start: str | None = None
    cancelled: bool = False


class Call(CallContent):
    call_id: str
    show_id: str
    theater_id: str
    status: CallStatus = "draft"
    # Bumped on every publish that changes the call, for calendar updates (ICS SEQUENCE).
    sequence: int = 0
    published: CallContent | None = None
    published_at: str | None = None
    # When the day-before reminder went out.
    reminded_at: str | None = None
    updated_at: str
    created_at: str


class CheckIn(Model):
    """One person on one tech or performance night (or a rehearsal they said they'd be late to)."""

    show_id: str
    date: str
    user_id: str
    # Unset until they arrive or staff mark them.
    status: CheckInStatus | None = None
    arrived_at: str | None = None
    by_self: bool = False
    # "Running late" from the person, before they arrive.
    running_late_minutes: int | None = None
    note: str | None = None
    updated_at: str


# ---- Callboard -----------------------------------------------------------------------------------

NoticeAudience = Literal["everyone", "cast", "crew"]


class Notice(Model):
    notice_id: str
    show_id: str
    theater_id: str
    title: str
    body: str
    audience: NoticeAudience = "everyone"
    pinned: bool = False
    author_id: str
    created_at: str
    updated_at: str


class NoticeRead(Model):
    show_id: str
    notice_id: str
    user_id: str
    at: str


# ---- API shapes --------------------------------------------------------------------------------


class MyShow(Model):
    show: Show
    theater_name: str
    role: ShowRole
    title: str | None = None
    status: MemberStatus = "joined"
    conflicts_submitted_at: str | None = None


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
    theater_name: str
    role: ShowRole
    title: str | None = None
    # True for company admins who aren't in the show themselves.
    via_admin: bool = False


class Member(Model):
    user_id: str
    name: str | None = None
    # Only staff see email addresses.
    email: str | None = None
    role: ShowRole
    title: str | None = None
    department: str | None = None
    status: MemberStatus
    conflicts_submitted_at: str | None = None


class InviteSent(Model):
    user_id: str
    email: str
    role: ShowRole
    title: str | None = None
    expires_at: int


class InviteAccepted(Model):
    show_id: str
    role: ShowRole


class InvitePreview(Model):
    """What the sign-in page shows for an invite link, before anyone signs in."""

    email: str
    show_name: str
    theater_name: str
    inviter_name: str
    role: ShowRole
    # e.g. "Hermia", or the person's title for staff and crew.
    part: str | None = None


class MemberConflicts(Model):
    user_id: str
    weekly: list[WeeklyConflict]
    dates: list[DateConflict]


class Admin(Model):
    user_id: str
    name: str | None = None
    email: str
    title: str | None = None


class ShowSummary(Model):
    show: Show
    staff: list[Member]
    cast_count: int
    crew_count: int
    # Members who haven't sent their conflicts yet (invited or joined).
    waiting_count: int


class TheaterView(Model):
    theater: Theater
    admins: list[Admin]
    shows: list[ShowSummary]
