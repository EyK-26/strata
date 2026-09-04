import type { Application } from "../models/Application.ts";

const APPLICATION_SUBMITTED = "ApplicationSubmitted";

export type ApplicationSubmittedPayload = {
  application: Application;
};

export { APPLICATION_SUBMITTED };
