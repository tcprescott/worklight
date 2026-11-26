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
    Keeper,
    Measurements,
    Membership,
    Notice,
    NoticeRead,
    RehearsalSlot,
    Scene,
    Show,
    ShowItem,
    StockItem,
    StrikeTemplateTask,
    Theater,
    User,
    WeeklyConflict,
)
from worklight.services import schedule, strike
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
    seed_wardrobe(ctx, jordan, users)
    seed_strike(ctx, jordan, users)


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


STRIKE_TEMPLATE = [
    ("Set", "Unscrew and drop the forest flats"),
    ("Set", "Break down the bower platform, stack lumber by length"),
    ("Set", "Pull screws and bin the hardware"),
    ("Props", "Return borrowed props to their lenders"),
    ("Props", "Pack the prop tables"),
    ("Costumes", "Collect costumes for laundry and return rentals"),
    ("Lights & sound", "Restore the rep plot and pull gels"),
    ("Lights & sound", "Coil and store cable"),
    ("Space", "Sweep and mop the deck"),
    ("Space", "Final walkthrough with the venue"),
]


def seed_strike(ctx: Ctx, director: User, users: dict[str, User]) -> None:
    """The company strike list, and Midsummer's strike call the day after closing, partly assigned."""
    ctx.store.replace_strike_template(
        "maplewood",
        [
            StrikeTemplateTask(task_id=f"tpl{i}", theater_id="maplewood", area=a, text=t, order=i)
            for i, (a, t) in enumerate(STRIKE_TEMPLATE, start=1)
        ],
    )
    schedule.create_call(
        ctx,
        director,
        "midsummer",
        schedule.CreateCallBody(date="2026-12-07", start="10:00", end="14:00", type="strike"),
    )
    schedule.publish(
        ctx,
        director,
        "midsummer",
        schedule.PublishBody.model_validate({"from": "2026-12-07", "to": "2026-12-07"}),
    )
    tasks = ctx.store.list_strike_tasks("midsummer")
    who = {
        0: ["Sam Whitfield", "Ana Ruiz"],
        1: ["Sam Whitfield"],
        3: ["Priya Nair"],
        5: ["Lin Park"],
        6: ["Ana Ruiz"],
        9: ["Priya Nair"],
    }
    for i, names in who.items():
        body = strike.UpdateTaskBody(
            assignee_ids=[users[n].user_id for n in names], done=True if i == 0 else None
        )
        strike.update_task(ctx, director, "midsummer", tasks[i].task_id, body)


