from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

from worklight import keys
from worklight.models import (
    Act,
    Appearance,
    Call,
    Character,
    CheckIn,
    DateConflict,
    Invite,
    MagicLinkRecord,
    Membership,
    Model,
    Notice,
    NoticeRead,
    Scene,
    Show,
    Theater,
    User,
    WeeklyConflict,
)

if TYPE_CHECKING:
    from mypy_boto3_dynamodb.client import DynamoDBClient


_KEY_ATTRS = ("PK", "SK", "GSI1PK", "GSI1SK", "entity")
_serializer = TypeSerializer()
_deserializer = TypeDeserializer()


def _plain(value: Any) -> Any:
    """DynamoDB numbers come back as Decimal; models want int or float."""
    from decimal import Decimal

    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def _to_ddb(item: dict[str, Any]) -> dict[str, Any]:
    from decimal import Decimal

    def prep(v: Any) -> Any:
        if isinstance(v, float):
            return Decimal(str(v))
        if isinstance(v, list):
            return [prep(x) for x in v]
        if isinstance(v, dict):
            return {k: prep(x) for k, x in v.items()}
        return v

    return {k: _serializer.serialize(prep(v)) for k, v in item.items()}


def _from_ddb(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _plain(_deserializer.deserialize(v)) for k, v in item.items() if k not in _KEY_ATTRS}


def _raw_from_ddb(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _plain(_deserializer.deserialize(v)) for k, v in item.items()}


def _item(key: keys.Key, kind: str, record: Model) -> dict[str, Any]:
    return {**key, "entity": kind, **record.to_item()}


def _chunks[T](items: list[T], size: int) -> Iterable[list[T]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


@dataclass
class ShowPartition:
    """Everything stored under one show, read with a single Query."""

    members: list[Membership] = field(default_factory=list)
    acts: list[Act] = field(default_factory=list)
    scenes: list[Scene] = field(default_factory=list)
    characters: list[Character] = field(default_factory=list)
    appearances: list[Appearance] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)
    checkins: list[CheckIn] = field(default_factory=list)
    notices: list[Notice] = field(default_factory=list)
    reads: list[NoticeRead] = field(default_factory=list)


