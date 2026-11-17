import aws_cdk as cdk
from aws_cdk.assertions import Match, Template

from worklight_infra.github import GithubDeployStack

ENV = cdk.Environment(account="123456789012", region="us-east-1")


def test_only_the_repos_matching_environment_can_assume_the_deploy_role() -> None:
    template = Template.from_stack(
        GithubDeployStack(cdk.App(), "Gh", env=ENV, repo="acme/worklight", environment="staging")
    )
    template.resource_count_is("Custom::AWSCDKOpenIdConnectProvider", 1)
    template.has_resource_properties(
        "AWS::IAM::Role",
        {
            "AssumeRolePolicyDocument": Match.object_like(
                {
                    "Statement": [
                        Match.object_like(
                            {
                                "Action": "sts:AssumeRoleWithWebIdentity",
                                "Condition": {
                                    "StringEquals": {
                                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                                        "token.actions.githubusercontent.com:sub": (
                                            "repo:acme/worklight:environment:staging"
                                        ),
                                    }
                                },
                            }
                        )
                    ]
                }
            )
        },
    )


def test_the_deploy_role_can_only_hand_off_to_the_cdk_bootstrap_roles() -> None:
    template = Template.from_stack(
        GithubDeployStack(cdk.App(), "Gh", env=ENV, repo="acme/worklight", environment="staging")
    )
    template.has_resource_properties(
        "AWS::IAM::Policy",
        {
            "PolicyDocument": {
                "Statement": [
                    {
                        "Action": "sts:AssumeRole",
                        "Effect": "Allow",
                        "Resource": {
                            "Fn::Join": [
                                "",
                                ["arn:", {"Ref": "AWS::Partition"}, ":iam::123456789012:role/cdk-*"],
                            ]
                        },
                    }
                ],
                "Version": "2012-10-17",
            }
        },
    )


def test_reuses_an_existing_github_provider() -> None:
    arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    template = Template.from_stack(
        GithubDeployStack(
            cdk.App(), "Gh", env=ENV, repo="acme/worklight", environment="staging", existing_provider_arn=arn
        )
    )
    template.resource_count_is("Custom::AWSCDKOpenIdConnectProvider", 0)
