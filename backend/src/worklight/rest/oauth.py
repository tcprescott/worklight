"""Signing apps such as Claude in with a Worklight account. See worklight.services.oauth.

The discovery documents, registration, token and revocation endpoints are public (apps call them before
anyone has signed in). The two /api/oauth routes back the /connect page and need the person signed in.
"""

import json
from typing import Annotated, Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from worklight.models import User
from worklight.rest import UserDep
from worklight.services import oauth
from worklight.services.base import Ctx

_NO_STORE = {"cache-control": "no-store", "pragma": "no-cache"}


def _error(err: oauth.OAuthError) -> JSONResponse:
    return JSONResponse(
        {"error": err.code, "error_description": err.message}, status_code=err.status, headers=_NO_STORE
    )


async def _form(request: Request) -> dict[str, str]:
    raw = (await request.body()).decode(errors="replace")
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            data = json.loads(raw or "{}")
        except ValueError:
            return {}
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    return dict(parse_qsl(raw))


def public_router(ctx: Ctx) -> APIRouter:
    r = APIRouter(include_in_schema=False)

    @r.get("/.well-known/oauth-protected-resource")
    @r.get("/.well-known/oauth-protected-resource/mcp")
    def protected_resource() -> dict[str, Any]:
        return oauth.protected_resource_metadata(ctx)

    @r.get("/.well-known/oauth-authorization-server")
    @r.get("/.well-known/oauth-authorization-server/mcp")
    def authorization_server() -> dict[str, Any]:
        return oauth.authorization_server_metadata(ctx)

    @r.post("/oauth/register")
    async def register(request: Request) -> Response:
        try:
            raw = json.loads((await request.body()) or b"{}")
        except ValueError:
            raw = None
        if not isinstance(raw, dict):
            return _error(oauth.OAuthError("invalid_client_metadata", "Send the client metadata as JSON"))
        try:
            return JSONResponse(oauth.register_client(ctx, raw), status_code=201, headers=_NO_STORE)
        except oauth.OAuthError as err:
            return _error(err)

    @r.post("/oauth/token")
    async def token(request: Request) -> Response:
        try:
            return JSONResponse(oauth.token(ctx, await _form(request)), headers=_NO_STORE)
        except oauth.OAuthError as err:
            return _error(err)

    @r.post("/oauth/revoke")
    async def revoke(request: Request) -> Response:
        oauth.revoke(ctx, await _form(request))
        return Response(status_code=200, headers=_NO_STORE)

    return r


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base + "/oauth")
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.post("/connect-info", response_model=oauth.ConnectInfo)
    def connect_info(user: CurrentUser, body: oauth.AuthorizeRequest) -> oauth.ConnectInfo:
        return oauth.connect_info(ctx, user, body)

    @r.post("/authorize", response_model=oauth.AuthorizeResult)
    def authorize(user: CurrentUser, body: oauth.AuthorizeBody) -> oauth.AuthorizeResult:
        return oauth.authorize(ctx, user, body)

    return r
