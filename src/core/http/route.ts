type RouteRequest<TParams extends Record<string, string>> = Request & {
  params: TParams;
};

function getRouteParams<TParams extends Record<string, string>>(
  request: RouteRequest<TParams>,
): TParams {
  return request.params;
}

export type { RouteRequest };
export { getRouteParams };
