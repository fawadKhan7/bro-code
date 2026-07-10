import * as os from "os";
import * as path from "path";

/** Home for all Duo state. DUO_HOME env var overrides (tests use temp dirs). */
export function duoHome(): string {
  return process.env.DUO_HOME ?? path.join(os.homedir(), ".duo");
}

export function sessionPath(): string {
  return path.join(duoHome(), "session.json");
}

export function configPath(): string {
  return path.join(duoHome(), "config.json");
}

export function historyDir(): string {
  return path.join(duoHome(), "history");
}

export function hubPidPath(): string {
  return path.join(duoHome(), "hub.pid");
}
