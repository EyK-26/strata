import type { ServiceProvider } from "../../bootstrap/contracts";
import { CORE_POLICY_GATE_TOKEN } from "../../bootstrap/config";
import CommentRepository from "./repository";
import CommentService from "./service";
import CommentPolicy from "./policy";

const commentRepositoryToken = "comment.repository";
const commentServiceToken = "comment.service";
const commentPolicyToken = "comment.policy";

const commentProvider: ServiceProvider = {
  name: "comment.provider",
  register({ container }) {
    container.singleton(
      commentRepositoryToken,
      () => new CommentRepository(),
    );
    container.singleton(commentPolicyToken, () => new CommentPolicy());
  },
  boot({ container }) {
    container.singleton(
      commentServiceToken,
      () =>
        new CommentService(
          container.resolve(commentRepositoryToken),
          container.resolve("task.repository"),
        ),
    );

    const gate = container.resolve<{ register: (resource: string, policy: unknown) => void }>(
      CORE_POLICY_GATE_TOKEN,
    );
    gate.register("comment", container.resolve(commentPolicyToken));
  },
};

export default commentProvider;
export { commentRepositoryToken, commentServiceToken, commentPolicyToken };
