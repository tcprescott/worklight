from typing import Any

from tests.client import DIRECTOR, Client, join
from tests.fakes import FakeMailer
from tests.test_public_api import _as, _key
from tests.test_schedule import _show

# Smallest file that starts like a JPEG; the API only checks the first bytes.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
DESIGNER = "jo@example.org"
PROPS = "ren@example.org"


def _theater(call: Client, show: dict[str, Any]) -> str:
    return str(call.ok(DIRECTOR, "GET", f"/api/shows/{show['id']}")["show"]["theaterId"])


def _team(call: Client, mailer: FakeMailer) -> dict[str, Any]:
    """The sample show plus a costume designer (crew, costume access) and a props master (crew, props
    access). Their ticks are set by the director."""
    show = _show(call, mailer)
    base = show["base"]
    show["jo"] = join(call, mailer, show["id"], DESIGNER, role="crew", name="Jo Lane", department="Costumes")
    show["ren"] = join(call, mailer, show["id"], PROPS, role="crew", name="Ren Ito", department="Props")
    jo = call.ok(DIRECTOR, "PATCH", f"{base}/members/{show['jo']}", {"costumeAccess": True})
    assert jo["costumeAccess"] is True and jo["propsAccess"] is False
    call.ok(DIRECTOR, "PATCH", f"{base}/members/{show['ren']}", {"propsAccess": True})
    breakdown = call.ok(DIRECTOR, "GET", f"{base}/breakdown")
    show["chars"] = {c["name"]: c["charId"] for c in breakdown["characters"]}
    return show


def test_access_ticks_decide_who_manages_what(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base = show["base"]
    hermia = show["chars"]["Hermia"]

    # Jo manages costumes, not props; Ren the other way round.
    gown = call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {"kind": "costume", "name": "Athenian gown", "charIds": [hermia], "sceneIds": [show["s1"]]},
    )
    assert gown["status"] == "needed" and gown["sceneIds"] == [show["s1"]]
    status, err = call(DESIGNER, "POST", f"{base}/wardrobe/items", {"kind": "prop", "name": "Love potion"})
    assert status == 403 and "props access" in err["error"]
    call.ok(
        PROPS, "POST", f"{base}/wardrobe/items", {"kind": "prop", "name": "Love potion", "status": "ready"}
    )
    assert call(PROPS, "PATCH", f"{base}/wardrobe/items/{gown['itemId']}", {"status": "ready"})[0] == 403

    # Staff without ticks can look but not change anything; other crew and cast can't open the tracker.
    tracker = call.ok(DIRECTOR, "GET", f"{base}/wardrobe")
    assert tracker["canEditCostumes"] is False and tracker["canSeeMeasurements"] is False
    assert [i["name"] for i in tracker["items"]] == ["Athenian gown", "Love potion"]
    assert tracker["costumes"] == {"total": 1, "needed": 1, "pulled": 0, "building": 0, "ready": 0}
    assert tracker["props"]["ready"] == 1
    assert call(DIRECTOR, "PATCH", f"{base}/wardrobe/items/{gown['itemId']}", {"status": "ready"})[0] == 403
    assert call("sam@example.org", "GET", f"{base}/wardrobe")[0] == 403
    assert call("maya@example.org", "GET", f"{base}/wardrobe")[0] == 403

    # The designer's own view of the show says what they can do.
    view = call.ok(DESIGNER, "GET", base)
    assert view["costumeAccess"] is True and view["propsAccess"] is False
    # Unknown characters and scenes are refused.
    status, err = call(
        DESIGNER, "POST", f"{base}/wardrobe/items", {"kind": "costume", "name": "Cape", "charIds": ["nope"]}
    )
    assert status == 400 and "charIds" in err["error"]


