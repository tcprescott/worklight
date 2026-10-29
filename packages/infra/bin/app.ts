import { App } from "aws-cdk-lib";
import { fileURLToPath } from "node:url";
import { CallTimeStack } from "../src/call-time-stack.js";

const app = new App();
const ctx = (key: string) => {
  const value = app.node.tryGetContext(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

const fromEmail = ctx("fromEmail");
if (!fromEmail) {
  throw new Error('Set the "fromEmail" context value (cdk.json or -c fromEmail=...) to an address SES can send from.');
}

new CallTimeStack(app, "CallTime", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  fromEmail,
  sesDomain: ctx("sesDomain"),
  appUrl: ctx("appUrl"),
  cognitoDomainPrefix: ctx("cognitoDomainPrefix"),
  google:
    ctx("googleClientId") && ctx("googleClientSecretName")
      ? { clientId: ctx("googleClientId")!, clientSecretName: ctx("googleClientSecretName")! }
      : undefined,
  alertEmail: ctx("alertEmail"),
  monthlyBudgetUsd: Number(app.node.tryGetContext("monthlyBudgetUsd") ?? 5),
  webDistPath: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
