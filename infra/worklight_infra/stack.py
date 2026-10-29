from dataclasses import dataclass
from pathlib import Path

from aws_cdk import (
    AssetHashType,
    BundlingOptions,
    CfnOutput,
    Duration,
    RemovalPolicy,
    SecretValue,
    Stack,
)
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_authorizers as authorizers
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_budgets as budgets
from aws_cdk import aws_cloudfront as cloudfront
from aws_cdk import aws_cloudfront_origins as origins
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_s3_deployment as s3deploy
from aws_cdk import aws_ses as ses
from aws_cdk import aws_ssm as ssm
from constructs import Construct

from worklight_infra.bundling import BACKEND, UvBundling, backend_hash


@dataclass(frozen=True)
class GoogleSignIn:
    client_id: str
    # The client secret lives in Secrets Manager under this name.
    client_secret_name: str


@dataclass(frozen=True)
class Settings:
    # Address every email is sent from. Must be verified in SES (or sit on ses_domain).
    from_email: str
    # Domain to verify in SES. DKIM records are output for you to add to DNS.
    ses_domain: str | None = None
    # Public URL once a custom domain exists. Defaults to the CloudFront URL.
    app_url: str | None = None
    # Prefix for the Cognito hosted sign-in domain. Required for Google sign-in.
    cognito_domain_prefix: str | None = None
    google: GoogleSignIn | None = None
    # Gets an email when spend passes 80% of the budget, or is forecast to pass 100%.
    alert_email: str | None = None
    monthly_budget_usd: float = 5
    # Built web app (web/dist). Skipped when the folder doesn't exist, e.g. in tests.
    web_dist_path: Path | None = None


class WorklightStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, *, settings: Settings, **kwargs: object) -> None:
        super().__init__(scope, construct_id, **kwargs)  # type: ignore[arg-type]
        s = settings

        # ---- Data -------------------------------------------------------------------------------

        table = dynamodb.TableV2(
            self,
            "Table",
            partition_key=dynamodb.Attribute(name="PK", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="SK", type=dynamodb.AttributeType.STRING),
            billing=dynamodb.Billing.on_demand(),
            time_to_live_attribute="expiresAt",
            global_secondary_indexes=[
                dynamodb.GlobalSecondaryIndexPropsV2(
                    index_name="GSI1",
                    partition_key=dynamodb.Attribute(name="GSI1PK", type=dynamodb.AttributeType.STRING),
                    sort_key=dynamodb.Attribute(name="GSI1SK", type=dynamodb.AttributeType.STRING),
                )
            ],
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ---- Site (S3 + CloudFront) -------------------------------------------------------------

        site_bucket = s3.Bucket(
            self,
            "SiteBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        http_api = apigw.HttpApi(self, "Api", create_default_stage=True)

        distribution = cloudfront.Distribution(
            self,
            "Site",
            default_root_object="index.html",
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(site_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
            additional_behaviors={
                # Same origin as the site, so the browser needs no CORS.
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        f"{http_api.api_id}.execute-api.{self.region}.{self.url_suffix}"
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                ),
            },
            # Client-side routes such as /invite/abc load the app shell.
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=status,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(5),
                )
                for status in (403, 404)
            ],
        )

        app_url = s.app_url or f"https://{distribution.distribution_domain_name}"
        # Lambdas read the URL from here: putting the distribution in their environment would be a cycle.
        app_url_param = ssm.StringParameter(
            self, "AppUrl", parameter_name=f"/{self.stack_name}/app-url", string_value=app_url
        )

        # ---- Functions --------------------------------------------------------------------------

        code = lambda_.Code.from_asset(
            str(BACKEND),
            asset_hash=backend_hash(),
            asset_hash_type=AssetHashType.CUSTOM,
            bundling=BundlingOptions(image=lambda_.Runtime.PYTHON_3_13.bundling_image, local=UvBundling()),
        )
        shared_env = {
            "TABLE_NAME": table.table_name,
            "FROM_EMAIL": s.from_email,
            "APP_URL_PARAM": app_url_param.parameter_name,
        }

        def fn(construct_id: str, handler: str, *, sends_email: bool, memory: int = 256) -> lambda_.Function:
            f = lambda_.Function(
                self,
                construct_id,
                code=code,
                handler=f"worklight.handlers.{handler}",
                runtime=lambda_.Runtime.PYTHON_3_13,
                architecture=lambda_.Architecture.ARM_64,
                memory_size=memory,
                timeout=Duration.seconds(10),
                environment=shared_env,
                log_group=logs.LogGroup(
                    self,
                    f"{construct_id}Logs",
                    retention=logs.RetentionDays.ONE_WEEK,
                    removal_policy=RemovalPolicy.DESTROY,
                ),
            )
            table.grant_read_write_data(f)
            # Built from the name so the policy doesn't depend on the parameter's value (the distribution).
            f.add_to_role_policy(
                iam.PolicyStatement(
                    actions=["ssm:GetParameter"],
                    resources=[
                        self.format_arn(
                            service="ssm",
                            resource="parameter",
                            resource_name=app_url_param.parameter_name[1:],
                        )
                    ],
                )
            )
            if sends_email:
                f.add_to_role_policy(
                    iam.PolicyStatement(
                        actions=["ses:SendEmail"],
                        resources=["*"],
                        conditions={"StringEquals": {"ses:FromAddress": s.from_email}},
                    )
                )
            return f

        # FastAPI imports more than the small triggers, so the API gets more memory (and CPU) for cold starts.
        api_fn = fn("ApiFunction", "api.handler", sends_email=True, memory=512)
        pre_sign_up = fn("PreSignUpFunction", "auth.pre_sign_up", sends_email=False)
        define_challenge = fn("DefineAuthChallengeFunction", "auth.define_auth_challenge", sends_email=False)
        create_challenge = fn("CreateAuthChallengeFunction", "auth.create_auth_challenge", sends_email=True)
        verify_challenge = fn("VerifyAuthChallengeFunction", "auth.verify_auth_challenge", sends_email=False)

        # ---- Auth (Cognito) ---------------------------------------------------------------------

        user_pool = cognito.UserPool(
            self,
            "Users",
            feature_plan=cognito.FeaturePlan.LITE,
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True),
            sign_in_case_sensitive=False,
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=True, mutable=True)
            ),
            account_recovery=cognito.AccountRecovery.NONE,
            lambda_triggers=cognito.UserPoolTriggers(
                pre_sign_up=pre_sign_up,
                define_auth_challenge=define_challenge,
                create_auth_challenge=create_challenge,
                verify_auth_challenge_response=verify_challenge,
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        identity_providers = [cognito.UserPoolClientIdentityProvider.COGNITO]
        google_provider: cognito.UserPoolIdentityProviderGoogle | None = None
        if s.google:
            google_provider = cognito.UserPoolIdentityProviderGoogle(
                self,
                "Google",
                user_pool=user_pool,
                client_id=s.google.client_id,
                client_secret_value=SecretValue.secrets_manager(s.google.client_secret_name),
                scopes=["openid", "email", "profile"],
                attribute_mapping=cognito.AttributeMapping(
                    email=cognito.ProviderAttribute.GOOGLE_EMAIL,
                    email_verified=cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
                    given_name=cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
                    family_name=cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
                ),
            )
            identity_providers.append(cognito.UserPoolClientIdentityProvider.GOOGLE)

        hosted_ui = (
            user_pool.add_domain(
                "Domain", cognito_domain=cognito.CognitoDomainOptions(domain_prefix=s.cognito_domain_prefix)
            )
            if s.cognito_domain_prefix
            else None
        )
        if s.google and not hosted_ui:
            raise ValueError("Google sign-in needs cognito_domain_prefix for the hosted sign-in page")

        client = user_pool.add_client(
            "WebClient",
            generate_secret=False,
            auth_flows=cognito.AuthFlow(custom=True),
            prevent_user_existence_errors=True,
            supported_identity_providers=identity_providers,
            id_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(90),
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
                callback_urls=[f"{app_url}/auth/callback", "http://localhost:5173/auth/callback"],
                logout_urls=[f"{app_url}/", "http://localhost:5173/"],
            )
            if hosted_ui
            else None,
        )
        if google_provider:
            client.node.add_dependency(google_provider)

        # ---- API routes -------------------------------------------------------------------------

        # The web app sends the Cognito ID token, which carries the verified email.
        authorizer = authorizers.HttpJwtAuthorizer(
            "CognitoJwt", user_pool.user_pool_provider_url, jwt_audience=[client.user_pool_client_id]
        )
        http_api.add_routes(
            path="/api/{proxy+}",
            methods=[
                apigw.HttpMethod.GET,
                apigw.HttpMethod.POST,
                apigw.HttpMethod.PUT,
                apigw.HttpMethod.PATCH,
                apigw.HttpMethod.DELETE,
            ],
            integration=integrations.HttpLambdaIntegration("ApiIntegration", api_fn),
            authorizer=authorizer,
        )

        # ---- Email (SES) ------------------------------------------------------------------------

        if s.ses_domain:
            identity = ses.EmailIdentity(self, "EmailDomain", identity=ses.Identity.domain(s.ses_domain))
            for i, record in enumerate(identity.dkim_records, start=1):
                CfnOutput(self, f"DkimRecord{i}", value=f"{record.name} CNAME {record.value}")

        # ---- Web app deploy ---------------------------------------------------------------------

        if s.web_dist_path and s.web_dist_path.exists():
            s3deploy.BucketDeployment(
                self,
                "DeploySite",
                destination_bucket=site_bucket,
                distribution=distribution,
                sources=[
                    s3deploy.Source.asset(str(s.web_dist_path)),
                    s3deploy.Source.json_data(
                        "config.json",
                        {
                            "region": self.region,
                            "userPoolId": user_pool.user_pool_id,
                            "userPoolClientId": client.user_pool_client_id,
                            "hostedUiUrl": hosted_ui.base_url() if hosted_ui else None,
                            "googleEnabled": bool(s.google),
                        },
                    ),
                ],
            )

        # ---- Cost guardrail ---------------------------------------------------------------------

        if s.alert_email:
            subscribers = [
                budgets.CfnBudget.SubscriberProperty(subscription_type="EMAIL", address=s.alert_email)
            ]
            budgets.CfnBudget(
                self,
                "Budget",
                budget=budgets.CfnBudget.BudgetDataProperty(
                    budget_name=f"{self.stack_name}-monthly",
                    budget_type="COST",
                    time_unit="MONTHLY",
                    budget_limit=budgets.CfnBudget.SpendProperty(amount=s.monthly_budget_usd, unit="USD"),
                ),
                notifications_with_subscribers=[
                    budgets.CfnBudget.NotificationWithSubscribersProperty(
                        notification=budgets.CfnBudget.NotificationProperty(
                            notification_type=kind, comparison_operator="GREATER_THAN", threshold=threshold
                        ),
                        subscribers=subscribers,
                    )
                    for kind, threshold in (("ACTUAL", 80), ("FORECASTED", 100))
                ],
            )

        CfnOutput(self, "SiteUrl", value=app_url)
        CfnOutput(self, "TableName", value=table.table_name)
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
