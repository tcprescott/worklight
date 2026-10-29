import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";
import { getAppUrl, requireEnv } from "../../lib/config.js";
import { requestMagicLink } from "../../lib/magic-link.js";
import { SesMailer } from "../../lib/mailer.js";
import { DynamoStore } from "../../lib/store.js";

const store = new DynamoStore(requireEnv("TABLE_NAME"));
const mailer = new SesMailer(requireEnv("FROM_EMAIL"));

/**
 * Magic-link sequence. Cognito only passes ClientMetadata to these triggers on
 * RespondToAuthChallenge, never on InitiateAuth, so every sign-in starts with a no-op challenge:
 *
 *   Request a link (any browser):
 *     InitiateAuth(CUSTOM_AUTH)                      -> challenge 1, nothing sent
 *     Respond("-", { mode: "request", next })        -> verify fails, challenge 2 emails the link
 *
 *   Redeem the link (any browser or device):
 *     InitiateAuth(CUSTOM_AUTH)                      -> challenge 1, nothing sent
 *     Respond(code, { mode: "redeem" })              -> verify checks the code, tokens issued
 */
export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const metadata = event.request.clientMetadata ?? {};
  const email = event.request.userAttributes.email;
  let step = "choose";
  if (event.request.session.length > 0 && metadata.mode === "request" && email) {
    const result = await requestMagicLink({ store, mailer, appUrl: await getAppUrl() }, email, metadata.next ?? "/");
    step = result === "sent" ? "email-sent" : "email-throttled";
  }
  event.response.publicChallengeParameters = { step };
  event.response.privateChallengeParameters = {};
  event.response.challengeMetadata = `MAGIC_LINK_${step.toUpperCase()}`;
  return event;
};
