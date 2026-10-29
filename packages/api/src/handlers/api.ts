import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { createApp } from "../app.js";
import { getAppUrl, requireEnv } from "../lib/config.js";
import { SesMailer } from "../lib/mailer.js";
import { DynamoStore } from "../lib/store.js";

const store = new DynamoStore(requireEnv("TABLE_NAME"));
const mailer = new SesMailer(requireEnv("FROM_EMAIL"));
let app: ReturnType<typeof createApp> | undefined;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  app ??= createApp({ store, mailer, appUrl: await getAppUrl() });
  return app(event);
};