def _swatch(rgb: tuple[int, int, int], accent: tuple[int, int, int]) -> bytes:
    """A small PNG: a colour field with a band across it, standing in for a photo."""
    import struct
    import zlib

    size = 96
    rows = b"".join(b"\x00" + bytes(accent if 36 <= y < 60 else rgb) * size for y in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


# (kind, name, character or None, status, source, lender, due back, cents: cost, rental, deposit, colours)
ITEMS: list[
    tuple[str, str, str | None, str, str | None, str | None, str | None, tuple[int, int, int], tuple]
] = [
    (
        "costume",
        "Athenian gown, white",
        "Hermia",
        "ready",
        "stock",
        None,
        None,
        (0, 0, 0),
        ((236, 230, 220), (200, 170, 90)),
    ),
    (
        "costume",
        "Athenian gown, blue",
        "Helena",
        "pulled",
        "rented",
        "Costume Barn",
        "2026-12-10",
        (0, 8500, 5000),
        ((90, 120, 180), (220, 200, 140)),
    ),
    (
        "costume",
        "Tunic and sash",
        "Lysander",
        "needed",
        None,
        None,
        None,
        (0, 0, 0),
        ((150, 90, 60), (230, 210, 170)),
    ),
    (
        "costume",
        "Duke's doublet",
        "Theseus",
        "pulled",
        "borrowed",
        "Lincoln High Theatre",
        "2026-12-12",
        (0, 0, 0),
        ((110, 30, 40), (210, 170, 60)),
    ),
    (
        "costume",
        "Donkey head",
        "Bottom",
        "building",
        "built",
        None,
        None,
        (4000, 0, 0),
        ((120, 100, 85), (60, 50, 45)),
    ),
    (
        "costume",
        "Weaver's smock",
        "Bottom",
        "ready",
        "stock",
        None,
        None,
        (0, 0, 0),
        ((140, 110, 80), (90, 70, 50)),
    ),
    (
        "costume",
        "Fairy queen gown",
        "Titania",
        "pulled",
        "rented",
        "Costume Barn",
        "2026-12-10",
        (0, 12000, 5000),
        ((120, 160, 120), (230, 220, 240)),
    ),
    (
        "costume",
        "Flower crown",
        "Titania",
        "needed",
        None,
        None,
        None,
        (0, 0, 0),
        ((220, 170, 190), (120, 160, 100)),
    ),
    (
        "costume",
        "Antler crown",
        "Oberon",
        "building",
        "built",
        None,
        None,
        (2500, 0, 0),
        ((90, 70, 50), (40, 60, 40)),
    ),
    (
        "costume",
        "Leaf vest",
        "Puck",
        "ready",
        "bought",
        None,
        None,
        (3000, 0, 0),
        ((70, 110, 60), (140, 170, 90)),
    ),
    (
        "costume",
        "Fairy wings (6)",
        "Fairies",
        "needed",
        None,
        None,
        None,
        (0, 0, 0),
        ((210, 225, 235), (180, 200, 220)),
    ),
    (
        "prop",
        "Love-in-idleness flower",
        "Puck",
        "ready",
        "built",
        None,
        None,
        (800, 0, 0),
        ((170, 60, 120), (80, 130, 70)),
    ),
    (
        "prop",
        "Script scrolls (6)",
        "Quince",
        "ready",
        "bought",
        None,
        None,
        (600, 0, 0),
        ((230, 215, 180), (150, 120, 80)),
    ),
    (
        "prop",
        "Hunting horn",
        "Theseus",
        "pulled",
        "borrowed",
        "Riverside Community Band",
        "2026-12-08",
        (0, 0, 0),
        ((190, 150, 60), (120, 90, 40)),
    ),
    (
        "prop",
        "Lantern",
        None,
        "pulled",
        "borrowed",
        "Lincoln High Theatre",
        "2026-12-12",
        (0, 0, 0),
        ((60, 60, 70), (240, 200, 90)),
    ),
    (
        "prop",
        "Bower cushions",
        "Titania",
        "needed",
        None,
        None,
        None,
        (0, 0, 0),
        ((150, 100, 140), (210, 180, 200)),
    ),
]

STOCK = [
    ("costume", "Athenian gown, white", "Dresses", "10", "Rack A"),
    ("costume", "Weaver's smock", "Shirts and smocks", "XL", "Bin 4"),
    ("costume", "Victorian tailcoat", "Coats", "42R", "Rack C"),
    ("costume", "Top hat", "Hats", "7 1/4", "Shelf 2"),
    ("costume", "Peasant blouse", "Shirts and smocks", "M", "Bin 4"),
    ("prop", "Wooden goblets (4)", "Tableware", None, "Props loft, box 3"),
    ("prop", "Rubber swords (2)", "Weapons", None, "Props loft, rack"),
    ("prop", "Picnic basket", "Hand props", None, "Props loft, box 7"),
]


def seed_wardrobe(ctx: Ctx, director: User, users: dict[str, User]) -> None:
    """Lin runs costumes and Priya props; Lin and Sam keep the company stock. Midsummer has a costume plot
    half done, two rentals, two loans, measurements for a few of the cast, and fittings."""
    from worklight.photos import key_for

    store, now, show_id, theater_id = ctx.store, now_iso(), "midsummer", "maplewood"
    lin, priya, sam = users["Lin Park"], users["Priya Nair"], users["Sam Whitfield"]
    for person, costumes, props in ((lin, True, False), (priya, False, True)):
        m = store.get_membership(show_id, person.user_id)
        assert m
        store.put_membership(m.model_copy(update={"costume_access": costumes, "props_access": props}))
    store.put_keeper(Keeper(theater_id=theater_id, user_id=lin.user_id, costumes=True))
    store.put_keeper(Keeper(theater_id=theater_id, user_id=sam.user_id, props=True))

    def photo(name: str, colours: tuple) -> list[str]:
        if ctx.photos is None:
            return []
        import re

        photo_id = "seed-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".png"
        ctx.photos.put(key_for(theater_id, photo_id), _swatch(*colours), "image/png")
        return [photo_id]

    stock: dict[str, StockItem] = {}
    palette = [
        ((236, 230, 220), (200, 170, 90)),
        ((140, 110, 80), (90, 70, 50)),
        ((30, 30, 40), (120, 120, 130)),
        ((25, 25, 25), (90, 30, 30)),
        ((240, 235, 225), (170, 140, 120)),
        ((150, 100, 60), (110, 70, 40)),
        ((120, 120, 130), (80, 60, 40)),
        ((180, 140, 80), (120, 90, 50)),
    ]
    for i, (kind, name, category, size, location) in enumerate(STOCK):
        item = StockItem(
            item_id=f"stock{i + 1}",
            theater_id=theater_id,
            kind=kind,  # type: ignore[arg-type]
            name=name,
            category=category,
            size=size,
            location=location,
            photo_ids=photo(f"stock {name}", palette[i]),
            created_at=now,
            updated_at=now,
        )
        stock[name] = item

    scenes_of: dict[str, list[str]] = {}
    for _act, number, _name, _pages, who in SCENES:
        for c in who:
            scenes_of.setdefault(c, []).append(f"s{number.replace('.', '-')}")
    for i, (kind, name, char, status, source, lender, due, (cost, rental, deposit), colours) in enumerate(
        ITEMS
    ):
        from_stock = stock.get(name) if source == "stock" else None
        item = ShowItem(
            item_id=f"item{i + 1}",
            show_id=show_id,
            theater_id=theater_id,
            kind=kind,  # type: ignore[arg-type]
            name=name,
            char_ids=[f"c-{char.lower()}"] if char else [],
            scene_ids=scenes_of.get(char, []) if char else ["s2-1", "s2-2", "s3-1"],
            status=status,  # type: ignore[arg-type]
            source=source,  # type: ignore[arg-type]
            stock_item_id=from_stock.item_id if from_stock else None,
            lender=lender,
            due_back=due,
            lender_contact="Dana at the front desk, 555-0142" if lender == "Costume Barn" else None,
            cost_cents=cost or None,
            rental_fee_cents=rental or None,
            deposit_cents=deposit or None,
            notes="Hem up 2 inches for Amélie" if name == "Athenian gown, blue" else None,
            photo_ids=from_stock.photo_ids
            if from_stock
            else (photo(name, colours) if status != "needed" else []),
            created_at=now,
            updated_at=now,
        )
        store.put_show_item(item)
        if from_stock:
            stock[name] = from_stock.model_copy(
                update={"in_show_id": show_id, "in_show_item_id": item.item_id}
            )
    store.put_stock_items(list(stock.values()))

    sheets = {
        "Maya Chen": dict(
            height="5' 4\"",
            weight="125 lb",
            shoe="7.5",
            suit_dress="6",
            shirt="S",
            trouser="27 / 29",
            bra="34B",
            hat="22",
            head=22,
            neck=13,
            chest=34,
            underbust=29,
            waist=27,
            hip=37,
            below_knee=13,
            inseam=29,
            outseam=39.5,
            nape_to_waist=15.5,
            nape_to_floor=54,
            nape_to_shoulder=7,
            to_elbow=19.5,
            to_wrist=29,
            across_shoulders=14.5,
            waist_to_floor=40,
            notes="Allergic to wool. Pierced ears.",
        ),
        "George Haddad": dict(
            height="5' 11\"",
            weight="255 lb",
            shoe="12",
            head=25,
            neck=18,
            chest=47,
            underbust=45.5,
            waist=47.5,
            hip=46,
            below_knee=16.5,
            inseam=35,
            outseam=42,
            nape_to_waist=20,
            nape_to_floor=66,
            nape_to_shoulder=12,
            to_elbow=21.5,
            to_wrist=32.5,
            across_shoulders=20,
            waist_to_floor=43,
            notes="None",
        ),
        "Elena Rossi": dict(
            height="5' 8\"", shoe="9", suit_dress="10", head=22.5, chest=38, waist=31, hip=40
        ),
    }
    for name, fields in sheets.items():
        store.put_measurements(
            Measurements(
                user_id=users[name].user_id,
                **fields,  # type: ignore[arg-type]
                updated_at=now,
                updated_by=lin.user_id if name == "George Haddad" else users[name].user_id,
            )
        )

    for day, start, end, who in (
        ("2026-11-07", "13:30", "15:00", ["George Haddad", "Elena Rossi"]),
        ("2026-11-28", "13:30", "15:00", ["Maya Chen", "Kofi Mensah", "Amélie Moreau"]),
    ):
        schedule.create_call(
            ctx,
            director,
            show_id,
            schedule.CreateCallBody(
                date=day,
                start=start,
                end=end,
                type="fitting",
                title="Costume fitting",
                location="Costume shop",
                user_ids=[users[n].user_id for n in who],
            ),
        )
        schedule.publish(
            ctx, director, show_id, schedule.PublishBody.model_validate({"from": day, "to": day})
        )
