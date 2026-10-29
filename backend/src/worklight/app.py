"""The Worklight HTTP API. One FastAPI app; Mangum adapts it to API Gateway in handlers/api.py.

Routes are thin: they parse input and call the service layer (worklight.services), which holds every
feature and permission check.
"""

import logging
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from worklight.models import User
from worklight.rest import apikeys, breakdown, conflicts, notify, people, schedule, shows, theaters
from worklight.services.accounts import user_from_claims
from worklight.services.apikeys import principal_for
from worklight.services.base import Ctx, Forbidden, ServiceError

log = logging.getLogger(__name__)

# Kept for the Lambda handler and scripts: the app's dependencies.
AppDeps = Ctx


def get_claims(request: Request) -> dict[str, Any]:
    """JWT claims API Gateway verified. Mangum passes the original Lambda event in the ASGI scope."""
    event = request.scope.get("aws.event") or {}
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return claims if isinstance(claims, dict) else {}


_ERRORS = {404: "Not found", 405: "Method not allowed"}

_LITERAL_MESSAGES = {
    "role": "role must be staff, cast or crew",
    "level": "level must be one of hard, soft or partial (or free for a date)",
}


def _validation_message(exc: RequestValidationError) -> str:
    first = exc.errors()[0]
    kind, loc, msg = first.get("type"), tuple(first.get("loc", ())), str(first.get("msg", "is invalid"))
    if kind == "json_invalid" or (
        kind in ("missing", "model_attributes_type", "dict_type") and loc == ("body",)
    ):
        return "Request body must be a JSON object"
    field = next((str(p) for p in reversed(loc) if isinstance(p, str)), "body")
    if kind == "value_error":
        msg = msg.removeprefix("Value error, ")
        # Cross-field checks run on the whole body and already name their fields.
        return msg if loc == ("body",) else f"{field} {msg}"
    if kind in ("missing", "string_too_short"):
        return f"{field} is required"
    if kind == "string_too_long":
        return f"{field} is too long"
    if kind == "literal_error" and field in _LITERAL_MESSAGES:
        return _LITERAL_MESSAGES[field]
    return f"{field}: {msg}"


def create_app(ctx: Ctx) -> FastAPI:
    app = FastAPI(
        title="Worklight API", version="1", docs_url=None, redoc_url=None, openapi_url="/api/openapi.json"
    )

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse({"error": exc.message}, status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) and exc.status_code not in _ERRORS else None
        return JSONResponse(
            {"error": message or _ERRORS.get(exc.status_code, "Request failed")},
            status_code=exc.status_code,
            headers={"cache-control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": _validation_message(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse({"error": "Something went wrong"}, status_code=500)

    @app.middleware("http")
    async def no_store(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers.setdefault("cache-control", "no-store")
        return response

    def current_user(claims: Annotated[dict[str, Any], Depends(get_claims)]) -> User:
        return user_from_claims(ctx, claims)

    for module in (theaters, shows, people, breakdown, conflicts, schedule, notify, apikeys):
        app.include_router(module.router(ctx, current_user))

    # The public REST API: the same routes under /api/v1, signed in with an API key instead of Cognito.
    # API Gateway sends /api/v1/* here without its JWT authorizer, so these never see Cognito claims.
    def key_user(request: Request) -> User:
        principal = principal_for(ctx, request.headers.get("authorization"))
        params = request.path_params
        if _PERSONAL_ROUTES & set(request.url.path.split("/")):
            raise Forbidden("That route is only for people signed in to the app")
        if "show_id" in params:
            principal.show(ctx, params["show_id"])
        elif "theater_id" in params:
            principal.theater(params["theater_id"])
        else:
            raise Forbidden("That route is only for people signed in to the app")
        if request.method not in ("GET", "HEAD"):
            principal.require_write()
        return principal.user

    for module in (theaters, shows, people, breakdown, conflicts, schedule, notify):
        app.include_router(module.router(ctx, key_user, base="/api/v1"), include_in_schema=False)

    from starlette.routing import Route

    from worklight.graphql_api import graphql_router
    from worklight.mcp_api import McpEndpoint

    app.include_router(graphql_router(ctx), prefix="/api/graphql", include_in_schema=False)
    app.router.routes.append(Route("/mcp", McpEndpoint(ctx), methods=["GET", "POST", "DELETE"]))
    return app


# Routes about the signed-in person, or that change who runs the company, are not open to API keys.
_PERSONAL_ROUTES = {"admins", "join", "check-in", "running-late", "door-code"}
