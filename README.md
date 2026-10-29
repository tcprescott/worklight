# Call Time

Low-cost rehearsal scheduling for community theater. Directors break a script into scenes, cast and crew enter
conflicts from their phones, and everyone gets their calls in their own calendar.

Everything runs on pay-per-use AWS services, so a handful of theaters costs about $1 to $2 a month (mostly DNS
and the domain).

## Layout

| Package | What it is |
| --- | --- |
| `packages/shared` | Types, roles and permissions, DynamoDB key layout. Used by the API and the web app. |
| `packages/api` | Lambda handlers: the HTTP API (one router function) and the Cognito magic-link triggers. |
| `packages/web` | React + Vite app, served from S3 through CloudFront. |
| `packages/infra` | AWS CDK app that deploys all of it. |

```
Browser ──> CloudFront ──> S3 (web app, config.json)
                     └──> /api/* ──> API Gateway (Cognito JWT) ──> Lambda ──> DynamoDB
Cognito custom auth ──> magic-link Lambdas ──> SES
```

## Sign-in

- **Magic link:** the user enters an email, gets a one-time link (15 minutes), and can open it on any device.
  Requests are limited to one per minute per address. See `packages/api/src/handlers/auth/create-auth-challenge.ts`
  for the Cognito challenge sequence.
- **Google:** optional, through the Cognito hosted sign-in page.

A person is identified by verified email, so signing in by link and by Google reaches the same account.

## Develop

Requires Node 22.

```sh
npm install
npm test           # unit tests for shared, api and the CDK stack
npm run typecheck
npm run build      # builds the web app into packages/web/dist
```

To run the web app locally against a deployed stack, copy `packages/web/public/config.example.json` to
`packages/web/public/config.json`, fill in the stack outputs, and run:

```sh
VITE_API_PROXY=https://<SiteUrl from the stack outputs> npm run dev -w @call-time/web
```

## Deploy

1. **AWS account and CDK.** Configure AWS credentials, then bootstrap once:
   `npx cdk bootstrap -c fromEmail=you@example.org` from `packages/infra`.
2. **Email.** Verify a sending domain or address in SES. New SES accounts are in the sandbox and can only email
   verified addresses, so request production access before inviting a cast.
3. **Settings.** Fill in the `context` block of `packages/infra/cdk.json`, or pass `-c key=value`:

   | Key | Required | Purpose |
   | --- | --- | --- |
   | `fromEmail` | yes | Sender for sign-in links and invites |
   | `sesDomain` | no | Domain to verify in SES; DKIM records are printed as outputs |
   | `alertEmail` | no | Creates an AWS Budget alert at `monthlyBudgetUsd` (default $5) |
   | `appUrl` | no | Custom domain URL, once you have one; otherwise the CloudFront URL is used |
   | `cognitoDomainPrefix` | for Google | Prefix for the Cognito hosted sign-in domain |
   | `googleClientId` | for Google | Google OAuth client id |
   | `googleClientSecretName` | for Google | Secrets Manager secret holding the Google client secret (about $0.40/month) |

4. **Deploy:** `npm run deploy` from the repo root. The site URL is in the `SiteUrl` output.

For Google sign-in, add `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse` as an
authorized redirect URI in the Google Cloud console.

## Roadmap

Phase 1 (this) covers accounts, theaters, shows, roles and invites. Next: script breakdown and conflicts, then the
scheduler, then calendar feeds and reminders, then the paid tier with AI script parsing.
