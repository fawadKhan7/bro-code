import * as os from "os";
import * as path from "path";

export function conductorHome(): string {
  return path.join(os.homedir(), ".conductor");
}

export function configPath(): string {
  return path.join(conductorHome(), "config.json");
}

export function sessionPath(): string {
  return path.join(conductorHome(), "session.json");
}
