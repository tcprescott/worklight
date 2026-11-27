"""API keys for the public REST (/api/v1), GraphQL (/api/graphql) and MCP (/mcp) APIs.

A company key belongs to one company and acts as the admin who created it, limited to that company's shows.
Read keys can only read. The secret is shown once; only its SHA-256 is stored. People connect apps such as
Claude by signing in instead (see worklight.services.oauth); those connections are listed and removed here."""

from dataclasses import dataclass
from typing import Annotated

from worklight import clock
from worklight.ids import new_id, new_token, now_iso, sha256
from worklight.models import ApiKey, ApiKeyRecord, ApiKeyScope, Model, Show, User
from worklight.services.base import (
    Ctx,
    Forbidden,
    NotFound,
    ServiceError,
    Unauthorized,
    show_access,
    text,
)

SECRET_PREFIX = "wl_"
# Requests per key per minute.
RATE_LIMIT = 120


class TooManyRequests(ServiceError):
    status = 429


def _require_admin(ctx: Ctx, theater_id: str, user: User) -> None:
    if not ctx.store.get_theater(theater_id):
        raise NotFound("Company not found")
    if not ctx.store.is_theater_admin(theater_id, user.user_id):
        raise Forbidden("Only company admins can manage API keys")


class CreateApiKeyBody(Model):
    name: Annotated[str, text(80)]
    scope: ApiKeyScope = "read"


class NewApiKey(Model):
    key: ApiKey
    # The secret, shown this once.
    secret: str


def list_keys(ctx: Ctx, user: User, theater_id: str) -> list[ApiKey]:
    _require_admin(ctx, theater_id, user)
    found = ctx.store.list_api_keys(theater_id)
    return [ApiKey.model_validate(k.model_dump(exclude={"secret_hash"})) for k in found]


def create_key(ctx: Ctx, user: User, theater_id: str, body: CreateApiKeyBody) -> NewApiKey:
    _require_admin(ctx, theater_id, user)
    secret = SECRET_PREFIX + new_token()
    record = ApiKeyRecord(
        key_id=new_id(),
        theater_id=theater_id,
        name=body.name,
        scope=body.scope,
        prefix=secret[:10],
        created_by=user.user_id,
        created_at=now_iso(),
        secret_hash=sha256(secret),
    )
    ctx.store.put_api_key(record)
    return NewApiKey(key=ApiKey.model_validate(record.model_dump(exclude={"secret_hash"})), secret=secret)


def revoke_key(ctx: Ctx, user: User, theater_id: str, key_id: str) -> None:
    _require_admin(ctx, theater_id, user)
    record = next((k for k in ctx.store.list_api_keys(theater_id) if k.key_id == key_id), None)
    if not record:
        raise NotFound("API key not found")
    ctx.store.delete_api_key(record)


def list_connections(ctx: Ctx, user: User) -> list[ApiKey]:
    """Apps signed in as this person."""
    found = ctx.store.list_connections(user.user_id)
    return [ApiKey.model_validate(k.model_dump(exclude={"secret_hash"})) for k in found]


def disconnect(ctx: Ctx, user: User, key_id: str) -> None:
    record = ctx.store.get_connection(user.user_id, key_id)
    if not record:
        raise NotFound("That app isn't connected")
    ctx.store.delete_api_key(record)


@dataclass(frozen=True)
class KeyPrincipal:
    """Who an API request is: the key, and the admin it acts as."""

    key: ApiKeyRecord
    user: User

    @property
    def can_write(self) -> bool:
        # A signed-in app may try anything its person can; the services check their role in the show.
        return self.key.kind in ("company", "connection") and self.key.scope == "write"

    @property
    def personal(self) -> bool:
        """Acts as one person across their own shows (an app they signed in to)."""
        return self.key.kind != "company"

    def require_write(self) -> None:
        if not self.can_write:
            raise Forbidden("This API key can only read. Make a read and write key to change things.")

    def show(self, ctx: Ctx, show_id: str) -> Show:
        """The show, if reachable: in the key's company, or (a signed-in app) one its person is in."""
        show = ctx.store.get_show(show_id)
        if self.personal:
            if not show or show_access(ctx, show_id, self.user).role is None:
                raise NotFound("Show not found")
            return show
        if not show or show.theater_id != self.key.theater_id:
            raise NotFound("Show not found")
        return show

    def theater(self, theater_id: str) -> None:
        if self.personal or theater_id != self.key.theater_id:
            raise NotFound("Company not found")


def principal_for(ctx: Ctx, authorization: str | None) -> KeyPrincipal:
    """Checks an Authorization: Bearer header (an API key, or a signed-in app's access token), counts the
    request, and returns who it is."""
    from worklight.services import oauth

    scheme, _, secret = (authorization or "").partition(" ")
    secret = secret.strip()
    if scheme.lower() != "bearer" or not secret.startswith((SECRET_PREFIX, oauth.ACCESS_PREFIX)):
        raise Unauthorized("Sign in with Worklight, or send an API key as Authorization: Bearer wl_...")
    if secret.startswith(oauth.ACCESS_PREFIX):
        record = oauth.connection_for_access_token(ctx, secret)
        if not record:
            raise Unauthorized("That sign-in has expired or was disconnected. Sign in again.")
    else:
        record = ctx.store.get_api_key_by_secret(sha256(secret))
    # A connection's stored secret is its refresh token, which only works at /oauth/token.
    if not record or (record.kind == "connection" and not secret.startswith(oauth.ACCESS_PREFIX)):
        raise Unauthorized("That API key isn't valid. It may have been revoked.")
    user = ctx.store.get_user(record.created_by)
    if not user:
        raise Unauthorized("That API key isn't valid. It may have been revoked.")
    # A company key stops working if the admin who made it is no longer an admin.
    if record.kind == "company" and not ctx.store.is_theater_admin(str(record.theater_id), user.user_id):
        raise Unauthorized("That API key's owner is no longer a company admin. Make a new key.")
    now = int(clock.now().timestamp())
    minute = now // 60
    if ctx.store.count_request(record.key_id, minute, expires_at=(minute + 2) * 60) > RATE_LIMIT:
        raise TooManyRequests(f"Slow down: at most {RATE_LIMIT} requests a minute per key")
    if not record.last_used_at or record.last_used_at[:13] != now_iso()[:13]:
        # Recorded at most about hourly, to keep writes down.
        ctx.store.touch_api_key(record, now_iso())
    return KeyPrincipal(key=record, user=user)
