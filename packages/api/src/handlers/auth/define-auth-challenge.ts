import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

/**
 * Custom auth flow for magic links (see create-auth-challenge for the full sequence).
 * Tokens are issued only when the latest custom challenge was answered with a valid code.
 */
export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session;
  const last = session.at(-1);
  if (last?.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (session.length >= 3) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
  }
  return event;
};
