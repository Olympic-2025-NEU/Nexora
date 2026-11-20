// SPDX-License-Identifier: AGPL-3.0-only
export const PROCESS_KEY = "goods-issue-approval";

type Variable = { name: string; value: string | string[] | number; type?: string };
export type StartVariables = {
  approvalRequestId: string;
  documentId: string;
  creatorSub: string;
  warehouseIds: string[];
  submittedAt: string;
  submittedDocumentVersion: number;
  lineSnapshotSha256: string;
};
export type ProcessInstance = { id: string; businessKey: string; processDefinitionId: string; ended?: boolean };
export type Task = { id: string; taskDefinitionKey: string; name: string; processInstanceId: string; processDefinitionId: string; assignee?: string };
export type Definition = { id: string; key: string; version: number; deploymentId: string };
export type History = ProcessInstance & { endTime: string | null; deleteReason?: string | null; variables: Variable[]; endActivityIds: string[] };

export class FlowableHttpError extends Error {
  constructor(public readonly status: number, readonly detail = "") { super(`Flowable HTTP ${status}: ${detail}`); this.name = "FlowableHttpError"; }
}

export class FlowableUnknownOutcomeError extends Error {
  constructor(options: ErrorOptions) {
    super("Flowable POST outcome unknown; reconcile before retry", options);
    this.name = "FlowableUnknownOutcomeError";
  }
}

type Page<T> = { data: T[] };

export class FlowableClient {
  private readonly base: string;
  private readonly authorization: string;

  constructor(config: { baseUrl: string; user: string; password: string }, private readonly transport: typeof fetch = fetch) {
    if (!config.user || !config.password || !/^https?:\/\//.test(config.baseUrl)) throw new Error("Invalid Flowable configuration");
    this.base = `${config.baseUrl.replace(/\/$/, "")}/flowable-rest/service`;
    this.authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): FlowableClient {
    const base = env.FLOWABLE_BASE_URL || "http://flowable:8080/flowable-rest/service";
    return new FlowableClient({
      baseUrl: base.replace(/\/flowable-rest\/service\/?$/, ""),
      user: env.FLOWABLE_ADMIN_USER ?? "", password: env.FLOWABLE_ADMIN_PASSWORD ?? "",
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(`${this.base}${path}`, {
        method, headers: { authorization: this.authorization, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (method === "POST") throw new FlowableUnknownOutcomeError({ cause: error });
      throw error;
    }
    if (!response.ok) throw new FlowableHttpError(response.status, await response.text());
    return response.status === 204 || !response.headers.get("content-type")?.includes("json") ? undefined as T : response.json() as Promise<T>;
  }

  async startProcess({ businessKey, variables }: { businessKey: string; variables: StartVariables }): Promise<ProcessInstance> {
    if (!businessKey || businessKey !== variables.approvalRequestId) throw new Error("Invalid approvalRequestId businessKey");
    return this.request("POST", "/runtime/process-instances", {
      processDefinitionKey: PROCESS_KEY, businessKey,
      variables: Object.entries(variables).map(([name, value]) => ({ name, value })),
    });
  }

  async findInstanceByBusinessKey(businessKey: string): Promise<ProcessInstance | null> {
    const query = new URLSearchParams({ businessKey });
    const runtime = await this.request<Page<ProcessInstance>>("GET", `/runtime/process-instances?${query}`);
    if (runtime.data.length > 1) throw new Error("Duplicate Flowable businessKey");
    if (runtime.data.length) return runtime.data[0];
    const history = await this.request<Page<ProcessInstance>>("GET", `/history/historic-process-instances?${query}`);
    if (history.data.length > 1) throw new Error("Duplicate Flowable businessKey");
    return history.data[0] ?? null;
  }

  async findInstances(businessKey: string): Promise<ProcessInstance[]> {
    const params = new URLSearchParams({ businessKey, size: "201" });
    const [runtime, history] = await Promise.all([
      this.request<Page<ProcessInstance>>( "GET", `/runtime/process-instances?${params}`),
      this.request<Page<ProcessInstance>>( "GET", `/history/historic-process-instances?${params}`),
    ]);
    return [...new Map([...runtime.data, ...history.data].map((row) => [row.id, row])).values()];
  }

  getDefinition(id: string): Promise<Definition> {
    return this.request("GET", `/repository/process-definitions/${encodeURIComponent(id)}`);
  }

  getTask(id: string): Promise<Task> {
    return this.request("GET", `/runtime/tasks/${encodeURIComponent(id)}`);
  }

  async listRuntimeInstances(start = 0): Promise<ProcessInstance[]> {
    const params = new URLSearchParams({ processDefinitionKey: PROCESS_KEY, start: String(start), size: "200" });
    return (await this.request<Page<ProcessInstance>>("GET", `/runtime/process-instances?${params}`)).data;
  }

  getInstance(processInstanceId: string): Promise<ProcessInstance> {
    return this.request("GET", `/runtime/process-instances/${encodeURIComponent(processInstanceId)}`);
  }

  async queryTasks(query: { candidateGroup?: string; assignee?: string; processInstanceId?: string } = {}): Promise<Task[]> {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value) params.set(name, value);
    const result = await this.request<Page<Task>>("GET", `/runtime/tasks?${params}`);
    return result.data;
  }

  completeTask(taskId: string, input: { decision: "approved" | "rejected"; decisionReason?: string; approverSub: string; decidedAt: string }): Promise<void> {
    if (!["approved", "rejected"].includes(input.decision) ||
        (input.decision === "rejected" && !input.decisionReason?.trim()) ||
        !input.approverSub || !input.decidedAt) throw new Error("Invalid Flowable decision");
    const variables: Variable[] = [
      { name: "decision", value: input.decision },
      { name: "approverSub", value: input.approverSub },
      { name: "decidedAt", value: input.decidedAt },
    ];
    if (input.decisionReason) variables.push({ name: "decisionReason", value: input.decisionReason });
    return this.request("POST", `/runtime/tasks/${encodeURIComponent(taskId)}`, { action: "complete", variables });
  }

  cancelProcess(processInstanceId: string, deleteReason: string): Promise<void> {
    if (!deleteReason.trim()) throw new Error("deleteReason required");
    return this.request("DELETE", `/runtime/process-instances/${encodeURIComponent(processInstanceId)}?${new URLSearchParams({ deleteReason })}`);
  }

  async getHistory(processInstanceId: string): Promise<History> {
    const id = encodeURIComponent(processInstanceId);
    const [instance, activities, variables] = await Promise.all([
      this.request<Omit<History, "endActivityIds">>("GET", `/history/historic-process-instances/${id}`),
      this.request<Page<{ activityId: string; activityType: string }>>("GET", `/history/historic-activity-instances?${new URLSearchParams({ processInstanceId })}`),
      this.request<Page<{ variable: Variable }>>("GET", `/history/historic-variable-instances?${new URLSearchParams({ processInstanceId })}`),
    ]);
    return { ...instance, variables: variables.data.map((row) => row.variable),
      endActivityIds: activities.data.filter((row) => row.activityType === "endEvent").map((row) => row.activityId) };
  }

  async latestDefinition(): Promise<Definition | null> {
    const page = await this.request<Page<Definition>>("GET", `/repository/process-definitions?${new URLSearchParams({ key: PROCESS_KEY, latest: "true" })}`);
    return page.data[0] ?? null;
  }
}
