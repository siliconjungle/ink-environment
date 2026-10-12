export type Artifact = {
  javascript: string;
  manifest: any;
  core: string;
  compileMs: number;
  compilerLoadMs: number;
  bundle?: any;
  bundleUrl?: string;
  host_reason?: string;
  wasmBytes?: number;
};
type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class Compiler {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  constructor(
    private url: string,
    private progress: (message: string) => void = () => {},
  ) {}
  private request(request: unknown): Promise<any> {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./compiler-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        if (data.progress) {
          this.progress(data.progress);
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        data.error ? pending.reject(Error(data.error)) : pending.resolve(data);
      };
      this.worker.onerror = (event) =>
        this.stop(event.message || "Compiler worker failed.");
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.stop(
            "Compilation/validation exceeded 180 seconds. Reduce this program or input.",
          ),
        180000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, compilerUrl: this.url, request });
    });
  }
  async compile(source: string, contractEvidence?: unknown): Promise<Artifact> {
    const data = await this.request({ op: "compile", source, ...(contractEvidence === undefined ? {} : { contractEvidence }) });
    return {
      ...data.ok,
      compileMs: data.elapsedMs,
      compilerLoadMs: data.loadMs,
    };
  }
  async prepare(artifact: Artifact, entry: string, input: string) {
    const data = await this.request({
      op: "prepare",
      core: artifact.core,
      identity: artifact.manifest.core_sha256,
      entry,
      input,
    });
    return { input: data.ok.input, validationMs: data.elapsedMs };
  }
  stop(message = "Stopped.") {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error(message));
    }
    this.pending.clear();
  }
}
export class Runner {
  private cleanup?: () => void;
  constructor(_base: string) {}
  run(
    artifact: Artifact,
    entry: string,
    input: string,
    benchmark: boolean,
    progress: (n: any) => void,
    settings: any = {},
  ): Promise<any> {
    this.stop();
    const worker = new Worker(new URL("./run-worker.ts", import.meta.url), {
      type: "module",
    });
    return new Promise((resolve, reject) => {
      const finish = (error: Error | null, value?: unknown) => {
        clearTimeout(timer);
        worker.terminate();
        this.cleanup = undefined;
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () => finish(Error("Run exceeded 120 seconds. Reduce the workload.")),
        120000,
      );
      this.cleanup = () => finish(Error("Stopped."));
      worker.onmessage = ({ data }) => {
        if (data.progress) {
          progress(data.progress);
          return;
        }
        finish(data.error ? Error(data.error) : null, data.ok);
      };
      worker.onerror = (event) =>
        finish(Error(event.message || "Execution worker failed."));
      worker.postMessage({ artifact, entry, input, benchmark, settings });
    });
  }
  stop() {
    this.cleanup?.();
  }
}
