import {
  expectObject,
  parseJsonBody,
  parsePaginationQuery,
  parsePositiveIntParam,
  readRequiredString,
} from "../../core/http";

type CommentIdParams = { id: string };
type TaskCommentParams = { id: string };

interface CommentListQueryDto {
  page: number;
  perPage: number;
}

interface CreateCommentBodyDto {
  body: string;
}

function parseCommentIdParams(params: CommentIdParams): { id: number } {
  return {
    id: parsePositiveIntParam(params.id, "comment id"),
  };
}

function parseTaskCommentParams(params: TaskCommentParams): { taskId: number } {
  return {
    taskId: parsePositiveIntParam(params.id, "task id"),
  };
}

function parseCommentListQuery(request?: Request): CommentListQueryDto {
  return parsePaginationQuery(request);
}

async function parseCreateCommentBody(
  request: Request,
): Promise<CreateCommentBodyDto> {
  return await parseJsonBody(request, (payload) => {
    const body = expectObject(payload);

    return {
      body: readRequiredString(body, "body", { minLength: 1, maxLength: 4000 }),
    };
  });
}

export {
  parseCommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
};
export type {
  CommentIdParams,
  CommentListQueryDto,
  CreateCommentBodyDto,
  TaskCommentParams,
};
