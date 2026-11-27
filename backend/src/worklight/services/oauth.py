"""Sign in to Worklight from an app such as Claude (OAuth 2.1 with PKCE, as MCP expects).

Worklight is its own authorization server for /mcp. An app registers itself (dynamic client registration),
sends the person to /connect in the web app, where they sign in as usual and allow it, and then swaps the
one-time code for tokens. Each approval becomes a "connection": an ApiKeyRecord of kind "connection" under
the person, whose secret is the current refresh token. Access tokens last an hour; refresh tokens rotate on
every use and stop working when the person disconnects the app in Account.

A connection acts as the person, with exactly what they can do in the app: the services check their role
in each show, as they do for the web app.
"""

import base64
import hashlib
from typing import Annotated, Any
from urllib.parse import urlencode, urlsplit

from pydantic import Field

from worklight import clock
from worklight.ids import new_id, new_token, now_iso, sha256
from worklight.models import ApiKeyRecord, Model, OAuthClient, OAuthCode, OAuthToken, User
from worklight.services.base import Ctx, Invalid, ServiceError, text

ACCESS_PREFIX = "wla_"
REFRESH_PREFIX = "wlr_"
ACCESS_TTL = 3600
CODE_TTL = 300
# Apps one person can have connected at once.
MAX_CONNECTIONS = 20
MAX_REDIRECT_URIS = 5


class OAuthError(ServiceError):
    """An error in the shape OAuth clients expect: {"error": code, "error_description": message}."""

    status = 400

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _now() -> int:
    return int(clock.now().timestamp())


def _origin(ctx: Ctx) -> str:
    return ctx.app_url.rstrip("/")


def resource_url(ctx: Ctx) -> str:
    return f"{_origin(ctx)}/mcp"


def protected_resource_metadata(ctx: Ctx) -> dict[str, Any]:
    return {
        "resource": resource_url(ctx),
        "authorization_servers": [_origin(ctx)],
        "bearer_methods_supported": ["header"],
        "resource_name": "Worklight",
    }


def authorization_server_metadata(ctx: Ctx) -> dict[str, Any]:
    origin = _origin(ctx)
    return {
        "issuer": origin,
        "authorization_endpoint": f"{origin}/connect",
        "token_endpoint": f"{origin}/oauth/token",
        "registration_endpoint": f"{origin}/oauth/register",
        "revocation_endpoint": f"{origin}/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["worklight"],
    }


# ---- registration ------------------------------------------------------------------------------


def _redirect_ok(uri: str) -> bool:
    parts = urlsplit(uri)
    if parts.fragment or not parts.netloc:
        return False
    if parts.scheme == "https":
        return True
    # Desktop apps and local tools listen on a loopback port.
    return parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1", "::1")


class RegisterBody(Model):
    client_name: Annotated[str, text(80)] = "An app"
    redirect_uris: Annotated[list[str], Field(min_length=1, max_length=MAX_REDIRECT_URIS)]


def register_client(ctx: Ctx, raw: dict[str, Any]) -> dict[str, Any]:
    # OAuth clients send snake_case, so read the fields by name rather than through the camelCase aliases.
    try:
        body = RegisterBody.model_validate(
            {"clientName": raw.get("client_name") or "An app", "redirectUris": raw.get("redirect_uris")}
        )
    except ValueError as err:
        raise OAuthError("invalid_client_metadata", "client_name and redirect_uris are required") from err
    if not all(isinstance(u, str) and _redirect_ok(u) for u in body.redirect_uris):
        raise OAuthError("invalid_redirect_uri", "Redirect URIs must be https, or http on localhost")
    client = OAuthClient(
        client_id=new_id(),
        client_name=body.client_name.strip() or "An app",
        redirect_uris=body.redirect_uris,
        created_at=now_iso(),
    )
    ctx.store.put_oauth_client(client)
    return {
        "client_id": client.client_id,
        "client_name": client.client_name,
        "redirect_uris": client.redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "client_id_issued_at": _now(),
    }


# ---- the consent screen ------------------------------------------------------------------------


class AuthorizeRequest(Model):
    """What the app asked for, as the /connect page received it in its address."""

    client_id: str
    redirect_uri: str
    response_type: str = "code"
    code_challenge: str = ""
    code_challenge_method: str = ""
    state: str | None = None
    resource: str | None = None
    scope: str | None = None


class ConnectInfo(Model):
    """What the /connect page shows: who is asking, and where they'll go back to."""

    client_name: str
    redirect_host: str


class AuthorizeBody(AuthorizeRequest):
    approve: bool


class AuthorizeResult(Model):
    # Where to send the browser next: back to the app, with a code or an error.
    redirect_to: str


def _checked(ctx: Ctx, req: AuthorizeRequest) -> OAuthClient:
    """Problems here can't be sent back to the app (the redirect itself may be wrong), so they're shown."""
    client = ctx.store.get_oauth_client(req.client_id)
    if not client:
        raise Invalid("This app isn't registered with Worklight. Try connecting again from the app.")
    if req.redirect_uri not in client.redirect_uris:
        raise Invalid("This sign-in link doesn't match the app. Try connecting again from the app.")
    return client


def _problem(ctx: Ctx, req: AuthorizeRequest) -> tuple[str, str] | None:
    """Problems that go back to the app as an OAuth error on its redirect."""
    if req.response_type != "code":
        return "unsupported_response_type", "Only response_type=code is supported"
    if not req.code_challenge or req.code_challenge_method != "S256":
        return "invalid_request", "PKCE with code_challenge_method=S256 is required"
    if req.resource and req.resource.rstrip("/") not in (resource_url(ctx), _origin(ctx)):
        return "invalid_target", "Worklight can only sign apps in to its own MCP server"
    return None


