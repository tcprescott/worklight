from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any, Protocol

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

from worklight import keys
from worklight.models import Invite, MagicLinkRecord, Membership, Model, Show, Theater, User

if TYPE_CHECKING:
    from mypy_boto3_dynamodb.client import DynamoDBClient


class Store(Protocol):
    """Everything the API reads and writes. Lambdas use DynamoStore; tests use an in-memory fake."""

    def get_user(self, user_id: str) -> User | None: ...
    def get_user_id_by_email(self, email: str) -> str | None: ...
    def create_user(self, user: User) -> str:
        """Creates the user and its email mapping. Returns the existing userId if the email is mapped."""
        ...

    def update_user_name(self, user_id: str, name: str) -> None: ...
    def get_users(self, user_ids: Iterable[str]) -> list[User]: ...

    def create_theater(self, theater: Theater, admin_user_id: str) -> None: ...
    def get_theater(self, theater_id: str) -> Theater | None: ...
    def list_admin_theater_ids(self, user_id: str) -> list[str]: ...
    def is_theater_admin(self, theater_id: str, user_id: str) -> bool: ...

    def create_show(self, show: Show, creator: Membership) -> None: ...
    def get_show(self, show_id: str) -> Show | None: ...
    def get_shows(self, refs: Iterable[tuple[str, str]]) -> list[Show]:
        """refs are (theaterId, showId) pairs."""
        ...

    def list_memberships(self, user_id: str) -> list[Membership]: ...
    def get_membership(self, show_id: str, user_id: str) -> Membership | None: ...
    def list_members(self, show_id: str) -> list[Membership]: ...

    def put_invite(self, invite: Invite) -> None: ...
    def get_invite(self, token: str) -> Invite | None: ...
    def accept_invite(self, invite: Invite, membership: Membership) -> None:
        """Adds the membership and deletes the invite in one transaction."""
        ...

    def get_magic_link(self, email: str) -> MagicLinkRecord | None: ...
    def put_magic_link(self, record: MagicLinkRecord) -> None: ...
    def consume_magic_link(self, email: str, code_hash: str) -> bool:
        """Deletes the record only if it still holds this hash, so a code can be redeemed once."""
        ...


_KEY_ATTRS = ("PK", "SK", "GSI1PK", "GSI1SK", "type")
_serializer = TypeSerializer()
_deserializer = TypeDeserializer()


def _to_ddb(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _serializer.serialize(v) for k, v in item.items()}


def _from_ddb(item: dict[str, Any]) -> dict[str, Any]:
    return {k: _deserializer.deserialize(v) for k, v in item.items() if k not in _KEY_ATTRS}


def _item(key: keys.Key, kind: str, record: Model) -> dict[str, Any]:
    return {**key, "type": kind, **record.to_item()}


