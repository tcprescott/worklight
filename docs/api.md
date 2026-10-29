# Worklight public APIs

Company admins make API keys on the Staff and admins page. A key belongs to one company and acts as the
admin who made it, limited to that company's shows. A **read** key can only read; a **read and write** key
can also build and publish schedules and post notices. Keys stop working when revoked or when the admin
who made them stops being an admin. The secret (`wl_...`) is shown once; Worklight stores only its hash.

Send it on every request:

```
Authorization: Bearer wl_...
```

Each key gets 120 requests a minute (HTTP 429 after that). Dates are `YYYY-MM-DD`, times `HH:MM` in the
show's timezone.

## REST: `/api/v1`

The same routes the app uses, under `/api/v1` instead of `/api`, for anything under a company or show:

| What | Route |
| --- | --- |
| Company and its shows | `GET /api/v1/theaters/{theaterId}` |
| A show | `GET /api/v1/shows/{showId}` |
| Breakdown | `GET /api/v1/shows/{showId}/breakdown` |
| People | `GET /api/v1/shows/{showId}/members` |
| Everyone's conflicts | `GET /api/v1/shows/{showId}/conflicts` |
| Schedule | `GET /api/v1/shows/{showId}/schedule?from=&to=` |
| Scene suggestions | `GET /api/v1/shows/{showId}/schedule/suggestions?date=` |
| Add a scene to a night | `POST /api/v1/shows/{showId}/schedule/{date}/scenes` |
| Publish | `POST /api/v1/shows/{showId}/schedule/publish` with `{"from", "to"}` |
| Callboard | `GET`/`POST /api/v1/shows/{showId}/notices` |

The full schema is the app's OpenAPI document at `/api/openapi.json` (paths there start with `/api`).
Routes about the signed-in person (`/me/...`, joining, check-in) and company admin changes aren't open to
keys.

## GraphQL: `POST /api/graphql`

```graphql
{
  theater { name shows { show { showId name openingDate } castCount waitingCount } }
}
```

Queries: `theater`, `show`, `breakdown`, `people`, `conflicts`, `schedule(showId, fromDate, toDate)`,
`suggestScenes(showId, date)`, `callboard`. Mutations: `addSceneToNight`, `deleteCall`,
`publish(showId, fromDate, toDate)`, `postNotice`. Errors come back with the same plain messages as REST.

## MCP: `https://<your site>/mcp`

Stateless Streamable HTTP with JSON responses. Give your assistant the URL and the key as a bearer token.
Tools: `list_shows`, `get_show`, `get_breakdown`, `list_people`, `get_conflicts`, `get_schedule`,
`suggest_scenes`, `get_callboard`, and with a read and write key `add_scene_to_night`, `delete_call`,
`publish_schedule`, `post_notice`. The tool descriptions ask the assistant to confirm before publishing or
posting.
