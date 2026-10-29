"""MCP at /mcp (stateless Streamable HTTP, JSON responses), signed in with an API key.

Lets an assistant read a company's shows, breakdowns, conflicts and schedule, suggest scenes for a night,
and (with a read and write key) build, publish and announce. Each HTTP request gets its own short-lived
session manager, so nothing has to outlive a Lambda invocation."""

import functools
import json
from collections.abc import Callable
from contextvars import ContextVar
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError
from starlette.types import Receive, Scope, Send

from worklight.models import Model
from worklight.services import breakdown as breakdown_service
from worklight.services import callboard as callboard_service
from worklight.services import conflicts as conflicts_service
from worklight.services import schedule as schedule_service
from worklight.services import shows as shows_service
from worklight.services import theaters as theaters_service
from worklight.services.apikeys import KeyPrincipal, principal_for
from worklight.services.base import Ctx, ServiceError

_principal: ContextVar[KeyPrincipal] = ContextVar("worklight_mcp_principal")

INSTRUCTIONS = (
    "Worklight schedules rehearsals for a community theater company. Dates are YYYY-MM-DD and times HH:MM in "
    "the show's timezone. Start with list_shows. Conflicts: hard means can't come, soft means would rather "
    "not, partial means arriving late or leaving early, elsewhere means another show has called them."
)


def _out(value: Any) -> str:
    """Tool results as compact JSON, camelCase like the REST API."""
    if isinstance(value, Model):
        data: Any = value.to_item()
    elif isinstance(value, list):
        data = [v.to_item() if isinstance(v, Model) else v for v in value]
    else:
        data = value
    return json.dumps(data, separators=(",", ":"))


def build_server(ctx: Ctx) -> MCPServer[Any]:
    mcp: MCPServer[Any] = MCPServer("Worklight", instructions=INSTRUCTIONS, version="1")

    class _Tools:
        """server.tool, with service errors and bad input passed to the model as plain messages."""

        def tool(self, description: str) -> Callable[[Callable[..., str]], Callable[..., str]]:
            def register(fn: Callable[..., str]) -> Callable[..., str]:
                @functools.wraps(fn)
                def wrapped(*args: Any, **kwargs: Any) -> str:
                    try:
                        return fn(*args, **kwargs)
                    except ServiceError as err:
                        raise ToolError(err.message) from err
                    except ValidationError as err:
                        raise ToolError(str(err)) from err

                mcp.tool(description=description)(wrapped)
                return fn

            return register

    server = _Tools()

    def who() -> KeyPrincipal:
        return _principal.get()

    def scoped(raw: str) -> str:
        return who().show(ctx, raw).show_id

    def write() -> KeyPrincipal:
        p = who()
        p.require_write()
        return p

    @server.tool(
        description="The company's shows with their dates, cast and crew counts, and who's still waiting"
    )
    def list_shows() -> str:
        p = who()
        return _out(theaters_service.get_theater(ctx, p.user, p.key.theater_id).shows)

    @server.tool(description="One show's settings: venue, timezone, rehearsal nights, tech week, opening")
    def get_show(show_id: str) -> str:
        return _out(shows_service.get_show(ctx, who().user, scoped(show_id)).show)

    @server.tool(
        description="Acts, scenes (length in eighths of a page), characters, their cast, and who is in each"
    )
    def get_breakdown(show_id: str) -> str:
        return _out(breakdown_service.get_breakdown(ctx, who().user, scoped(show_id)))

    @server.tool(
        description="Everyone in a show: role, part or title, department, and whether conflicts are in"
    )
    def list_people(show_id: str) -> str:
        return _out(shows_service.list_members(ctx, who().user, scoped(show_id)))

    @server.tool(description="Everyone's weekly and dated conflicts that touch the show's dates")
    def get_conflicts(show_id: str) -> str:
        return _out(conflicts_service.show_conflicts(ctx, who().user, scoped(show_id)))

    @server.tool(
        description="Calls from one date to another (at most two months; default this week), with timed "
        "scene blocks and conflict warnings for each block"
    )
    def get_schedule(show_id: str, from_date: str | None = None, to_date: str | None = None) -> str:
        return _out(schedule_service.get_schedule(ctx, who().user, scoped(show_id), from_date, to_date))

    @server.tool(description="Every scene ranked for one night: fewest conflicts first, then least rehearsed")
    def suggest_scenes(
        show_id: str, date: str, from_date: str | None = None, to_date: str | None = None
    ) -> str:
        return _out(
            schedule_service.suggest_scenes(ctx, who().user, scoped(show_id), date, from_date, to_date)
        )

    @server.tool(
        description="Adds a scene to the end of a night's call, making the call from the usual hours"
    )
    def add_scene_to_night(show_id: str, date: str, scene_id: str) -> str:
        p = write()
        body = schedule_service.AddSceneBody(scene_id=scene_id)
        return _out(schedule_service.add_scene(ctx, p.user, scoped(show_id), date, body))

    @server.tool(
        description="Removes a draft call, or cancels a published one (it goes when the week is published)"
    )
    def delete_call(show_id: str, call_id: str) -> str:
        p = write()
        schedule_service.delete_call(ctx, p.user, scoped(show_id), call_id)
        return _out({"deleted": call_id})

    @server.tool(
        description="Publishes every call from one date to another so cast and crew see them, and emails "
        "each "
        "person what changed. Confirm with the user before calling this."
    )
    def publish_schedule(show_id: str, from_date: str, to_date: str) -> str:
        p = write()
        body = schedule_service.PublishBody.model_validate({"from": from_date, "to": to_date})
        return _out(schedule_service.publish(ctx, p.user, scoped(show_id), body))

    @server.tool(description="The show's callboard notices, pinned first")
    def get_callboard(show_id: str) -> str:
        return _out(callboard_service.get_callboard(ctx, who().user, scoped(show_id)).notices)

    @server.tool(
        description="Posts a notice to everyone, cast or crew, and emails it. Confirm the wording first."
    )
    def post_notice(
        show_id: str, title: str, body: str, audience: str = "everyone", pinned: bool = False
    ) -> str:
        p = write()
        notice_body = callboard_service.PostNoticeBody.model_validate(
            {"title": title, "body": body, "audience": audience, "pinned": pinned}
        )
        return _out(callboard_service.post_notice(ctx, p.user, scoped(show_id), notice_body))

    return mcp


class McpEndpoint:
    """An ASGI app (a class, so Starlette routes to it as an app rather than a request handler)."""

    def __init__(self, ctx: Ctx) -> None:
        self.ctx = ctx
        self.lowlevel = build_server(ctx)._lowlevel_server  # noqa: SLF001

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        ctx, lowlevel = self.ctx, self.lowlevel
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        try:
            principal = principal_for(ctx, headers.get("authorization"))
        except ServiceError as err:
            await _json(send, err.status, {"error": err.message})
            return
        token = _principal.set(principal)
        try:
            manager = StreamableHTTPSessionManager(
                app=lowlevel,
                json_response=True,
                stateless=True,
                # API Gateway and CloudFront set the Host; an API key is required, so rebinding doesn't apply.
                security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
            )
            async with manager.run():
                await manager.handle_request({**scope, "path": "/mcp"}, receive, send)
        finally:
            _principal.reset(token)


async def _json(send: Send, status: int, body: dict[str, Any]) -> None:
    raw = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": raw})
