import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
  aws_budgets as budgets,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_ses as ses,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

export interface CallTimeStackProps extends StackProps {
  /** Address every email is sent from. Must be verified in SES (or sit on sesDomain). */
  fromEmail: string;
  /** Domain to verify in SES. DKIM records are output for you to add to DNS. */
  sesDomain?: string;
  /** Public URL once a custom domain exists. Defaults to the CloudFront URL. */
  appUrl?: string;
  /** Prefix for the Cognito hosted sign-in domain. Required for Google sign-in. */
  cognitoDomainPrefix?: string;
  /** Google OAuth client. The secret lives in Secrets Manager under clientSecretName. */
  google?: { clientId: string; clientSecretName: string };
  /** Gets an email when spend passes 80% of the budget, or is forecast to pass 100%. */
  alertEmail?: string;
  monthlyBudgetUsd?: number;
  /** Built web app (packages/web/dist). Skipped when the folder doesn't exist, e.g. in tests. */
  webDistPath?: string;
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const handlerPath = (file: string) => fileURLToPath(new URL(`../../api/src/handlers/${file}`, import.meta.url));

export class CallTimeStack extends Stack {
  constructor(scope: Construct, id: string, props: CallTimeStackProps) {
    super(scope, id, props);

    // ---- Data -------------------------------------------------------------------------------

    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      globalSecondaryIndexes: [
        {
          indexName: "GSI1",
          partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
        },
      ],
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- Site (S3 + CloudFront) ---------------------------------------------------------------

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const httpApi = new HttpApi(this, "Api", { createDefaultStage: true });

    const distribution = new cloudfront.Distribution(this, "Site", {
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        // Same origin as the site, so the browser needs no CORS.
        "/api/*": {
          origin: new origins.HttpOrigin(`${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // Client-side routes such as /invite/abc load the app shell.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(5) },
      ],
    });

    const appUrl = props.appUrl ?? `https://${distribution.distributionDomainName}`;
    // Lambdas read the URL from here: putting the distribution in their environment would be a cycle.
    const appUrlParam = new ssm.StringParameter(this, "AppUrl", {
      parameterName: `/${this.stackName}/app-url`,
      stringValue: appUrl,
    });

    // ---- Functions ----------------------------------------------------------------------------

    const sharedEnv = {
      TABLE_NAME: table.tableName,
      FROM_EMAIL: props.fromEmail,
      APP_URL_PARAM: appUrlParam.parameterName,
      NODE_OPTIONS: "--enable-source-maps",
    };

    const fn = (id: string, file: string, needsEmail: boolean) => {
      const f = new nodejs.NodejsFunction(this, id, {
        entry: handlerPath(file),
        projectRoot: repoRoot,
        depsLockFilePath: `${repoRoot}package-lock.json`,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        environment: sharedEnv,
        bundling: { minify: true, sourceMap: true, target: "node22" },
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
      table.grantReadWriteData(f);
      // Built from the name so the policy doesn't depend on the parameter's value (the distribution).
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: appUrlParam.parameterName.slice(1) })],
        }),
      );
      if (needsEmail) {
        f.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["ses:SendEmail"],
            resources: ["*"],
            conditions: { StringEquals: { "ses:FromAddress": props.fromEmail } },
          }),
        );
      }
      return f;
    };

    const apiFn = fn("ApiFunction", "api.ts", true);
    const preSignUp = fn("PreSignUpFunction", "auth/pre-sign-up.ts", false);
    const defineChallenge = fn("DefineAuthChallengeFunction", "auth/define-auth-challenge.ts", false);
    const createChallenge = fn("CreateAuthChallengeFunction", "auth/create-auth-challenge.ts", true);
    const verifyChallenge = fn("VerifyAuthChallengeFunction", "auth/verify-auth-challenge.ts", false);

    // ---- Auth (Cognito) -----------------------------------------------------------------------

    const userPool = new cognito.UserPool(this, "Users", {
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      accountRecovery: cognito.AccountRecovery.NONE,
      lambdaTriggers: {
        preSignUp,
        defineAuthChallenge: defineChallenge,
        createAuthChallenge: createChallenge,
        verifyAuthChallengeResponse: verifyChallenge,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const supportedIdentityProviders = [cognito.UserPoolClientIdentityProvider.COGNITO];
    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (props.google) {
      googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
        userPool,
        clientId: props.google.clientId,
        clientSecretValue: SecretValue.secretsManager(props.google.clientSecretName),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
      supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    const hostedUi = props.cognitoDomainPrefix
      ? userPool.addDomain("Domain", { cognitoDomain: { domainPrefix: props.cognitoDomainPrefix } })
      : undefined;
    if (props.google && !hostedUi) throw new Error("Google sign-in needs cognitoDomainPrefix for the hosted sign-in page");

    const callbackUrls = [`${appUrl}/auth/callback`, "http://localhost:5173/auth/callback"];
    const client = userPool.addClient("WebClient", {
      generateSecret: false,
      authFlows: { custom: true },
      preventUserExistenceErrors: true,
      supportedIdentityProviders,
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(90),
      oAuth: hostedUi
        ? {
            flows: { authorizationCodeGrant: true },
            scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
            callbackUrls,
            logoutUrls: [`${appUrl}/`, "http://localhost:5173/"],
          }
        : undefined,
    });
    if (googleProvider) client.node.addDependency(googleProvider);

    // ---- API routes ---------------------------------------------------------------------------

    // The web app sends the Cognito ID token, which carries the verified email.
    const authorizer = new HttpJwtAuthorizer("CognitoJwt", userPool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId],
    });
    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("ApiIntegration", apiFn),
      authorizer,
    });

    // ---- Email (SES) --------------------------------------------------------------------------

    if (props.sesDomain) {
      const identity = new ses.EmailIdentity(this, "EmailDomain", { identity: ses.Identity.domain(props.sesDomain) });
      identity.dkimRecords.forEach((record, i) => {
        new CfnOutput(this, `DkimRecord${i + 1}`, { value: `${record.name} CNAME ${record.value}` });
      });
    }

    // ---- Web app deploy -----------------------------------------------------------------------

    if (props.webDistPath && existsSync(props.webDistPath)) {
      new s3deploy.BucketDeployment(this, "DeploySite", {
        destinationBucket: siteBucket,
        distribution,
        sources: [
          s3deploy.Source.asset(props.webDistPath),
          s3deploy.Source.jsonData("config.json", {
            region: this.region,
            userPoolId: userPool.userPoolId,
            userPoolClientId: client.userPoolClientId,
            hostedUiUrl: hostedUi ? hostedUi.baseUrl() : null,
            googleEnabled: Boolean(props.google),
          }),
        ],
      });
    }

    // ---- Cost guardrail -----------------------------------------------------------------------

    if (props.alertEmail) {
      const subscribers = [{ subscriptionType: "EMAIL", address: props.alertEmail }];
      new budgets.CfnBudget(this, "Budget", {
        budget: {
          budgetName: `${this.stackName}-monthly`,
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.monthlyBudgetUsd ?? 5, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80 },
            subscribers,
          },
          {
            notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100 },
            subscribers,
          },
        ],
      });
    }

    new CfnOutput(this, "SiteUrl", { value: appUrl });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
  }
}
