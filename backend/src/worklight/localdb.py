"""Creates the app's table with the same shape the CDK stack deploys. Used by tests and the dev server,
both of which run against moto's in-memory DynamoDB."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_dynamodb.client import DynamoDBClient


def create_table(client: DynamoDBClient, name: str = "worklight") -> None:
    client.create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": n, "AttributeType": "S"} for n in ("PK", "SK", "GSI1PK", "GSI1SK")
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "GSI1",
                "KeySchema": [
                    {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )
