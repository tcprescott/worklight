import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";
import { requireEnv } from "../../lib/config.js";
import { redeemMagicLink } from "../../lib/magic-link.js";
import { DynamoStore } from "../../lib/store.js";

const store = new DynamoStore(requireEnv("TABLE_NAME"));

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const metadata = event.request.clientMetadata ?? {};
  const email = event.request.userAttributes.email;
  const answer = event.request.challengeAnswer;
  event.response.answerCorrect =
    metadata.mode === "redeem" && !!email && typeof answer === "string" && answer.length > 20
      ? await redeemMagicLink(store, email, answer)
      : false;
  return event;
};
