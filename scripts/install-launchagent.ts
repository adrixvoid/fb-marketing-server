import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const LABEL = "com.gentleman-programming.fb-marketing-server";

export function launchAgentPaths(home = homedir()) {
  const dataRoot = join(home, "Library", "Application Support", "fb-marketing-server");
  const logRoot = join(home, "Library", "Logs", "fb-marketing-server");
  return {
    dataRoot,
    logRoot,
    plistPath: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    stdoutPath: join(logRoot, "stdout.log"),
    stderrPath: join(logRoot, "stderr.log"),
  };
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function renderLaunchAgent(input: {
  nodePath: string;
  projectRoot: string;
  paths: ReturnType<typeof launchAgentPaths>;
}) {
  if (!isAbsolute(input.nodePath) || !isAbsolute(input.projectRoot)) throw new Error("LaunchAgent paths must be absolute");
  const server = join(input.projectRoot, "dist", "src", "server.js");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(input.nodePath)}</string><string>${xml(server)}</string></array>
  <key>WorkingDirectory</key><string>${xml(input.projectRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(input.paths.stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(input.paths.stderrPath)}</string>
</dict>
</plist>
`;
}

interface RunOptions { cwd?: string; allowFailure?: boolean }
interface RunResult { code: number; stdout: string }
type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

const run: Run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let size = 0;
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    size += chunk.length;
    if (size > 1024 * 1024) child.kill("SIGKILL");
    else target.push(chunk);
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  child.once("error", reject);
  child.once("close", (code) => {
    const result = { code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8") };
    if (result.code === 0 || options.allowFailure) resolve(result);
    else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} failed`));
  });
});

async function atomicWrite(path: string, content: string | Buffer) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function installLaunchAgent(
  input: { home?: string; projectRoot: string; nodePath?: string; uid?: number; skipBuild?: boolean },
  dependencies: { run?: Run } = {},
) {
  const home = input.home ?? homedir();
  const nodePath = input.nodePath ?? process.execPath;
  if (!isAbsolute(home) || !isAbsolute(input.projectRoot) || !isAbsolute(nodePath)) throw new Error("Install paths must be absolute");
  const paths = launchAgentPaths(home);
  const execute = dependencies.run ?? run;
  const uid = input.uid ?? process.getuid?.();
  if (uid === undefined) throw new Error("Unable to resolve user ID");
  const domain = `gui/${uid}`;
  const priorStatus = await execute("/bin/launchctl", ["print", `${domain}/${LABEL}`], { allowFailure: true });
  const priorActive = priorStatus.code === 0;
  if (!input.skipBuild) await execute(nodePath, ["--run", "build"], { cwd: input.projectRoot });
  await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
  await mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
  await mkdir(paths.logRoot, { recursive: true, mode: 0o700 });
  await chmod(paths.dataRoot, 0o700);
  await chmod(paths.logRoot, 0o700);
  for (const log of [paths.stdoutPath, paths.stderrPath]) {
    await writeFile(log, "", { flag: "a", mode: 0o600 });
    await chmod(log, 0o600);
  }
  const plist = renderLaunchAgent({ nodePath, projectRoot: input.projectRoot, paths });
  const previous = await readFile(paths.plistPath).catch(() => undefined);
  await atomicWrite(paths.plistPath, plist);
  try {
    await execute("/usr/bin/plutil", ["-lint", paths.plistPath]);
    await execute("/bin/launchctl", ["bootout", domain, paths.plistPath], { allowFailure: true });
    await execute("/bin/launchctl", ["bootstrap", domain, paths.plistPath]);
    await execute("/bin/launchctl", ["kickstart", "-k", `${domain}/${LABEL}`]);
  } catch (error) {
    await execute("/bin/launchctl", ["bootout", domain, paths.plistPath], { allowFailure: true });
    if (previous) await atomicWrite(paths.plistPath, previous);
    else await rm(paths.plistPath, { force: true });
    if (previous && priorActive) {
      await execute("/bin/launchctl", ["bootstrap", domain, paths.plistPath]);
      await execute("/bin/launchctl", ["kickstart", "-k", `${domain}/${LABEL}`]);
    }
    throw error;
  }
  return paths;
}

export async function uninstallLaunchAgent(input: { home?: string; uid?: number }, dependencies: { run?: Run } = {}) {
  const home = input.home ?? homedir();
  const paths = launchAgentPaths(home);
  const uid = input.uid ?? process.getuid?.();
  if (uid === undefined) throw new Error("Unable to resolve user ID");
  await (dependencies.run ?? run)("/bin/launchctl", ["bootout", `gui/${uid}`, paths.plistPath], { allowFailure: true });
  await rm(paths.plistPath, { force: true });
}

export async function statusLaunchAgent(input: { uid?: number } = {}, dependencies: { run?: Run } = {}) {
  const uid = input.uid ?? process.getuid?.();
  if (uid === undefined) throw new Error("Unable to resolve user ID");
  return (dependencies.run ?? run)("/bin/launchctl", ["print", `gui/${uid}/${LABEL}`], { allowFailure: true });
}

async function main() {
  const action = process.argv[2] ?? "status";
  const projectRoot = process.cwd();
  if (action === "install") await installLaunchAgent({ projectRoot });
  else if (action === "uninstall") await uninstallLaunchAgent({});
  else if (action === "status") {
    const result = await statusLaunchAgent();
    process.stdout.write(result.stdout);
    process.exitCode = result.code;
  } else throw new Error("Usage: install-launchagent.ts install|uninstall|status");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
