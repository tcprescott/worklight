"""Sample data from the design canvas: Maplewood Players rehearsing A Midsummer Night's Dream.

Everyone's email is <first name>@example.org, so you can sign in as anyone on the dev server.
"""

from worklight.ids import now_iso
from worklight.models import (
    Act,
    Appearance,
    Character,
    CheckIn,
    DateConflict,
    Membership,
    Notice,
    NoticeRead,
    RehearsalSlot,
    Scene,
    Show,
    Theater,
    User,
    WeeklyConflict,
)
from worklight.services import schedule
from worklight.services.base import Ctx, user_for_email

# (name, part or title, role, department, status) where status is invited, joined or ready.
PEOPLE = [
    ("Daniel Okafor", "Theseus", "cast", None, "ready"),
    ("Rosa Alvarez", "Hippolyta", "cast", None, "ready"),
    ("Tom Byrne", "Egeus", "cast", None, "joined"),
    ("Maya Chen", "Hermia", "cast", None, "ready"),
    ("Jay Patel", "Lysander", "cast", None, "ready"),
    ("Sean Kim", "Demetrius", "cast", None, "invited"),
    ("Amélie Moreau", "Helena", "cast", None, "ready"),
    ("Petra Novak", "Quince", "cast", None, "ready"),
    ("George Haddad", "Bottom", "cast", None, "ready"),
    ("Lee Brooks", "Flute", "cast", None, "joined"),
    ("Kofi Mensah", "Oberon", "cast", None, "ready"),
    ("Elena Rossi", "Titania", "cast", None, "ready"),
    ("Nao Sato", "Puck", "cast", None, "ready"),
    ("Ivy Larsen", "Fairies", "cast", None, "invited"),
    ("Omar Farouk", "Fairies", "cast", None, "joined"),
    ("Priya Nair", "Stage manager", "staff", "Stage management", "ready"),
    ("Sam Whitfield", "Technical director", "crew", "Set and tech", "ready"),
    ("Ana Ruiz", "Lighting", "crew", "Set and tech", "joined"),
    ("Lin Park", "Costumes", "crew", "Costumes", "ready"),
    ("Marco Bianchi", "Sound", "crew", "Set and tech", "invited"),
]

SCENES = [
    (
        1,
        "1.1",
        "Theseus's palace",
        7,
        ["Theseus", "Hippolyta", "Egeus", "Hermia", "Lysander", "Demetrius", "Helena"],
    ),
    (1, "1.2", "Quince's house", 4, ["Quince", "Bottom", "Flute"]),
    (2, "2.1", "The wood", 9, ["Puck", "Fairies", "Oberon", "Titania", "Demetrius", "Helena"]),
    (
        2,
        "2.2",
        "Another part of the wood",
        6,
        ["Titania", "Fairies", "Oberon", "Lysander", "Hermia", "Puck", "Demetrius", "Helena"],
    ),
    (3, "3.1", "The mechanicals rehearse", 8, ["Quince", "Bottom", "Flute", "Puck", "Titania", "Fairies"]),
    (3, "3.2", "The lovers' quarrel", 14, ["Oberon", "Puck", "Demetrius", "Hermia", "Lysander", "Helena"]),
    (
        4,
        "4.1",
        "Titania wakes",
        8,
        [
            "Titania",
            "Bottom",
            "Fairies",
            "Oberon",
            "Puck",
            "Theseus",
            "Hippolyta",
            "Egeus",
            "Lysander",
            "Demetrius",
            "Hermia",
            "Helena",
        ],
    ),
    (4, "4.2", "Bottom returns", 2, ["Quince", "Flute", "Bottom"]),
    (
        5,
        "5.1",
        "The wedding and the play",
        15,
        [
            "Theseus",
            "Hippolyta",
            "Lysander",
            "Demetrius",
            "Hermia",
            "Helena",
            "Quince",
            "Bottom",
            "Flute",
            "Puck",
            "Oberon",
            "Titania",
            "Fairies",
        ],
    ),
]
CHARACTERS = [
    "Theseus",
    "Hippolyta",
    "Egeus",
    "Hermia",
    "Lysander",
    "Demetrius",
    "Helena",
    "Quince",
    "Bottom",
    "Flute",
    "Oberon",
    "Titania",
    "Puck",
    "Fairies",
]
ACTS = ["Act One", "Act Two", "Act Three", "Act Four", "Act Five"]


def email_for(name: str) -> str:
    return f"{name.split()[0].lower().replace('é', 'e')}@example.org"


