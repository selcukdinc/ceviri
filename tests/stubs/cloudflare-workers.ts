// Birim testlerinde Workflows çalışma zamanı yerine basit bir sınıf
export class WorkflowEntrypoint<E = unknown, P = unknown> {
  constructor(public ctx: unknown, public env: E) {}
  declare _p: P;
}
