import { faker } from "@faker-js/faker";
import { Factory } from "@getstrata/core/database/factory";
import { STATUS } from "../../lib/roles.ts";
import { Application } from "../../models/Application.ts";
import type { ApplicationRecord } from "../../modules/applications/repository.ts";

export class ApplicationFactory extends Factory<ApplicationRecord> {
  protected model = Application;

  protected definition(): ApplicationRecord {
    return {
      id: 0,
      user_id: 1,
      position_id: 1,
      status_id: faker.helpers.arrayElement([
        STATUS.APPLIED,
        STATUS.IN_PROGRESS,
        STATUS.INTERVIEW,
        STATUS.FEEDBACK,
      ]),
      attachment_text: faker.lorem.sentences(2),
      attachment_file: "https://talenthub.example/profile",
      created_at: null,
      updated_at: null,
      deleted_at: null,
    };
  }
}

export const applicationFactory = new ApplicationFactory();