def _back(req: AuthorizeRequest, params: dict[str, str]) -> str:
    if req.state is not None:
        params["state"] = req.state
    sep = "&" if "?" in req.redirect_uri else "?"
    return f"{req.redirect_uri}{sep}{urlencode(params)}"


def connect_info(ctx: Ctx, user: User, req: AuthorizeRequest) -> ConnectInfo:
    client = _checked(ctx, req)
    return ConnectInfo(client_name=client.client_name, redirect_host=urlsplit(req.redirect_uri).netloc)


def authorize(ctx: Ctx, user: User, body: AuthorizeBody) -> AuthorizeResult:
    _checked(ctx, body)
    issuer = {"iss": _origin(ctx)}
    problem = _problem(ctx, body)
    if problem:
        return AuthorizeResult(
            redirect_to=_back(body, {"error": problem[0], "error_description": problem[1]})
        )
    if not body.approve:
        return AuthorizeResult(
            redirect_to=_back(body, {"error": "access_denied", "error_description": "Not allowed", **issuer})
        )
    code = new_token()
    ctx.store.put_oauth_code(
        OAuthCode(
            code_hash=sha256(code),
            client_id=body.client_id,
            user_id=user.user_id,
            redirect_uri=body.redirect_uri,
            code_challenge=body.code_challenge,
            expires_at=_now() + CODE_TTL,
        )
    )
    return AuthorizeResult(redirect_to=_back(body, {"code": code, **issuer}))


# ---- tokens ------------------------------------------------------------------------------------


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _issue(ctx: Ctx, record: ApiKeyRecord, refresh: str) -> dict[str, Any]:
    access = ACCESS_PREFIX + new_token()
    ctx.store.put_oauth_token(
        OAuthToken(
            token_hash=sha256(access),
            user_id=record.created_by,
            key_id=record.key_id,
            expires_at=_now() + ACCESS_TTL,
        )
    )
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TTL,
        "refresh_token": refresh,
        "scope": "worklight",
    }


def token(ctx: Ctx, form: dict[str, str]) -> dict[str, Any]:
    grant = form.get("grant_type")
    if grant == "authorization_code":
        return _from_code(ctx, form)
    if grant == "refresh_token":
        return _from_refresh(ctx, form)
    raise OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token")


def _from_code(ctx: Ctx, form: dict[str, str]) -> dict[str, Any]:
    code, verifier = form.get("code", ""), form.get("code_verifier", "")
    found = ctx.store.take_oauth_code(sha256(code)) if code else None
    bad = OAuthError("invalid_grant", "That code isn't valid. It may have expired or been used.")
    if not found or found.expires_at < _now():
        raise bad
    if form.get("client_id") != found.client_id or form.get("redirect_uri") != found.redirect_uri:
        raise bad
    if not verifier or _s256(verifier) != found.code_challenge:
        raise OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge")
    client = ctx.store.get_oauth_client(found.client_id)
    user = ctx.store.get_user(found.user_id)
    if not client or not user:
        raise bad
    mine = [k for k in ctx.store.list_personal_api_keys(user.user_id) if k.kind == "connection"]
    if len(mine) >= MAX_CONNECTIONS:
        # Make room by dropping the connection used longest ago.
        oldest = min(mine, key=lambda k: k.last_used_at or k.created_at)
        ctx.store.delete_api_key(oldest)
    refresh = REFRESH_PREFIX + new_token()
    record = ApiKeyRecord(
        key_id=new_id(),
        kind="connection",
        name=client.client_name,
        # Acts as the person: the services check what they can do in each show.
        scope="write",
        prefix=client.client_id,
        created_by=user.user_id,
        created_at=now_iso(),
        last_used_at=now_iso(),
        secret_hash=sha256(refresh),
    )
    ctx.store.put_api_key(record)
    return _issue(ctx, record, refresh)


def _from_refresh(ctx: Ctx, form: dict[str, str]) -> dict[str, Any]:
    refresh = form.get("refresh_token", "")
    bad = OAuthError("invalid_grant", "That sign-in has ended. Connect the app again.")
    if not refresh.startswith(REFRESH_PREFIX):
        raise bad
    record = ctx.store.get_api_key_by_secret(sha256(refresh))
    if not record or record.kind != "connection" or not ctx.store.get_user(record.created_by):
        raise bad
    if form.get("client_id") and form.get("client_id") != record.prefix:
        raise bad
    new_refresh = REFRESH_PREFIX + new_token()
    if not ctx.store.rotate_api_key_secret(record, sha256(new_refresh)):
        raise bad
    return _issue(ctx, record.model_copy(update={"secret_hash": sha256(new_refresh)}), new_refresh)


def revoke(ctx: Ctx, form: dict[str, str]) -> None:
    """RFC 7009: ends the connection a refresh token belongs to. Unknown tokens are not an error."""
    value = form.get("token", "")
    if value.startswith(REFRESH_PREFIX):
        record = ctx.store.get_api_key_by_secret(sha256(value))
        if record and record.kind == "connection":
            ctx.store.delete_api_key(record)
    elif value.startswith(ACCESS_PREFIX):
        found = ctx.store.get_oauth_token(sha256(value))
        if found:
            record = ctx.store.get_personal_api_key(found.user_id, found.key_id)
            if record and record.kind == "connection":
                ctx.store.delete_api_key(record)


def connection_for_access_token(ctx: Ctx, value: str) -> ApiKeyRecord | None:
    """The live connection behind an access token, or None if it expired or was disconnected."""
    found = ctx.store.get_oauth_token(sha256(value))
    if not found or found.expires_at < _now():
        return None
    item = ctx.store.get_personal_api_key(found.user_id, found.key_id)
    return item if item and item.kind == "connection" else None
