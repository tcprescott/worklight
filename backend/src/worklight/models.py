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
    # Ticked by staff: manages the show's costumes (and sees cast measurements), or its props.
    costume_access: bool = False
    props_access: bool = False


class NotifyPrefs(Model):
    """What a person wants sent to them, by email and by push. Calendar feeds and the app are always on."""

    # The day before each call.
    email_reminders: bool = True
    # When a published call of theirs is added, moved, changed or cancelled.
    change_emails: bool = True
    # New notices on the callboard.
    notice_emails: bool = True
    # The same three, as push notifications to each device the person turned push on for.
    push_reminders: bool = True
    push_changes: bool = True
    push_notices: bool = True


# webpush = a browser subscription. A native app later adds its own kind (and a sender for it).
PushKind = Literal["webpush"]


class PushDevice(Model):
    """One phone or computer that gets push notifications for a person."""

    device_id: str
    user_id: str
    kind: PushKind
    # Web push: the subscription's endpoint on the browser vendor's push service, and its two keys.
    endpoint: str
    p256dh: str
    auth: str
    # Shown in settings, e.g. "Chrome on Android".
    label: str | None = None
    created_at: str
    last_sent_at: str | None = None


class PushDeviceView(Model):
    device_id: str
    kind: PushKind
    label: str | None = None
    created_at: str
    last_sent_at: str | None = None


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

CallType = Literal[
    "rehearsal", "music", "choreography", "run", "tech", "dress", "performance", "strike", "fitting"
]
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


# ---- Strike ---------------------------------------------------------------------------------------


class StrikeTemplateTask(Model):
    """One line of a company's standard strike list. Each show starts its checklist from a copy."""

    task_id: str
    theater_id: str
    # Grouping on the checklist, e.g. "Set", "Props", "Lights & sound".
    area: str
    text: str
    order: int


class StrikeTask(Model):
    """One job on a show's strike checklist, done by the named people (crew or staff)."""

    task_id: str
    show_id: str
    area: str
    text: str
    order: int
    note: str | None = None
    assignee_ids: list[str] = []
    done_at: str | None = None
    done_by: str | None = None
    # Set on the tasks Worklight keeps for returning costumes and props: "restock" for company stock, or
    # "lender:<name>" for everything rented or borrowed from one place. Ticking it off marks those returned.
    return_key: str | None = None
    created_at: str
    updated_at: str


# ---- Costumes and props --------------------------------------------------------------------------

ItemKind = Literal["costume", "prop"]
# needed = still to find, pulled = found (from stock, a rental...), building = being made or altered.
ItemStatus = Literal["needed", "pulled", "building", "ready"]
# Where it comes from. "actor" means the actor's own clothes or things.
ItemSource = Literal["stock", "bought", "built", "rented", "borrowed", "actor"]


class ShowItem(Model):
    """One costume piece or prop a show needs, who wears or uses it, and in which scenes."""

    item_id: str
    show_id: str
    theater_id: str
    kind: ItemKind
    name: str
    # The characters it's for. None for things nobody in particular carries (set dressing and the like).
    char_ids: list[str] = []
    scene_ids: list[str] = []
    status: ItemStatus = "needed"
    source: ItemSource | None = None
    # Pulled from the company's stock.
    stock_item_id: str | None = None
    # Rented or borrowed: from whom, how to reach them, and when it has to go back.
    lender: str | None = None
    lender_contact: str | None = None
    due_back: str | None = None
    # Back with its lender (or in company stock) after the show.
    returned_at: str | None = None
    # Money in cents: what it cost to buy or build, the rental fee, and any deposit paid.
    cost_cents: int | None = None
    rental_fee_cents: int | None = None
    deposit_cents: int | None = None
    deposit_back_at: str | None = None
    notes: str | None = None
    photo_ids: list[str] = []
    created_at: str
    updated_at: str


