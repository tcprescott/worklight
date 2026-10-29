import type { PreSignUpTriggerHandler } from "aws-lambda";

/**
 * Magic-link users are created with a throwaway password and proven by the emailed link, so
 * there is no separate confirmation step. Google users arrive already verified by Google.
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) event.response.autoVerifyEmail = true;
  return event;
};
