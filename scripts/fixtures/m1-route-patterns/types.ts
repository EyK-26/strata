/** Data-only test inputs; these are not proposed framework route exports. */
export type Transport = "native" | "framework";
export interface Declaration {
  path: string;
  owner: string;
  kind?: "response" | "callback";
  methods?: { method: string; owner: string; status?: number }[];
}
export interface ProbeRequest {
  target: string;
  method?: string;
  deny?: boolean;
  expectedOwner?: string;
  expectedStatus?: number;
  expectedEmptyBody?: boolean;
}
export interface ProbeCase {
  name: string;
  classification: "contract-control" | "feasibility-observation";
  family: "transport" | "collector";
  declarations: Declaration[];
  requests: ProbeRequest[];
  collector?: "replace" | "alias" | "insertion" | "spread" | "orphan" | "repeat";
}
