"""The role GitHub Actions assumes to deploy, through OIDC, so no AWS keys are stored in GitHub.

Deployed once per environment by hand (`cdk deploy WorklightGithubDeploy-staging`). Only workflow runs in the
repository's GitHub environment of the same name can assume the role, and it can only do what CDK needs:
assume the bootstrap roles, which do the actual deploying."""

from aws_cdk import CfnOutput, Stack
from aws_cdk import aws_iam as iam
from constructs import Construct

GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com"


class GithubDeployStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        repo: str,
        environment: str,
        existing_provider_arn: str | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)  # type: ignore[arg-type]

        # An account holds one provider per URL; reuse it if another project already made one.
        provider: iam.IOpenIdConnectProvider = (
            iam.OpenIdConnectProvider.from_open_id_connect_provider_arn(
                self, "GithubOidc", existing_provider_arn
            )
            if existing_provider_arn
            else iam.OpenIdConnectProvider(
                self, "GithubOidc", url=GITHUB_OIDC_URL, client_ids=["sts.amazonaws.com"]
            )
        )
        role = iam.Role(
            self,
            "DeployRole",
            description=f"GitHub Actions deploys of {repo} ({environment} environment)",
            assumed_by=iam.WebIdentityPrincipal(
                provider.open_id_connect_provider_arn,
                conditions={
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                        "token.actions.githubusercontent.com:sub": f"repo:{repo}:environment:{environment}",
                    }
                },
            ),
        )
        role.add_to_policy(
            iam.PolicyStatement(
                actions=["sts:AssumeRole"],
                resources=[f"arn:{self.partition}:iam::{self.account}:role/cdk-*"],
            )
        )
        CfnOutput(
            self, "DeployRoleArn", value=role.role_arn, description="Set as AWS_DEPLOY_ROLE_ARN in GitHub"
        )
