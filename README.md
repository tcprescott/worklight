# Worklight

Low-cost rehearsal scheduling for community theater. Directors break a script into scenes, cast and crew enter
conflicts from their phones, and everyone gets their calls in their own calendar.

Everything runs on pay-per-use AWS services, so a handful of theaters costs about $1 to $2 a month (mostly DNS
and the domain).

## Layout

| Folder | What it is |
| --- | --- |
| `backend` | Python 3.13: the FastAPI HTTP API (run on Lambda through Mangum) and the Cognito magic-link triggers. |
| `infra` | Python AWS CDK app that deploys all of it. |
| `web` | React + Vite app in TypeScript, served from S3 through CloudFront. |

```
Browser ──> CloudFront ──> S3 (web app, config.json)
                     └──> /api/* ──> API Gateway (Cognito JWT) ──> Lambda (FastAPI) ──> DynamoDB
Cognito custom auth ──> magic-link Lambdas ──> SES
```

`backend` and `infra` are one [uv](https://docs.astral.sh/uv/) workspace (`pyproject.toml` and `uv.lock` at the
root). The web app's API types are generated from the backend's OpenAPI schema, so the two can't drift apart.

## Sign-in

- **Magic link:** the user enters an email, gets a one-time link (15 minutes), and can open it on any device.
  Requests are limited to one per minute per address. See `backend/src/worklight/handlers/auth.py` for the
  Cognito challenge sequence.
- **Google:** optional, through the Cognito hosted sign-in page.

A person is identified by verified email, so signing in by link and by Google reaches the same account.

## Develop

Requires Python 3.13 with uv, and Node 22.

```sh
uv sync --all-packages     # backend + infra + dev tools into .venv
uv run pytest              # API, magic-link, DynamoDB store and CDK stack tests
uv run ruff check backend infra && uv run mypy

cd web
npm install
npm run typecheck
npm run build              # builds the web app into web/dist
```

After changing an API route or model, regenerate the schema and the web app's types (CI checks both):

```sh
uv run python -m worklight.openapi > backend/openapi.json
cd web && npm run gen:api
```

To run the web app locally against a deployed stack, copy `web/public/config.example.json` to
`web/public/config.json`, fill in the stack outputs, and run:

```sh
cd web && VITE_API_PROXY=https://<SiteUrl from the stack outputs> npm run dev
```

## Deploy

The CDK CLI runs through `npx`; the stack itself is Python. Synth bundles the backend with uv (arm64 wheels), so
Docker isn't needed.

1. **AWS account and CDK.** Configure AWS credentials, then bootstrap once from `infra/`:
   `npx aws-cdk@2.1146.1 bootstrap -c fromEmail=you@example.org`.
2. **Email.** Verify a sending domain or address in SES. New SES accounts are in the sandbox and can only email
   verified addresses, so request production access before inviting a cast.
3. **Settings.** Fill in the `context` block of `infra/cdk.json`, or pass `-c key=value`:

   | Key | Required | Purpose |
   | --- | --- | --- |
   | `fromEmail` | yes | Sender for sign-in links and invites |
   | `sesDomain` | no | Domain to verify in SES; DKIM records are printed as outputs |
   | `alertEmail` | no | Creates an AWS Budget alert at `monthlyBudgetUsd` (default $5) |
   | `appUrl` | no | Custom domain URL, once you have one; otherwise the CloudFront URL is used |
   | `cognitoDomainPrefix` | for Google | Prefix for the Cognito hosted sign-in domain |
   | `googleClientId` | for Google | Google OAuth client id |
   | `googleClientSecretName` | for Google | Secrets Manager secret holding the Google client secret (about $0.40/month) |

4. **Deploy:** build the web app (`cd web && npm run build`), then from `infra/` run
   `npx aws-cdk@2.1146.1 deploy`. The site URL is in the `SiteUrl` output.

For Google sign-in, add `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse` as an
authorized redirect URI in the Google Cloud console.

## Roadmap

Phase 1 (this) covers accounts, theaters, shows, roles and invites. Next: script breakdown and conflicts, then
scheduling, then calendar feeds, reminders and announcements, then the public APIs (REST, GraphQL, MCP), mobile
apps, and optional billing with SMS.