class DynamoStore:
    """Everything the API reads and writes, over one DynamoDB table (see keys.py for the layout)."""

    def __init__(self, table: str, client: DynamoDBClient | None = None) -> None:
        self.table = table
        self.db: DynamoDBClient = client or boto3.client("dynamodb")

    # ---- helpers ------------------------------------------------------------------------------

    def _get(self, key: keys.Key) -> dict[str, Any] | None:
        res = self.db.get_item(TableName=self.table, Key=_to_ddb(keys.primary(key)))
        item = res.get("Item")
        return _from_ddb(item) if item else None

    def _put(self, item: dict[str, Any]) -> Any:
        return {"TableName": self.table, "Item": _to_ddb(item)}

    def _put_item(self, key: keys.Key, kind: str, record: Model) -> None:
        self.db.put_item(**self._put(_item(key, kind, record)))

    def _delete(self, key: keys.Key) -> None:
        self.db.delete_item(TableName=self.table, Key=_to_ddb(keys.primary(key)))

    def _tx_put(self, item: dict[str, Any], *, new: bool = False) -> Any:
        """A transaction Put; new=True fails the transaction if the key already exists."""
        put = self._put(item)
        if new:
            put["ConditionExpression"] = "attribute_not_exists(PK)"
        return {"Put": put}

    def _batch_get(self, key_list: list[keys.Key]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for group in _chunks(key_list, 100):
            pending: list[Any] = [_to_ddb(keys.primary(k)) for k in group]
            while pending:
                res = self.db.batch_get_item(RequestItems={self.table: {"Keys": pending}})
                out.extend(_from_ddb(item) for item in res.get("Responses", {}).get(self.table, []))
                unprocessed: Any = res.get("UnprocessedKeys", {}).get(self.table, {})
                pending = list(unprocessed.get("Keys", []))
        return out

    def _batch_delete(self, key_list: list[keys.Key]) -> None:
        for group in _chunks(key_list, 25):
            pending: list[Any] = [{"DeleteRequest": {"Key": _to_ddb(keys.primary(k))}} for k in group]
            while pending:
                res = self.db.batch_write_item(RequestItems={self.table: pending})
                pending = list(res.get("UnprocessedItems", {}).get(self.table, []))

    def _query_raw(self, pk: str, sk_prefix: str, index: str | None = None) -> list[dict[str, Any]]:
        """Every item under pk whose sort key starts with sk_prefix ("" for the whole partition)."""
        pk_name, sk_name = ("GSI1PK", "GSI1SK") if index else ("PK", "SK")
        params: dict[str, Any] = {
            "TableName": self.table,
            "KeyConditionExpression": "#pk = :pk",
            "ExpressionAttributeNames": {"#pk": pk_name},
            "ExpressionAttributeValues": {":pk": {"S": pk}},
        }
        if sk_prefix:
            params["KeyConditionExpression"] += " AND begins_with(#sk, :sk)"
            params["ExpressionAttributeNames"]["#sk"] = sk_name
            params["ExpressionAttributeValues"][":sk"] = {"S": sk_prefix}
        if index:
            params["IndexName"] = index
        items: list[dict[str, Any]] = []
        while True:
            res = self.db.query(**params)
            items.extend(_raw_from_ddb(item) for item in res.get("Items", []))
            if "LastEvaluatedKey" not in res:
                return items
            params["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def _query_all(self, pk: str, sk_prefix: str, index: str | None = None) -> list[dict[str, Any]]:
        return [
            {k: v for k, v in item.items() if k not in _KEY_ATTRS}
            for item in self._query_raw(pk, sk_prefix, index)
        ]

    # ---- users --------------------------------------------------------------------------------

    def get_user(self, user_id: str) -> User | None:
        item = self._get(keys.user(user_id))
        return User.model_validate(item) if item else None

    def get_user_id_by_email(self, email: str) -> str | None:
        item = self._get(keys.email(email))
        return str(item["userId"]) if item else None

    def create_user(self, user: User) -> str:
        """Creates the user and its email mapping. Returns the existing userId if the email is mapped."""
        user = user.model_copy(update={"email": keys.normalize_email(user.email)})
        try:
            self.db.transact_write_items(
                TransactItems=[
                    self._tx_put(
                        {**keys.email(user.email), "entity": "email", "userId": user.user_id}, new=True
                    ),
                    self._tx_put(_item(keys.user(user.user_id), "user", user)),
                ]
            )
            return user.user_id
        except self.db.exceptions.TransactionCanceledException:
            # Two first requests raced; the other one won, so use its user.
            existing = self.get_user_id_by_email(user.email)
            if existing:
                return existing
            raise

    def update_user_name(self, user_id: str, name: str) -> None:
        self.db.update_item(
            TableName=self.table,
            Key=_to_ddb(keys.user(user_id)),
            UpdateExpression="SET #name = :name",
            ConditionExpression="attribute_exists(PK)",
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={":name": {"S": name}},
        )

    def put_user(self, user: User) -> None:
        """Saves the profile (name, preferences, feed token). The email never changes."""
        self._put_item(keys.user(user.user_id), "user", user)

    # ---- calendar feeds -----------------------------------------------------------------------

    def put_feed(self, token: str, user_id: str) -> None:
        self.db.put_item(**self._put({**keys.feed(token), "entity": "feed", "userId": user_id}))

    def get_feed_user_id(self, token: str) -> str | None:
        item = self._get(keys.feed(token))
        return str(item["userId"]) if item else None

    def delete_feed(self, token: str) -> None:
        self._delete(keys.feed(token))

    def get_users(self, user_ids: Iterable[str]) -> list[User]:
        return [
            User.model_validate(i) for i in self._batch_get([keys.user(u) for u in dict.fromkeys(user_ids)])
        ]

    # ---- theaters -----------------------------------------------------------------------------

    def create_theater(self, theater: Theater, admin_user_id: str, admin_title: str | None = None) -> None:
        self.db.transact_write_items(
            TransactItems=[
                self._tx_put(_item(keys.theater(theater.theater_id), "theater", theater), new=True),
                self._tx_put(self._admin_item(theater.theater_id, admin_user_id, admin_title)),
            ]
        )

    def _admin_item(self, theater_id: str, user_id: str, title: str | None) -> dict[str, Any]:
        item: dict[str, Any] = {
            **keys.theater_admin(theater_id, user_id),
            "entity": "theaterAdmin",
            "theaterId": theater_id,
            "userId": user_id,
        }
        if title:
            item["title"] = title
        return item

    def get_theater(self, theater_id: str) -> Theater | None:
        item = self._get(keys.theater(theater_id))
        return Theater.model_validate(item) if item else None

    def get_theaters(self, theater_ids: Iterable[str]) -> list[Theater]:
        refs = [keys.theater(t) for t in dict.fromkeys(theater_ids)]
        return [Theater.model_validate(i) for i in self._batch_get(refs)]

    def list_admin_theater_ids(self, user_id: str) -> list[str]:
        items = self._query_all(keys.user_gsi(user_id), keys.THEATER_PREFIX, index="GSI1")
        return [str(i["theaterId"]) for i in items]

    def is_theater_admin(self, theater_id: str, user_id: str) -> bool:
        return self._get(keys.theater_admin(theater_id, user_id)) is not None

    def list_admins(self, theater_id: str) -> list[tuple[str, str | None]]:
        """(userId, title) for each company admin."""
        items = self._query_all(keys.theater(theater_id)["PK"], keys.ADMIN_PREFIX)
        return [(str(i["userId"]), i.get("title")) for i in items]

    def put_admin(self, theater_id: str, user_id: str, title: str | None) -> None:
        self.db.put_item(**self._put(self._admin_item(theater_id, user_id, title)))

    def delete_admin(self, theater_id: str, user_id: str) -> None:
        self._delete(keys.theater_admin(theater_id, user_id))

    def list_theater_shows(self, theater_id: str) -> list[Show]:
        items = self._query_all(keys.theater(theater_id)["PK"], keys.SHOW_PREFIX)
        return [Show.model_validate(i) for i in items]

    # ---- shows --------------------------------------------------------------------------------

    def create_show(self, show: Show, creator: Membership) -> None:
        pointer = {
            **keys.show_pointer(show.show_id),
            "entity": "showPointer",
            "showId": show.show_id,
            "theaterId": show.theater_id,
        }
        self.db.transact_write_items(
            TransactItems=[
                self._tx_put(_item(keys.show(show.theater_id, show.show_id), "show", show), new=True),
                self._tx_put(pointer),
                self._tx_put(_item(keys.member(creator.show_id, creator.user_id), "member", creator)),
            ]
        )

    def put_show(self, show: Show) -> None:
        self._put_item(keys.show(show.theater_id, show.show_id), "show", show)

    def get_show(self, show_id: str) -> Show | None:
        pointer = self._get(keys.show_pointer(show_id))
        if not pointer:
            return None
        item = self._get(keys.show(str(pointer["theaterId"]), show_id))
        return Show.model_validate(item) if item else None

    def get_shows(self, refs: Iterable[tuple[str, str]]) -> list[Show]:
        """refs are (theaterId, showId) pairs."""
        return [Show.model_validate(i) for i in self._batch_get([keys.show(t, s) for t, s in refs])]

    def load_show(self, show_id: str) -> ShowPartition:
        part = ShowPartition()
        for item in self._query_raw(keys.show_pointer(show_id)["PK"], ""):
            sk = str(item["SK"])
            data = {k: v for k, v in item.items() if k not in _KEY_ATTRS}
            if sk.startswith(keys.MEMBER_PREFIX):
                part.members.append(Membership.model_validate(data))
            elif sk.startswith(keys.ACT_PREFIX):
                part.acts.append(Act.model_validate(data))
            elif sk.startswith(keys.SCENE_PREFIX):
                part.scenes.append(Scene.model_validate(data))
            elif sk.startswith(keys.CHAR_PREFIX):
                part.characters.append(Character.model_validate(data))
            elif sk.startswith(keys.APPEAR_PREFIX):
                part.appearances.append(Appearance.model_validate(data))
            elif sk.startswith(keys.CALL_PREFIX):
                part.calls.append(Call.model_validate(data))
            elif sk.startswith(keys.CHECKIN_PREFIX):
                part.checkins.append(CheckIn.model_validate(data))
            elif sk.startswith(keys.NOTICE_PREFIX):
                part.notices.append(Notice.model_validate(data))
            elif sk.startswith(keys.READ_PREFIX):
                part.reads.append(NoticeRead.model_validate(data))
        part.acts.sort(key=lambda a: a.order)
        part.scenes.sort(key=lambda s: s.order)
        part.characters.sort(key=lambda c: c.order)
        return part

    # ---- memberships --------------------------------------------------------------------------

    def list_memberships(self, user_id: str) -> list[Membership]:
        items = self._query_all(keys.user_gsi(user_id), keys.SHOW_PREFIX, index="GSI1")
        return [Membership.model_validate(i) for i in items]

    def get_membership(self, show_id: str, user_id: str) -> Membership | None:
        item = self._get(keys.member(show_id, user_id))
        return Membership.model_validate(item) if item else None

    def list_members(self, show_id: str) -> list[Membership]:
        items = self._query_all(keys.show_pointer(show_id)["PK"], keys.MEMBER_PREFIX)
        return [Membership.model_validate(i) for i in items]

    def put_membership(self, membership: Membership) -> None:
        self._put_item(keys.member(membership.show_id, membership.user_id), "member", membership)

    def delete_membership(self, show_id: str, user_id: str) -> None:
        self._delete(keys.member(show_id, user_id))

    # ---- invites ------------------------------------------------------------------------------

    def put_invite(self, invite: Invite) -> None:
        self._put_item(keys.invite(invite.token), "invite", invite)

    def get_invite(self, token: str) -> Invite | None:
        item = self._get(keys.invite(token))
        return Invite.model_validate(item) if item else None

    def delete_invite(self, token: str) -> None:
        self._delete(keys.invite(token))

    # ---- script breakdown ---------------------------------------------------------------------

    def put_act(self, act: Act) -> None:
        self._put_item(keys.act(act.show_id, act.act_id), "act", act)

    def delete_act(self, show_id: str, act_id: str) -> None:
        self._delete(keys.act(show_id, act_id))

    def put_scene(self, scene: Scene) -> None:
        self._put_item(keys.scene(scene.show_id, scene.scene_id), "scene", scene)

    def delete_scene(self, show_id: str, scene_id: str, appearances: Iterable[Appearance]) -> None:
        self._batch_delete(
            [keys.scene(show_id, scene_id)]
            + [keys.appearance(show_id, a.scene_id, a.char_id) for a in appearances]
        )

    def put_character(self, character: Character) -> None:
        self._put_item(keys.character(character.show_id, character.char_id), "character", character)

    def delete_character(self, show_id: str, char_id: str, appearances: Iterable[Appearance]) -> None:
        self._batch_delete(
            [keys.character(show_id, char_id)]
            + [keys.appearance(show_id, a.scene_id, a.char_id) for a in appearances]
        )

    def put_appearance(self, appearance: Appearance) -> None:
        key = keys.appearance(appearance.show_id, appearance.scene_id, appearance.char_id)
        self._put_item(key, "appearance", appearance)

    def delete_appearance(self, show_id: str, scene_id: str, char_id: str) -> None:
        self._delete(keys.appearance(show_id, scene_id, char_id))

    # ---- calls --------------------------------------------------------------------------------

    def list_calls(self, show_id: str, start: str | None = None, end: str | None = None) -> list[Call]:
        """Calls in date order, optionally only those from start through end (YYYY-MM-DD)."""
        pk = keys.show_pointer(show_id)["PK"]
        if start is None and end is None:
            items = self._query_all(pk, keys.CALL_PREFIX)
        else:
            items = self._query_between(pk, f"CALL#{start or ''}", f"CALL#{end or '9999'}#~")
        return [Call.model_validate(i) for i in items]

    def _query_between(self, pk: str, low: str, high: str) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "TableName": self.table,
            "KeyConditionExpression": "PK = :pk AND SK BETWEEN :lo AND :hi",
            "ExpressionAttributeValues": {":pk": {"S": pk}, ":lo": {"S": low}, ":hi": {"S": high}},
        }
        items: list[dict[str, Any]] = []
        while True:
            res = self.db.query(**params)
            items.extend(_from_ddb(item) for item in res.get("Items", []))
            if "LastEvaluatedKey" not in res:
                return items
            params["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def get_call(self, show_id: str, date: str, call_id: str) -> Call | None:
        item = self._get(keys.call(show_id, date, call_id))
        return Call.model_validate(item) if item else None

    def put_call(self, call: Call, previous_date: str | None = None) -> None:
        """Saves a call; moving it to another date moves its item, since the date is in the key."""
        if previous_date and previous_date != call.date:
            self.db.transact_write_items(
                TransactItems=[
                    {
                        "Delete": {
                            "TableName": self.table,
                            "Key": _to_ddb(keys.call(call.show_id, previous_date, call.call_id)),
                        }
                    },
                    self._tx_put(_item(keys.call(call.show_id, call.date, call.call_id), "call", call)),
                ]
            )
        else:
            self._put_item(keys.call(call.show_id, call.date, call.call_id), "call", call)

    def delete_call(self, show_id: str, date: str, call_id: str) -> None:
        self._delete(keys.call(show_id, date, call_id))

    def all_shows(self) -> list[Show]:
        """Every show in every company, for the hourly reminder job. A Scan, fine at this table's size."""
        params: dict[str, Any] = {
            "TableName": self.table,
            "FilterExpression": "#e = :show",
            "ExpressionAttributeNames": {"#e": "entity"},
            "ExpressionAttributeValues": {":show": {"S": "show"}},
        }
        out: list[Show] = []
        while True:
            res = self.db.scan(**params)
            out.extend(Show.model_validate(_from_ddb(i)) for i in res.get("Items", []))
            if "LastEvaluatedKey" not in res:
                return out
            params["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    # ---- callboard ----------------------------------------------------------------------------

    def put_notice(self, notice: Notice) -> None:
        self._put_item(keys.notice(notice.show_id, notice.notice_id), "notice", notice)

    def delete_notice(self, show_id: str, notice_id: str, reads: Iterable[NoticeRead]) -> None:
        self._batch_delete(
            [
                keys.notice(show_id, notice_id),
                *(keys.notice_read(show_id, notice_id, r.user_id) for r in reads),
            ]
        )

    def put_notice_read(self, read: NoticeRead) -> None:
        self._put_item(keys.notice_read(read.show_id, read.notice_id, read.user_id), "noticeRead", read)

    # ---- check-ins ----------------------------------------------------------------------------

    def list_checkins(self, show_id: str, date: str | None = None) -> list[CheckIn]:
        prefix = f"CHECKIN#{date}#" if date else keys.CHECKIN_PREFIX
        return [CheckIn.model_validate(i) for i in self._query_all(keys.show_pointer(show_id)["PK"], prefix)]

    def put_checkin(self, checkin: CheckIn) -> None:
        self._put_item(keys.checkin(checkin.show_id, checkin.date, checkin.user_id), "checkin", checkin)

    def delete_checkin(self, show_id: str, date: str, user_id: str) -> None:
        self._delete(keys.checkin(show_id, date, user_id))

    # ---- conflicts ----------------------------------------------------------------------------

    def get_conflicts(self, user_id: str) -> tuple[list[WeeklyConflict], list[DateConflict]]:
        weekly: list[WeeklyConflict] = []
        dates: list[DateConflict] = []
        for item in self._query_raw(keys.user(user_id)["PK"], keys.CONFLICT_PREFIX):
            data = {k: v for k, v in item.items() if k not in _KEY_ATTRS}
            if str(item["SK"]).startswith("CONFLICT#WEEKLY#"):
                weekly.append(WeeklyConflict.model_validate(data))
            else:
                dates.append(DateConflict.model_validate(data))
        weekly.sort(key=lambda w: w.weekday)
        dates.sort(key=lambda d: d.date)
        return weekly, dates

    def put_weekly_conflict(self, conflict: WeeklyConflict) -> None:
        self._put_item(keys.weekly_conflict(conflict.user_id, conflict.weekday), "weeklyConflict", conflict)

    def delete_weekly_conflict(self, user_id: str, weekday: int) -> None:
        self._delete(keys.weekly_conflict(user_id, weekday))

    def put_date_conflict(self, conflict: DateConflict) -> None:
        self._put_item(keys.date_conflict(conflict.user_id, conflict.date), "dateConflict", conflict)

    def delete_date_conflict(self, user_id: str, date: str) -> None:
        self._delete(keys.date_conflict(user_id, date))

    # ---- magic links --------------------------------------------------------------------------

    def get_magic_link(self, email: str) -> MagicLinkRecord | None:
        item = self._get(keys.magic_link(email))
        return MagicLinkRecord.model_validate(item) if item else None

    def put_magic_link(self, record: MagicLinkRecord) -> None:
        record = record.model_copy(update={"email": keys.normalize_email(record.email)})
        self._put_item(keys.magic_link(record.email), "magicLink", record)

    def consume_magic_link(self, email: str, code_hash: str) -> bool:
        """Deletes the record only if it still holds this hash, so a code can be redeemed once."""
        try:
            self.db.delete_item(
                TableName=self.table,
                Key=_to_ddb(keys.magic_link(email)),
                ConditionExpression="codeHash = :hash",
                ExpressionAttributeValues={":hash": {"S": code_hash}},
            )
            return True
        except self.db.exceptions.ConditionalCheckFailedException:
            return False


# The app and Lambdas depend on this name; tests run it against moto's DynamoDB.
Store = DynamoStore
