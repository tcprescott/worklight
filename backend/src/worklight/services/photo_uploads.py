"""Storing uploaded photos and turning stored photo ids into links."""

import contextlib

from worklight.models import Model
from worklight.photos import MAX_BYTES, MAX_PER_RECORD, PhotoStore, is_photo_id, key_for, new_photo_id, sniff
from worklight.services.base import Ctx, Invalid, ServiceError


class Photo(Model):
    photo_id: str
    url: str


class PhotosOff(ServiceError):
    status = 503


def _store(ctx: Ctx) -> PhotoStore:
    if ctx.photos is None:
        raise PhotosOff("Photo uploads aren't set up on this server")
    return ctx.photos


def save_photo(ctx: Ctx, theater_id: str, data: bytes) -> Photo:
    """Stores one picture for the company and returns its id and a link to it."""
    if not data:
        raise Invalid("Send the picture as the request body")
    if len(data) > MAX_BYTES:
        raise Invalid("That picture is too big. Pictures can be up to 4 MB.")
    kind = sniff(data)
    if not kind:
        raise Invalid("Pictures have to be JPEG, PNG or WebP")
    content_type, ext = kind
    photo_id = new_photo_id(ext)
    store = _store(ctx)
    store.put(key_for(theater_id, photo_id), data, content_type)
    return Photo(photo_id=photo_id, url=store.url(key_for(theater_id, photo_id)))


def photo_views(ctx: Ctx, theater_id: str, photo_ids: list[str]) -> list[Photo]:
    if ctx.photos is None:
        return []
    return [Photo(photo_id=p, url=ctx.photos.url(key_for(theater_id, p))) for p in photo_ids]


def check_photo_ids(photo_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(photo_ids))
    if len(ids) > MAX_PER_RECORD:
        raise Invalid(f"Keep it to {MAX_PER_RECORD} pictures")
    if any(not is_photo_id(p) for p in ids):
        raise Invalid("photoIds has a picture that wasn't uploaded here")
    return ids


def drop_photos(ctx: Ctx, theater_id: str, photo_ids: list[str]) -> None:
    """Deletes pictures nothing uses any more. Best effort: a leftover picture only costs a little storage."""
    if ctx.photos is None or not photo_ids:
        return
    with contextlib.suppress(Exception):
        ctx.photos.delete([key_for(theater_id, p) for p in photo_ids])