def seed(ctx: Ctx) -> None:
    store = ctx.store
    now = now_iso()
    jordan = user_for_email(ctx, "jordan@example.org", "Jordan Reyes")
    theater = Theater(theater_id="maplewood", name="Maplewood Players", plan="free", created_at=now)
    store.create_theater(theater, jordan.user_id, "Artistic director")
    for name, title in (("Helen Ortiz", "Board president"), ("Raj Mehta", "Treasurer")):
        store.put_admin(theater.theater_id, user_for_email(ctx, email_for(name), name).user_id, title)

    show = Show(
        show_id="midsummer",
        theater_id=theater.theater_id,
        name="A Midsummer Night's Dream",
        venue="Fellowship Hall",
        address="210 Elm St",
        timezone="America/Chicago",
        start_date="2026-11-02",
        end_date="2026-12-06",
        slots=[RehearsalSlot(weekday=d, start="19:00", end="21:30") for d in (0, 1, 2, 3)]
        + [RehearsalSlot(weekday=5, start="10:00", end="13:00")],
        skipped_dates=["2026-11-26"],
        off_book_date="2026-11-16",
        tech_start="2026-11-29",
        opening_date="2026-12-04",
        conflict_deadline="2026-10-30",
        created_at=now,
    )
    store.create_show(
        show,
        Membership(
            show_id=show.show_id,
            theater_id=theater.theater_id,
            user_id=jordan.user_id,
            role="staff",
            title="Director",
            department="Production",
            joined_at=now,
        ),
    )

    acts = [Act(act_id=f"act{i}", show_id=show.show_id, name=n, order=i) for i, n in enumerate(ACTS, start=1)]
    for act in acts:
        store.put_act(act)
    chars = {
        n: Character(char_id=f"c-{n.lower()}", show_id=show.show_id, name=n, order=i, ensemble=n == "Fairies")
        for i, n in enumerate(CHARACTERS, start=1)
    }
    for order, (act_no, number, name, pages, who) in enumerate(SCENES, start=1):
        scene = Scene(
            scene_id=f"s{number.replace('.', '-')}",
            show_id=show.show_id,
            act_id=f"act{act_no}",
            number=number,
            name=name,
            order=order,
            eighths=pages * 8,
        )
        store.put_scene(scene)
        for c in who:
            store.put_appearance(
                Appearance(show_id=show.show_id, scene_id=scene.scene_id, char_id=chars[c].char_id)
            )

    users = {}
    for name, part, role, dept, status in PEOPLE:
        person = user_for_email(ctx, email_for(name), name)
        users[name] = person
        if part in chars:
            chars[part].cast_user_ids.append(person.user_id)
        store.put_membership(
            Membership(
                show_id=show.show_id,
                theater_id=theater.theater_id,
                user_id=person.user_id,
                role=role,  # type: ignore[arg-type]
                title=None if part in chars else part,
                department=dept,
                status="invited" if status == "invited" else "joined",
                invited_at=now,
                joined_at=None if status == "invited" else now,
                conflicts_submitted_at=now if status == "ready" else None,
            )
        )
    for c in chars.values():
        store.put_character(c)

    def date(user: str, day: str, level: str, arrive: str | None = None, leave: str | None = None) -> None:
        store.put_date_conflict(
            DateConflict(
                user_id=users[user].user_id,
                date=day,
                level=level,  # type: ignore[arg-type]
                arrive=arrive,
                leave=leave,
                updated_at=now,
            )
        )

    date("Maya Chen", "2026-11-06", "hard")
    date("Maya Chen", "2026-11-12", "partial", arrive="19:45")
    date("Maya Chen", "2026-11-18", "soft")
    date("George Haddad", "2026-11-02", "soft")
    date("George Haddad", "2026-11-09", "hard")
    date("Nao Sato", "2026-11-03", "hard")
    date("Nao Sato", "2026-11-11", "partial", leave="21:00")
    date("Amélie Moreau", "2026-11-09", "partial", arrive="19:45")
    store.put_weekly_conflict(
        WeeklyConflict(user_id=users["Jay Patel"].user_id, weekday=3, level="soft", updated_at=now)
    )

    # A second show in setup, directed by Dana, with Maya also in it: her conflicts are shared.
    dana = user_for_email(ctx, "dana@example.org", "Dana Wu")
    carol = Show(
        show_id="carol",
        theater_id=theater.theater_id,
        name="A Christmas Carol (staged reading)",
        timezone="America/Chicago",
        start_date="2026-11-09",
        end_date="2026-12-20",
        opening_date="2026-12-18",
        created_at=now,
    )
    store.create_show(
        carol,
        Membership(
            show_id="carol",
            theater_id=theater.theater_id,
            user_id=dana.user_id,
            role="staff",
            title="Director",
            department="Production",
            joined_at=now,
        ),
    )
    our_town = Show(
        show_id="ourtown",
        theater_id=theater.theater_id,
        name="Our Town",
        venue="Main stage",
        timezone="America/Chicago",
        start_date="2026-02-02",
        end_date="2026-04-12",
        opening_date="2026-04-03",
        created_at=now,
    )
    store.create_show(
        our_town,
        Membership(
            show_id="ourtown",
            theater_id=theater.theater_id,
            user_id=jordan.user_id,
            role="staff",
            title="Director",
            department="Production",
            joined_at=now,
        ),
    )

    # Elena is also reading for Carol, which has called her on Tuesday Nov 10: Midsummer sees her as
    # "called elsewhere" that night without seeing which show.
    elena = users["Elena Rossi"]
    store.put_membership(
        Membership(
            show_id="carol",
            theater_id=theater.theater_id,
            user_id=elena.user_id,
            role="cast",
            title=None,
            joined_at=now,
            conflicts_submitted_at=now,
        )
    )
    schedule.create_call(
        ctx,
        dana,
        "carol",
        schedule.CreateCallBody(
            date="2026-11-10", start="19:00", end="21:00", groups=["cast"], title="Read-through"
        ),
    )
    schedule.publish(
        ctx, dana, "carol", schedule.PublishBody.model_validate({"from": "2026-11-09", "to": "2026-11-15"})
    )

    seed_schedule(ctx, jordan, users)
    seed_callboard(ctx, jordan, users)