def test_cast_see_their_items_by_scene_without_the_backstage_details(
    call: Client, mailer: FakeMailer
) -> None:
    show = _team(call, mailer)
    base = show["base"]
    call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {
            "kind": "costume",
            "name": "Athenian gown",
            "charIds": [show["chars"]["Hermia"]],
            "sceneIds": [show["s1"]],
            "status": "building",
            "source": "rented",
            "lender": "Costume Barn",
            "rentalFeeCents": 8500,
            "notes": "Hem needs 2 inches",
        },
    )
    call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {
            "kind": "costume",
            "name": "Donkey head",
            "charIds": [show["chars"]["Bottom"]],
            "sceneIds": [show["s2"]],
        },
    )
    mine = call.ok("maya@example.org", "GET", f"{base}/wardrobe/mine")
    assert [i["name"] for i in mine["items"]] == ["Athenian gown"]
    item = mine["items"][0]
    assert item["characters"] == ["Hermia"] and item["sceneIds"] == [show["s1"]]
    for hidden in ("status", "source", "lender", "rentalFeeCents", "notes"):
        assert hidden not in item
    assert [s["sceneId"] for s in mine["scenes"]] == [show["s1"]]
    assert mine["measured"] == 0


def test_measurements_follow_the_person_and_stay_private(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base, maya = show["base"], show["maya"]

    # Maya fills in her own form; quarter inches are kept, finer is rounded.
    sheet = call.ok(
        "maya@example.org",
        "PATCH",
        f"{base}/measurements/{maya}",
        {
            "height": "5' 6\"",
            "shoe": "8",
            "waist": 28.5,
            "chest": 34.3,
            "notes": "Wool allergy",
            "needs": "Wig",
        },
    )
    assert sheet["measurements"]["waist"] == 28.5 and sheet["measurements"]["chest"] == 34.25
    assert sheet["measured"] == 2 and sheet["sizesFilled"] == 2 and sheet["parts"] == ["Hermia"]
    assert sheet["needs"]["needs"] == "Wig"

    # The costume designer sees and fixes it; the director, other crew and other cast can't see it.
    fixed = call.ok(DESIGNER, "PATCH", f"{base}/measurements/{maya}", {"waist": 29})
    assert fixed["measurements"]["waist"] == 29 and fixed["updatedByName"] == "Jo Lane"
    assert fixed["measurements"]["chest"] == 34.25
    for who in (DIRECTOR, PROPS, "jay@example.org"):
        assert call(who, "GET", f"{base}/measurements/{maya}")[0] == 403
    assert call(DIRECTOR, "GET", f"{base}/measurements")[0] == 403
    rows = call.ok(DESIGNER, "GET", f"{base}/measurements")
    assert [r["parts"] for r in rows] == [["Hermia"], ["Lysander"], ["Bottom"]]
    assert rows[0]["measured"] == 2 and rows[0]["hasNotes"] is True and rows[0]["hasNeeds"] is True

    # Silly numbers are refused.
    assert call("maya@example.org", "PATCH", f"{base}/measurements/{maya}", {"waist": -3})[0] == 400

    # A second show in the same company: the numbers are already there, the show's needs start blank.
    theater = _theater(call, show)
    second = call.ok(
        DIRECTOR,
        "POST",
        f"/api/theaters/{theater}/shows",
        {
            "name": "Twelfth Night",
            "timezone": "America/Chicago",
            "startDate": "2027-02-01",
            "endDate": "2027-04-01",
        },
    )["showId"]
    join(call, mailer, second, "maya@example.org")
    again = call.ok("maya@example.org", "GET", f"/api/shows/{second}/measurements/{maya}")
    assert again["measurements"]["waist"] == 29 and again["needs"].get("needs") is None


def test_photos_upload_and_attach(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base = show["base"]
    status, photo = call.upload(DESIGNER, f"{base}/photos", JPEG)
    assert status == 201 and photo["photoId"].endswith(".jpg") and photo["url"].startswith("/api/dev/photos/")
    item = call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {"kind": "costume", "name": "Cloak", "photoIds": [photo["photoId"]]},
    )
    assert item["photos"][0]["photoId"] == photo["photoId"]
    # Taking the picture off the item deletes it.
    assert len(call.photos.files) == 1
    call.ok(DESIGNER, "PATCH", f"{base}/wardrobe/items/{item['itemId']}", {"photoIds": []})
    assert call.photos.files == {}

    # Only pictures: text is refused, and so are ids that weren't made here.
    status, err = call.upload(DESIGNER, f"{base}/photos", b"hello", content_type="text/plain")
    assert status == 400 and "JPEG" in err["error"]
    bad = {"kind": "costume", "name": "Cloak", "photoIds": ["../../etc/passwd"]}
    assert call(DESIGNER, "POST", f"{base}/wardrobe/items", bad)[0] == 400
    # People outside the show can't upload.
    assert call.upload("stranger@example.org", f"{base}/photos", JPEG)[0] == 403


def test_money_totals_and_deposits(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base = show["base"]
    call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {"kind": "costume", "name": "Boots", "source": "bought", "costCents": 4000},
    )
    gown = call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/items",
        {
            "kind": "costume",
            "name": "Gown",
            "source": "rented",
            "lender": "Costume Barn",
            "rentalFeeCents": 8500,
            "depositCents": 5000,
            "dueBack": "2026-12-10",
        },
    )
    money = call.ok(DIRECTOR, "GET", f"{base}/wardrobe")["money"]
    assert (money["spentCents"], money["boughtCents"], money["rentalCents"]) == (12500, 4000, 8500)
    assert money["depositsOutCents"] == 5000 and money["deposits"][0]["lender"] == "Costume Barn"
    call.ok(DESIGNER, "PATCH", f"{base}/wardrobe/items/{gown['itemId']}", {"depositBack": True})
    assert call.ok(DIRECTOR, "GET", f"{base}/wardrobe")["money"]["depositsOutCents"] == 0
    # Switching to bought drops the lender details.
    switched = call.ok(DESIGNER, "PATCH", f"{base}/wardrobe/items/{gown['itemId']}", {"source": "bought"})
    assert "lender" not in switched and "dueBack" not in switched


