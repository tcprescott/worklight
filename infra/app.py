import os
from pathlib import Path

import aws_cdk as cdk
from call_time_infra.stack import CallTimeStack, GoogleSignIn, Settings

app = cdk.App()


def ctx(key: str) -> str | None:
    value = app.node.try_get_context(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


from_email = ctx("fromEmail")
if not from_email:
    raise SystemExit(
        'Set the "fromEmail" context value (cdk.json or -c fromEmail=...) to an address SES can send from.'
    )

google_client_id, google_secret = ctx("googleClientId"), ctx("googleClientSecretName")

CallTimeStack(
    app,
    "CallTime",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
    ),
    settings=Settings(
        from_email=from_email,
        ses_domain=ctx("sesDomain"),
        app_url=ctx("appUrl"),
        cognito_domain_prefix=ctx("cognitoDomainPrefix"),
        google=GoogleSignIn(google_client_id, google_secret) if google_client_id and google_secret else None,
        alert_email=ctx("alertEmail"),
        monthly_budget_usd=float(app.node.try_get_context("monthlyBudgetUsd") or 5),
        web_dist_path=Path(__file__).resolve().parent.parent / "web" / "dist",
    ),
)

app.synth()
