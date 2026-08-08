import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import type { ServiceProvider } from "../../bootstrap/contracts";
import { projectRepositoryToken } from "../project/provider";
import CommentPolicy from "./policy";
import CommentRepository from "./repository";
import CommentService from "./service";

const commentRepositoryToken = "comment.repository";
const commentServiceToken = "comment.service";
const commentPolicyToken = "comment.policy";

const commentProvider: ServiceProvider = {
  name: "comment.provider",
  register({ container }) {
    container.singleton(commentRepositoryToken, () => new CommentRepository());
    container.singleton(commentPolicyToken, () => new CommentPolicy());
  },
  boot({ container }) {
    container.singleton(
      commentServiceToken,
      () =>
        new CommentService(
          container.resolve(commentRepositoryToken),
          container.resolve("task.repository"),
          container.resolve(projectRepositoryToken),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("comment", container.resolve(commentPolicyToken));
  },
};

export default commentProvider;
export { commentPolicyToken, commentRepositoryToken, commentServiceToken };