def test_company_stock_keepers_pull_and_return(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base, theater = show["base"], _theater(call, show)
    keeper = "pat@example.org"

    # Admins name keepers; the keeper isn't in any show but sees the company on their home page.
    keepers = call.ok(
        DIRECTOR,
        "PUT",
        f"/api/theaters/{theater}/keepers",
        {"email": keeper, "name": "Pat Moss", "costumes": True},
    )
    assert [(k["name"], k["costumes"], k["props"]) for k in keepers] == [("Pat Moss", True, False)]
    assert call(DESIGNER, "GET", f"/api/theaters/{theater}/keepers")[0] == 403
    me = call.ok(keeper, "GET", "/api/me")
    assert me["keeps"] == [
        {"theaterId": theater, "theaterName": "Riverside Players", "costumes": True, "props": False}
    ]

    # Pat adds stock (costumes only); the designer can browse it but not change it.
    status, photo = call.upload(keeper, f"/api/theaters/{theater}/photos", JPEG)
    assert status == 201
    dress = call.ok(
        keeper,
        "POST",
        f"/api/theaters/{theater}/stock",
        {
            "kind": "costume",
            "name": "Blue ball gown",
            "size": "10",
            "location": "Rack B",
            "photoIds": [photo["photoId"]],
        },
    )
    assert call(keeper, "POST", f"/api/theaters/{theater}/stock", {"kind": "prop", "name": "Sword"})[0] == 403
    stock = call.ok(DESIGNER, "GET", f"/api/theaters/{theater}/stock")
    assert [i["name"] for i in stock["items"]] == ["Blue ball gown"] and stock["rights"][
        "editCostumes"
    ] is False
    assert (
        call(DESIGNER, "PATCH", f"/api/theaters/{theater}/stock/{dress['itemId']}", {"size": "12"})[0] == 403
    )
    # Props people don't see costume stock; cast see none.
    assert call.ok(PROPS, "GET", f"/api/theaters/{theater}/stock")["items"] == []
    assert call("maya@example.org", "GET", f"/api/theaters/{theater}/stock")[0] == 403

    # The designer pulls it for Hermia: it's out with the show, with its picture, until it's back.
    pulled = call.ok(
        DESIGNER,
        "POST",
        f"{base}/wardrobe/pull",
        {"stockItemId": dress["itemId"], "charIds": [show["chars"]["Hermia"]]},
    )
    assert (pulled["source"], pulled["status"], pulled["stockName"]) == ("stock", "pulled", "Blue ball gown")
    assert pulled["photos"][0]["photoId"] == photo["photoId"]
    out = call.ok(keeper, "GET", f"/api/theaters/{theater}/stock")["items"][0]
    assert out["inShowName"] == "Our Town"
    assert call(DESIGNER, "POST", f"{base}/wardrobe/pull", {"stockItemId": dress["itemId"]})[0] == 409
    assert call(keeper, "DELETE", f"/api/theaters/{theater}/stock/{dress['itemId']}")[0] == 409

    # Deleting the show's item keeps the stock picture, and frees the stock item.
    call.ok(DESIGNER, "PATCH", f"{base}/wardrobe/items/{pulled['itemId']}", {"returned": True})
    assert "inShowId" not in call.ok(keeper, "GET", f"/api/theaters/{theater}/stock")["items"][0]
    call.ok(DESIGNER, "PATCH", f"{base}/wardrobe/items/{pulled['itemId']}", {"returned": False})
    assert call.ok(keeper, "GET", f"/api/theaters/{theater}/stock")["items"][0]["inShowId"] == show["id"]
    assert call(DESIGNER, "DELETE", f"{base}/wardrobe/items/{pulled['itemId']}")[0] == 204
    assert len(call.photos.files) == 1
    assert "inShowId" not in call.ok(keeper, "GET", f"/api/theaters/{theater}/stock")["items"][0]

    # Unticking both removes a keeper.
    call.ok(DIRECTOR, "PUT", f"/api/theaters/{theater}/keepers", {"email": keeper})
    assert call.ok(keeper, "GET", "/api/me")["keeps"] == []


def test_strike_gets_one_return_task_per_lender(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base, theater = show["base"], _theater(call, show)

    def item(**body: Any) -> dict[str, Any]:
        who = PROPS if body.get("kind") == "prop" else DESIGNER
        return dict(call.ok(who, "POST", f"{base}/wardrobe/items", {"kind": "costume", **body}))

    item(name="Gown", source="rented", lender="Costume Barn", dueBack="2026-12-10", lenderContact="555-0100")
    item(name="Cape", source="rented", lender="costume barn ")
    lantern = item(kind="prop", name="Lantern", source="borrowed", lender="Lincoln High")
    item(name="Boots", source="bought")
    call.ok(DIRECTOR, "PUT", f"/api/theaters/{theater}/keepers", {"email": DESIGNER, "costumes": True})
    stocked = call.ok(
        DESIGNER, "POST", f"/api/theaters/{theater}/stock", {"kind": "costume", "name": "Top hat"}
    )
    call.ok(DESIGNER, "POST", f"{base}/wardrobe/pull", {"stockItemId": stocked["itemId"]})

    # Nothing on the strike list until strike is scheduled.
    assert call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"] == []
    call.ok(
        DIRECTOR,
        "POST",
        f"{base}/calls",
        {"date": "2026-12-07", "start": "10:00", "end": "14:00", "type": "strike"},
    )
    tasks = call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"]
    returns = {t["text"]: t for t in tasks if t["area"] == "Returns"}
    assert set(returns) == {
        "Return 2 items to Costume Barn",
        "Return 1 item to Lincoln High",
        "Put 1 item back in company stock",
    }
    barn = returns["Return 2 items to Costume Barn"]
    assert (
        barn["returnItems"] == ["Cape", "Gown"]
        and barn["note"] == "Due back Thursday, December 10 · 555-0100"
    )

    # A new loan joins its lender's task; deleting the only item from a lender removes theirs.
    item(name="Shawl", source="rented", lender="Costume Barn")
    call.ok(PROPS, "DELETE", f"{base}/wardrobe/items/{lantern['itemId']}")
    texts = {t["text"] for t in call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"] if t["area"] == "Returns"}
    assert texts == {"Return 3 items to Costume Barn", "Put 1 item back in company stock"}

    # Ticking a task off marks its items returned, and the stock item is back on the shelf.
    tasks = call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"]
    restock = next(t for t in tasks if t["text"].startswith("Put"))
    call.ok(DIRECTOR, "PATCH", f"{base}/strike/tasks/{restock['taskId']}", {"done": True})
    assert "inShowId" not in call.ok(DESIGNER, "GET", f"/api/theaters/{theater}/stock")["items"][0]
    hat = next(i for i in call.ok(DESIGNER, "GET", f"{base}/wardrobe")["items"] if i["name"] == "Top hat")
    assert hat["returnedAt"]
    # The done task stays done.
    tasks = call.ok(DIRECTOR, "GET", f"{base}/strike")["tasks"]
    assert next(t for t in tasks if t["taskId"] == restock["taskId"])["doneAt"]


def test_fittings_show_on_the_tracker_and_for_the_actor(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    base = show["base"]
    fitting = call.ok(
        DIRECTOR,
        "POST",
        f"{base}/calls",
        {
            "date": "2026-11-05",
            "start": "18:00",
            "end": "18:30",
            "type": "fitting",
            "userIds": [show["maya"]],
        },
    )
    tracker = call.ok(DESIGNER, "GET", f"{base}/wardrobe")
    # Crew see published calls only.
    assert tracker["fittings"] == []
    call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", {"from": "2026-11-01", "to": "2026-11-30"})
    tracker = call.ok(DESIGNER, "GET", f"{base}/wardrobe")
    assert [(f["userId"], f["date"], f["start"]) for f in tracker["fittings"]] == [
        (show["maya"], "2026-11-05", "18:00")
    ]
    mine = call.ok("maya@example.org", "GET", f"{base}/wardrobe/mine")
    assert mine["nextFitting"]["callId"] == fitting["callId"]
    calls = call.ok("maya@example.org", "GET", f"/api/me/calls?showId={show['id']}")
    assert any(c.get("type") == "fitting" for c in calls)


def test_public_api_reads_the_tracker(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    secret = _key(call, show, "read")
    call.ok(DESIGNER, "POST", f"{show['base']}/wardrobe/items", {"kind": "costume", "name": "Cloak"})
    status, data = call(None, "GET", f"/api/v1/shows/{show['id']}/wardrobe", headers=_as(secret))
    assert status == 200 and [i["name"] for i in data["items"]] == ["Cloak"]


def test_graphql_and_mcp_read_costumes_and_props(call: Client, mailer: FakeMailer) -> None:
    show = _team(call, mailer)
    secret = _key(call, show, "read")
    call.ok(DESIGNER, "POST", f"{show['base']}/wardrobe/items", {"kind": "costume", "name": "Cloak"})
    status, body = call(
        None,
        "POST",
        "/api/graphql",
        {
            "query": "query($id: ID!) { costumesAndProps(showId: $id) { name kind status } }",
            "variables": {"id": show["id"]},
        },
        headers=_as(secret),
    )
    assert status == 200 and body["data"]["costumesAndProps"] == [
        {"name": "Cloak", "kind": "costume", "status": "needed"}
    ]
    status, body = call(
        None,
        "POST",
        "/mcp",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_costumes_and_props", "arguments": {"show_id": show["id"]}},
        },
        headers=_as(secret),
    )
    assert status == 200 and "Cloak" in body["result"]["content"][0]["text"]