class StockItem(Model):
    """Something the company owns and keeps between shows."""

    item_id: str
    theater_id: str
    kind: ItemKind
    name: str
    # e.g. "Dresses", "Hats", "Hand props".
    category: str | None = None
    size: str | None = None
    # Where it's kept, e.g. "Bin 14" or "Loft, left rack".
    location: str | None = None
    notes: str | None = None
    photo_ids: list[str] = []
    # Pulled for this show (and its item there) until it's back.
    in_show_id: str | None = None
    in_show_item_id: str | None = None
    created_at: str
    updated_at: str


class Keeper(Model):
    """Someone who looks after the company's costume and/or prop stock, named by a company admin."""

    theater_id: str
    user_id: str
    costumes: bool = False
    props: bool = False


class Measurements(Model):
    """A person's sizes and body measurements. They follow the person from show to show.

    Lengths are inches. Numbers 1 to 16 match the usual measurement sheet's diagram."""

    user_id: str
    height: str | None = None
    weight: str | None = None
    shoe: str | None = None
    suit_dress: str | None = None
    shirt: str | None = None
    trouser: str | None = None
    bra: str | None = None
    hat: str | None = None
    head: float | None = None  # 1
    neck: float | None = None  # 2 base of neck
    chest: float | None = None  # 3 chest or bust
    underbust: float | None = None  # 4 ribcage or underbust
    waist: float | None = None  # 5
    hip: float | None = None  # 6 at the fullest point
    below_knee: float | None = None  # 7
    inseam: float | None = None  # 8 inseam to floor
    outseam: float | None = None  # 9 outseam to floor
    nape_to_waist: float | None = None  # 10
    nape_to_floor: float | None = None  # 11
    nape_to_shoulder: float | None = None  # 12 centre back nape to shoulder
    to_elbow: float | None = None  # 13
    to_wrist: float | None = None  # 14
    across_shoulders: float | None = None  # 15 back shoulder seams
    waist_to_floor: float | None = None  # 16
    # Allergies (wool, detergent, dyes), piercings, tattoos, anything else the costume team should know.
    notes: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None


class CostumeNeeds(Model):
    """For one person in one show: costume, hair and accessory needs, with idea pictures."""

    show_id: str
    user_id: str
    needs: str | None = None
    photo_ids: list[str] = []
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


# ---- API keys --------------------------------------------------------------------------------------

ApiKeyScope = Literal["read", "write"]


class ApiKey(Model):
    """A company's key for the public REST, GraphQL and MCP APIs. It acts as the admin who made it."""

    key_id: str
    theater_id: str
    name: str
    scope: ApiKeyScope = "read"
    # The first characters of the secret, so people can tell keys apart. The secret itself is never stored.
    prefix: str
    created_by: str
    created_at: str
    last_used_at: str | None = None


class ApiKeyRecord(ApiKey):
    # SHA-256 of the secret, to find the key from a request and to delete its lookup item.
    secret_hash: str


# ---- API shapes --------------------------------------------------------------------------------


class MyShow(Model):
    show: Show
    theater_name: str
    role: ShowRole
    title: str | None = None
    status: MemberStatus = "joined"
    conflicts_submitted_at: str | None = None
    costume_access: bool = False
    props_access: bool = False


class MyTheater(Model):
    theater: Theater
    role: TheaterRole


class MyKeeper(Model):
    """A company whose costume or prop stock I look after."""

    theater_id: str
    theater_name: str
    costumes: bool
    props: bool


class Me(Model):
    """What the signed-in user sees on their home page."""

    user: User
    theaters: list[MyTheater]
    shows: list[MyShow]
    keeps: list[MyKeeper] = []


class ShowView(Model):
    show: Show
    theater_name: str
    role: ShowRole
    title: str | None = None
    # True for company admins who aren't in the show themselves.
    via_admin: bool = False
    # Ticked by staff: manages costumes (and sees measurements) or props.
    costume_access: bool = False
    props_access: bool = False


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
    # Only staff see these.
    costume_access: bool | None = None
    props_access: bool | None = None


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
