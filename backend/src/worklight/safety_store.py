"""Emergency contacts, medical notes and the view log, in a DynamoDB table of their own.

Only the API function is granted this table, so the reminder job, sign-in triggers and anything else that
reads the main table never can. Layout:

USER#<id>  SAFETY                                   the person's safety info
USER#<id>  VIEW#<date>#<showId>#<viewerId>#<view>   one staff member's look that day (TTL: a year)
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any

import boto3

from worklight.models import SafetyAccess, SafetyInfo
from worklight.store import _chunks, _from_ddb, _to_ddb

if TYPE_CHECKING:
    from mypy_boto3_dynamodb.client import DynamoDBClient


def _info_key(user_id: str) -> dict[str, str]:
    return {"PK": f"USER#{user_id}", "SK": "SAFETY"}


def _view_key(a: SafetyAccess) -> dict[str, str]:
    return {"PK": f"USER#{a.user_id}", "SK": f"VIEW#{a.at[:10]}#{a.show_id}#{a.viewer_id}#{a.view}"}


class SafetyStore:
    def __init__(self, table: str, client: DynamoDBClient | None = None) -> None:
        self.table = table
        self.db: DynamoDBClient = client or boto3.client("dynamodb")

    def get(self, user_id: str) -> SafetyInfo | None:
        item = self.db.get_item(TableName=self.table, Key=_to_ddb(_info_key(user_id))).get("Item")
        return SafetyInfo.model_validate(_from_ddb(item)) if item else None

    def get_many(self, user_ids: Iterable[str]) -> dict[str, SafetyInfo]:
        ids = sorted(set(user_ids))
        out: dict[str, SafetyInfo] = {}
        for chunk in _chunks(ids, 100):
            request: Any = {self.table: {"Keys": [_to_ddb(_info_key(u)) for u in chunk]}}
            while request:
                res = self.db.batch_get_item(RequestItems=request)
                for item in res.get("Responses", {}).get(self.table, []):
                    info = SafetyInfo.model_validate(_from_ddb(item))
                    out[info.user_id] = info
                request = res.get("UnprocessedKeys") or None
        return out

    def put(self, info: SafetyInfo) -> None:
        self.db.put_item(TableName=self.table, Item=_to_ddb({**_info_key(info.user_id), **info.to_item()}))

    def delete(self, user_id: str) -> None:
        self.db.delete_item(TableName=self.table, Key=_to_ddb(_info_key(user_id)))

    def log_views(self, views: list[SafetyAccess]) -> None:
        """Same viewer, person, show and kind on one day overwrite each other, keeping the latest time."""
        for chunk in _chunks(views, 25):
            request: Any = {
                self.table: [
                    {"PutRequest": {"Item": _to_ddb({**_view_key(v), **v.to_item()})}} for v in chunk
                ]
            }
            while request:
                request = self.db.batch_write_item(RequestItems=request).get("UnprocessedItems") or None

    def list_views(self, user_id: str, limit: int = 200) -> list[SafetyAccess]:
        res = self.db.query(
            TableName=self.table,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}, ":sk": {"S": "VIEW#"}},
            ScanIndexForward=False,
            Limit=limit,
        )
        views = [SafetyAccess.model_validate(_from_ddb(i)) for i in res.get("Items", [])]
        return sorted(views, key=lambda v: v.at, reverse=True)


def create_safety_table(client: DynamoDBClient, name: str = "worklight-safety") -> None:
    """The same shape the stack deploys. Used by tests and the dev server."""
    client.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("PK", "SK")],
    )