def seed_schedule(ctx: Ctx, director: User, users: dict[str, User]) -> None:
    """The first week published, the week of Nov 9 drafted as on the Schedule board, and tech week called."""
    show_id = "midsummer"

    def night(day: str, *scenes: str, **fields: object) -> None:
        blocks = [schedule.BlockBody(scene_ids=[f"s{s.replace('.', '-')}"]) for s in scenes]
        if "label" in fields:
            blocks.insert(
                0, schedule.BlockBody(label=str(fields.pop("label")), minutes=int(str(fields.pop("minutes"))))
            )
        schedule.create_call(
            ctx,
            director,
            show_id,
            schedule.CreateCallBody.model_validate({"date": day, "blocks": blocks, **fields}),
        )

    week1 = {"location": "Fellowship Hall", "bring": "Script and a pencil"}
    night(
        "2026-11-02", label="Read-through, Act 1", minutes=150, groups=["cast"], title="Read-through", **week1
    )
    night("2026-11-03", "1.1", **week1)
    night("2026-11-04", "1.2", "2.2", **week1)
    night("2026-11-05", "1.1", "2.1", **week1)
    night("2026-11-07", "3.1", **week1)
    schedule.publish(
        ctx,
        director,
        show_id,
        schedule.PublishBody.model_validate({"from": "2026-11-02", "to": "2026-11-08"}),
    )

    night("2026-11-09", "1.1")
    night("2026-11-10", "1.2", "3.1")
    night("2026-11-11", "2.1", "2.2")
    night("2026-11-14", "5.1")

    schedule.create_tech_calls(
        ctx, director, show_id, schedule.TechCallsBody(start="18:00", end="22:00", crew_start="17:30")
    )
    schedule.publish(
        ctx,
        director,
        show_id,
        schedule.PublishBody.model_validate({"from": "2026-11-29", "to": "2026-12-06"}),
    )
    stamp = now_iso()
    for name, status in (("Tom Byrne", "absent"), ("Nao Sato", "late")):
        ctx.store.put_checkin(
            CheckIn(
                show_id=show_id,
                date="2026-11-29",
                user_id=users[name].user_id,
                status=status,
                updated_at=stamp,
            )  # type: ignore[arg-type]
        )
    for name, _, _, _, _ in PEOPLE:
        if name not in ("Tom Byrne", "Nao Sato"):
            ctx.store.put_checkin(
                CheckIn(
                    show_id=show_id,
                    date="2026-11-29",
                    user_id=users[name].user_id,
                    status="on_time",
                    arrived_at=stamp,
                    updated_at=stamp,
                )
            )


NOTICES = [
    (
        "welcome",
        "Jordan Reyes",
        "Welcome to the woods",
        "Thrilled to have you all. Please add your conflicts by Friday so I can build the November schedule.",
        "everyone",
        False,
        "2026-10-26T15:00:00Z",
    ),
    (
        "offbook",
        "Priya Nair",
        "Off-book dates",
        "Act 1 off book by Monday, November 16. The whole show by Monday, November 23. "
        "Line notes start on the 16th.",
        "cast",
        True,
        "2026-10-27T18:00:00Z",
    ),
    (
        "build",
        "Sam Whitfield",
        "Set build this Saturday",
        "Saturday, November 7 from 9 AM to 3 PM on the main stage. Closed-toe shoes, and bring work gloves "
        "if you have them. Pizza at noon.",
        "crew",
        False,
        "2026-10-27T22:00:00Z",
    ),
]


def seed_callboard(ctx: Ctx, director: User, users: dict[str, User]) -> None:
    """Three notices like the Callboard board. Maya and Tom have read none of them."""
    everyone = {**users, director.name or "": director}
    for notice_id, author, title, body, audience, pinned, at in NOTICES:
        ctx.store.put_notice(
            Notice(
                notice_id=notice_id,
                show_id="midsummer",
                theater_id="maplewood",
                title=title,
                body=body,
                audience=audience,  # type: ignore[arg-type]
                pinned=pinned,
                author_id=everyone[author].user_id,
                created_at=at,
                updated_at=at,
            )
        )
    readers = [n for n, *_ in PEOPLE if n not in ("Maya Chen", "Tom Byrne")]
    for name in readers[: len(readers) * 3 // 4]:
        for notice_id in ("welcome", "offbook", "build"):
            ctx.store.put_notice_read(
                NoticeRead(
                    show_id="midsummer", notice_id=notice_id, user_id=users[name].user_id, at=now_iso()
                )
            )
