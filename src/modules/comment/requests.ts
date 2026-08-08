import {
  FormRequest,
  parsePaginationQuery,
  parsePositiveIntParam,
  QueryFormRequest,
} from "../../core/http";
import {
  maxLength,
  minLength,
  required,
  stringRule,
  validateObject,
} from "../../core/validation/rules";

type CommentIdParams = { id: string };
type TaskCommentParams = { id: string };

interface CommentListQueryDto {
  page: number;
  perPage: number;
}

interface CreateCommentBodyDto {
  body: string;
}

interface UpdateCommentBodyDto {
  body: string;
}

class CommentListQueryRequest extends QueryFormRequest<CommentListQueryDto> {
  protected parseQuery(request?: Request): CommentListQueryDto {
    return parsePaginationQuery(request);
  }
}

class CreateCommentRequest extends FormRequest<CreateCommentBodyDto> {
  protected parse(payload: unknown): CreateCommentBodyDto {
    const validated = validateObject(payload, {
      body: [required(), stringRule(), minLength(1), maxLength(4000)],
    });

    return {
      body: validated.body as string,
    };
  }
}

class UpdateCommentRequest extends FormRequest<UpdateCommentBodyDto> {
  protected parse(payload: unknown): UpdateCommentBodyDto {
    const validated = validateObject(payload, {
      body: [required(), stringRule(), minLength(1), maxLength(4000)],
    });

    return {
      body: validated.body as string,
    };
  }
}

const commentListQueryRequest = new CommentListQueryRequest();
const createCommentRequest = new CreateCommentRequest();
const updateCommentRequest = new UpdateCommentRequest();

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
  return commentListQueryRequest.validate(request);
}

async function parseCreateCommentBody(request: Request): Promise<CreateCommentBodyDto> {
  return await createCommentRequest.validate(request);
}

async function parseUpdateCommentBody(request: Request): Promise<UpdateCommentBodyDto> {
  return await updateCommentRequest.validate(request);
}

export type {
  CommentIdParams,
  CommentListQueryDto,
  CreateCommentBodyDto,
  TaskCommentParams,
  UpdateCommentBodyDto,
};
export {
  CommentListQueryRequest,
  CreateCommentRequest,
  parseCommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
  parseUpdateCommentBody,
  UpdateCommentRequest,
};
