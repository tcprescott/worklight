import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Match, Template

from worklight_infra.stack import GoogleSignIn, Settings, WorklightStack


def synth(**overrides: object) -> Template:
    # Skip bundling: these tests check the template, not the Lambda bundle.
    app = cdk.App(context={"aws:cdk:bundling-stacks": []})
    settings = Settings(from_email="no-reply@worklight.test", **overrides)  # type: ignore[arg-type]
    stack = WorklightStack(
        app, "Test", env=cdk.Environment(account="123456789012", region="us-east-1"), settings=settings
    )
    return Template.from_stack(stack)


@pytest.fixture(scope="module")
def template() -> Template:
    return synth()


def test_uses_an_on_demand_table_with_a_user_index_and_ttl(template: Template) -> None:
    template.has_resource_properties(
        "AWS::DynamoDB::GlobalTable",
        {
            "BillingMode": "PAY_PER_REQUEST",
            "TimeToLiveSpecification": {"AttributeName": "expiresAt", "Enabled": True},
            "GlobalSecondaryIndexes": [Match.object_like({"IndexName": "GSI1"})],
        },
    )


def test_wires_the_magic_link_triggers_into_a_lite_user_pool(template: Template) -> None:
    template.has_resource_properties(
        "AWS::Cognito::UserPool",
        {
            "UserPoolTier": "LITE",
            "LambdaConfig": Match.object_like(
                {
                    "PreSignUp": Match.any_value(),
                    "DefineAuthChallenge": Match.any_value(),
                    "CreateAuthChallenge": Match.any_value(),
                    "VerifyAuthChallengeResponse": Match.any_value(),
                }
            ),
        },
    )
    template.has_resource_properties(
        "AWS::Cognito::UserPoolClient", {"ExplicitAuthFlows": Match.array_with(["ALLOW_CUSTOM_AUTH"])}
    )


def test_protects_the_api_with_a_cognito_jwt_authorizer(template: Template) -> None:
    template.has_resource_properties("AWS::ApiGatewayV2::Authorizer", {"AuthorizerType": "JWT"})
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Route", {"RouteKey": "GET /api/{proxy+}", "AuthorizationType": "JWT"}
    )
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Route", {"RouteKey": "GET /api/public/{proxy+}", "AuthorizationType": "NONE"}
    )


def test_runs_python_arm64_functions_with_short_log_retention(template: Template) -> None:
    fns = template.find_resources(
        "AWS::Lambda::Function", {"Properties": {"Architectures": ["arm64"], "Runtime": "python3.13"}}
    )
    assert len(fns) == 6
    handlers = sorted(f["Properties"]["Handler"] for f in fns.values())
    assert handlers == [
        "worklight.handlers.api.handler",
        "worklight.handlers.auth.create_auth_challenge",
        "worklight.handlers.auth.define_auth_challenge",
        "worklight.handlers.auth.pre_sign_up",
        "worklight.handlers.auth.verify_auth_challenge",
        "worklight.handlers.jobs.reminders",
    ]
    template.all_resources_properties("AWS::Logs::LogGroup", {"RetentionInDays": 7})


def test_serves_the_site_and_api_from_one_cloudfront_distribution(template: Template) -> None:
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "CacheBehaviors": [
                        Match.object_like({"PathPattern": "/api/*"}),
                        Match.object_like({"PathPattern": "/mcp"}),
                    ]
                }
            )
        },
    )


def test_only_adds_google_ses_and_the_budget_when_configured(template: Template) -> None:
    template.resource_count_is("AWS::Cognito::UserPoolIdentityProvider", 0)
    template.resource_count_is("AWS::SES::EmailIdentity", 0)
    template.resource_count_is("AWS::Budgets::Budget", 0)

    full = synth(
        ses_domain="worklight.test",
        cognito_domain_prefix="worklight-test",
        google=GoogleSignIn("google-client", "worklight/google"),
        alert_email="owner@worklight.test",
    )
    full.resource_count_is("AWS::Cognito::UserPoolIdentityProvider", 1)
    full.resource_count_is("AWS::SES::EmailIdentity", 1)
    full.has_resource_properties(
        "AWS::Budgets::Budget", {"Budget": Match.object_like({"BudgetLimit": {"Amount": 5, "Unit": "USD"}})}
    )


def test_requires_a_hosted_sign_in_domain_for_google() -> None:
    with pytest.raises(ValueError, match="cognito_domain_prefix"):
        synth(google=GoogleSignIn("x", "y"))


def test_app_routes_load_the_shell_without_hiding_api_errors(template: Template) -> None:
    config = next(iter(template.find_resources("AWS::CloudFront::Distribution").values()))["Properties"][
        "DistributionConfig"
    ]
    assert "CustomErrorResponses" not in config
    associations = config["DefaultCacheBehavior"]["FunctionAssociations"]
    assert associations[0]["EventType"] == "viewer-request"


def test_runs_call_reminders_hourly(template: Template) -> None:
    template.has_resource_properties(
        "AWS::Lambda::Function", {"Handler": "worklight.handlers.jobs.reminders", "Timeout": 120}
    )
    template.has_resource_properties("AWS::Events::Rule", {"ScheduleExpression": "rate(1 hour)"})


def test_public_apis_skip_the_cognito_authorizer(template: Template) -> None:
    for route in ("ANY /api/v1/{proxy+}", "POST /api/graphql", "POST /mcp"):
        template.has_resource_properties(
            "AWS::ApiGatewayV2::Route", {"RouteKey": route, "AuthorizationType": "NONE"}
        )
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Stage",
        {"DefaultRouteSettings": {"ThrottlingBurstLimit": 100, "ThrottlingRateLimit": 50}},
    )
