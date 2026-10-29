"""Sample data from the design canvas: Maplewood Players rehearsing A Midsummer Night's Dream.

Everyone's email is <first name>@example.org, so you can sign in as anyone on the dev server.
"""

from worklight.ids import now_iso
from worklight.models import (
    Act,
    Appearance,
    Character,
    DateConflict,
    Membership,
    RehearsalSlot,
    Scene,
    Show,
    Theater,
    WeeklyConflict,
)
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
        start_date="2026-12-08",
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
