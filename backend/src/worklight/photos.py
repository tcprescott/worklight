"""Photos of costumes, props and costume ideas.

The browser shrinks a picture to a JPEG of at most a few hundred KB before sending it, and the API stores it.
Pictures are private: the API hands out short-lived links to them, and only to people who can see the record
the photo is on. Keys look like photos/<theaterId>/<photoId>.jpg."""

import re
from typing import Any, Protocol

from worklight.ids import new_id

MAX_BYTES = 4 * 1024 * 1024
# Most a record keeps, so a list of items stays quick to load.
MAX_PER_RECORD = 6

_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_TYPES = {
    b"\xff\xd8\xff": ("image/jpeg", "jpg"),
    b"\x89PNG": ("image/png", "png"),
}


class PhotoStore(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def url(self, key: str) -> str: ...

    def delete(self, keys: list[str]) -> None: ...


def sniff(data: bytes) -> tuple[str, str] | None:
    """(content type, extension) for a JPEG, PNG or WebP picture; None for anything else."""
    for magic, kind in _TYPES.items():
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("image/webp", "webp")
    return None


def new_photo_id(ext: str) -> str:
    return f"{new_id()}.{ext}"


def is_photo_id(value: str) -> bool:
    stem, _, ext = value.partition(".")
    return bool(_ID.match(stem)) and ext in ("jpg", "png", "webp")


def key_for(theater_id: str, photo_id: str) -> str:
    return f"photos/{theater_id}/{photo_id}"


class S3Photos:
    """Photos in a private S3 bucket, shown through presigned links that last a few hours."""

    def __init__(self, bucket: str, client: Any = None) -> None:
        import boto3

        self.bucket = bucket
        self.s3: Any = client or boto3.client("s3")

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="private, max-age=86400",
        )

    def url(self, key: str) -> str:
        return str(
            self.s3.generate_presigned_url(
                "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=6 * 3600
            )
        )

    def delete(self, keys: list[str]) -> None:
        for start in range(0, len(keys), 1000):
            group = keys[start : start + 1000]
            if group:
                self.s3.delete_objects(
                    Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in group], "Quiet": True}
                )


class MemoryPhotos:
    """For tests and the local dev server: photos kept in memory, served by the dev server."""

    def __init__(self, base_url: str = "/api/dev/photos") -> None:
        self.base_url = base_url
        self.files: dict[str, tuple[bytes, str]] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.files[key] = (data, content_type)

    def url(self, key: str) -> str:
        return f"{self.base_url}/{key}"

    def delete(self, keys: list[str]) -> None:
        for k in keys:
            self.files.pop(k, None)
