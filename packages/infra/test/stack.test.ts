import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CallTimeStack } from "../src/call-time-stack.js";

function synth(props: Partial<ConstructorParameters<typeof CallTimeStack>[2]> = {}) {
  const app = new App();
  const stack = new CallTimeStack(app, "Test", {
    env: { account: "123456789012", region: "us-east-1" },
    fromEmail: "no-reply@calltime.test",
    ...props,
  });
  return Template.fromStack(stack);
}

describe("CallTimeStack", () => {
  const template = synth();

  it("uses an on-demand table with a user index and TTL", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: "GSI1" })],
    });
  });

  it("wires the magic-link triggers into a Lite user pool", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTier: "LITE",
      LambdaConfig: Match.objectLike({
        PreSignUp: Match.anyValue(),
        DefineAuthChallenge: Match.anyValue(),
        CreateAuthChallenge: Match.anyValue(),
        VerifyAuthChallengeResponse: Match.anyValue(),
      }),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_CUSTOM_AUTH"]),
    });
  });

  it("protects the API with a Cognito JWT authorizer", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /api/{proxy+}",
      AuthorizationType: "JWT",
    });
  });

  it("runs small arm64 functions with short log retention", () => {
    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Architectures: ["arm64"], MemorySize: 256 },
    });
    expect(Object.keys(fns).length).toBe(5);
    template.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("serves the site and API from one CloudFront distribution", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [Match.objectLike({ PathPattern: "/api/*" })],
      }),
    });
  });

  it("only adds Google, SES and the budget when configured", () => {
    template.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 0);
    template.resourceCountIs("AWS::SES::EmailIdentity", 0);
    template.resourceCountIs("AWS::Budgets::Budget", 0);

    const full = synth({
      sesDomain: "calltime.test",
      cognitoDomainPrefix: "calltime-test",
      google: { clientId: "google-client", clientSecretName: "calltime/google" },
      alertEmail: "owner@calltime.test",
    });
    full.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 1);
    full.resourceCountIs("AWS::SES::EmailIdentity", 1);
    full.hasResourceProperties("AWS::Budgets::Budget", { Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: "USD" } }) });
  });

  it("requires a hosted sign-in domain for Google", () => {
    expect(() => synth({ google: { clientId: "x", clientSecretName: "y" } })).toThrow(/cognitoDomainPrefix/);
  });
});