def _chunks[T](items: list[T], size: int) -> Iterable[list[T]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


class DynamoStore:
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

    def _query_all(self, pk: str, sk_prefix: str, index: str | None = None) -> list[dict[str, Any]]:
        pk_name, sk_name = ("GSI1PK", "GSI1SK") if index else ("PK", "SK")
        params: dict[str, Any] = {
            "TableName": self.table,
            "KeyConditionExpression": "#pk = :pk AND begins_with(#sk, :sk)",
            "ExpressionAttributeNames": {"#pk": pk_name, "#sk": sk_name},
            "ExpressionAttributeValues": {":pk": {"S": pk}, ":sk": {"S": sk_prefix}},
        }
        if index:
            params["IndexName"] = index
        items: list[dict[str, Any]] = []
        while True:
            res = self.db.query(**params)
            items.extend(_from_ddb(item) for item in res.get("Items", []))
            if "LastEvaluatedKey" not in res:
                return items
            params["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    # ---- users --------------------------------------------------------------------------------

    def get_user(self, user_id: str) -> User | None:
        item = self._get(keys.user(user_id))
        return User.model_validate(item) if item else None

    def get_user_id_by_email(self, email: str) -> str | None:
        item = self._get(keys.email(email))
        return str(item["userId"]) if item else None

    def create_user(self, user: User) -> str:
        user = user.model_copy(update={"email": keys.normalize_email(user.email)})
        try:
            self.db.transact_write_items(
                TransactItems=[
                    self._tx_put(
                        {**keys.email(user.email), "type": "email", "userId": user.user_id}, new=True
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

    def get_users(self, user_ids: Iterable[str]) -> list[User]:
        return [
            User.model_validate(i) for i in self._batch_get([keys.user(u) for u in dict.fromkeys(user_ids)])
        ]

    # ---- theaters -----------------------------------------------------------------------------

    def create_theater(self, theater: Theater, admin_user_id: str) -> None:
        admin = {
            **keys.theater_admin(theater.theater_id, admin_user_id),
            "type": "theaterAdmin",
            "theaterId": theater.theater_id,
            "userId": admin_user_id,
        }
        self.db.transact_write_items(
            TransactItems=[
                self._tx_put(_item(keys.theater(theater.theater_id), "theater", theater), new=True),
                self._tx_put(admin),
            ]
        )

    def get_theater(self, theater_id: str) -> Theater | None:
        item = self._get(keys.theater(theater_id))
        return Theater.model_validate(item) if item else None

    def list_admin_theater_ids(self, user_id: str) -> list[str]:
        items = self._query_all(keys.user_gsi(user_id), keys.THEATER_PREFIX, index="GSI1")
        return [str(i["theaterId"]) for i in items]

    def is_theater_admin(self, theater_id: str, user_id: str) -> bool:
        return self._get(keys.theater_admin(theater_id, user_id)) is not None

    # ---- shows --------------------------------------------------------------------------------

    def create_show(self, show: Show, creator: Membership) -> None:
        pointer = {
            **keys.show_pointer(show.show_id),
            "type": "showPointer",
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

    def get_show(self, show_id: str) -> Show | None:
        pointer = self._get(keys.show_pointer(show_id))
        if not pointer:
            return None
        item = self._get(keys.show(str(pointer["theaterId"]), show_id))
        return Show.model_validate(item) if item else None

    def get_shows(self, refs: Iterable[tuple[str, str]]) -> list[Show]:
        return [Show.model_validate(i) for i in self._batch_get([keys.show(t, s) for t, s in refs])]

    def list_memberships(self, user_id: str) -> list[Membership]:
        items = self._query_all(keys.user_gsi(user_id), keys.SHOW_PREFIX, index="GSI1")
        return [Membership.model_validate(i) for i in items]

    def get_membership(self, show_id: str, user_id: str) -> Membership | None:
        item = self._get(keys.member(show_id, user_id))
        return Membership.model_validate(item) if item else None

    def list_members(self, show_id: str) -> list[Membership]:
        items = self._query_all(keys.show_pointer(show_id)["PK"], keys.MEMBER_PREFIX)
        return [Membership.model_validate(i) for i in items]

    # ---- invites ------------------------------------------------------------------------------

    def put_invite(self, invite: Invite) -> None:
        self.db.put_item(**self._put(_item(keys.invite(invite.token), "invite", invite)))

    def get_invite(self, token: str) -> Invite | None:
        item = self._get(keys.invite(token))
        return Invite.model_validate(item) if item else None

    def accept_invite(self, invite: Invite, membership: Membership) -> None:
        self.db.transact_write_items(
            TransactItems=[
                {
                    "Delete": {
                        "TableName": self.table,
                        "Key": _to_ddb(keys.invite(invite.token)),
                        "ConditionExpression": "attribute_exists(PK)",
                    }
                },
                self._tx_put(
                    _item(keys.member(membership.show_id, membership.user_id), "member", membership)
                ),
            ]
        )

    # ---- magic links --------------------------------------------------------------------------

    def get_magic_link(self, email: str) -> MagicLinkRecord | None:
        item = self._get(keys.magic_link(email))
        return MagicLinkRecord.model_validate(item) if item else None

    def put_magic_link(self, record: MagicLinkRecord) -> None:
        record = record.model_copy(update={"email": keys.normalize_email(record.email)})
        self.db.put_item(**self._put(_item(keys.magic_link(record.email), "magicLink", record)))

    def consume_magic_link(self, email: str, code_hash: str) -> bool:
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
