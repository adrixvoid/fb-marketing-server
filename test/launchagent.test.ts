import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  installLaunchAgent,
  launchAgentPaths,
  renderLaunchAgent,
  uninstallLaunchAgent,
} from "../scripts/install-launchagent.js";
import { registerShutdownHandlers } from "../src/shutdown.js";

const execFileAsync = promisify(execFile);

test("renders a private user LaunchAgent with absolute paths, no secrets, and crash-loop throttling", () => {
  const paths = launchAgentPaths("/Users/Ada User");
  const plist = renderLaunchAgent({
    nodePath: "/opt/node 24/bin/node",
    projectRoot: "/Users/Ada User/Sites/fb & ads",
    paths,
  });

  assert.match(plist, /<string>\/opt\/node 24\/bin\/node<\/string>/);
  assert.match(plist, /fb &amp; ads/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /KeepAlive|SuccessfulExit/);
  assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
  assert.match(plist, /<key>Umask<\/key>\s*<integer>63<\/integer>/);
  assert.match(plist, /Library\/Logs\/fb-marketing-server\/stdout\.log/);
  assert.doesNotMatch(plist, /TOKEN|SECRET|Authorization|OPENCLAW_OWNER/);
});

test("rendered LaunchAgent passes the native macOS plist validator", async () => {
  const root = await mkdtemp(join(tmpdir(), "launchagent-plutil-"));
  const path = join(root, "service.plist");
  await writeFile(path, renderLaunchAgent({ nodePath: "/opt/node/bin/node", projectRoot: "/Users/Ada User/fb-server", paths: launchAgentPaths("/Users/Ada User") }));
  const result = await execFileAsync("/usr/bin/plutil", ["-lint", path]);
  assert.match(result.stdout, /OK/);
});

test("temp install is idempotent, validates before bootstrap, and uninstall removes only its plist", async () => {
  const home = await mkdtemp(join(tmpdir(), "launchagent-home-"));
  const projectRoot = join(home, "Project With Spaces");
  const nodePath = join(home, "Node 24", "node");
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const run = async (command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean }) => {
    calls.push({ command, args, ...(options?.cwd ? { cwd: options.cwd } : {}) });
    return { code: 0, stdout: "ok" };
  };
  await installLaunchAgent({ home, projectRoot, nodePath, uid: 501 }, { run });
  const first = await readFile(launchAgentPaths(home).plistPath, "utf8");
  await installLaunchAgent({ home, projectRoot, nodePath, uid: 501 }, { run });
  const second = await readFile(launchAgentPaths(home).plistPath, "utf8");

  assert.equal(second, first);
  assert.equal((await stat(launchAgentPaths(home).plistPath)).mode & 0o777, 0o600);
  assert.equal((await stat(launchAgentPaths(home).stdoutPath)).mode & 0o777, 0o600);
  assert.equal((await stat(launchAgentPaths(home).stderrPath)).mode & 0o777, 0o600);
  assert.deepEqual(calls.slice(0, 5).map(({ command, args }) => [command, args[0]]), [
    ["/bin/launchctl", "print"],
    [nodePath, "--run"],
    ["/usr/bin/plutil", "-lint"],
    ["/bin/launchctl", "bootout"],
    ["/bin/launchctl", "bootstrap"],
  ]);
  await uninstallLaunchAgent({ home, uid: 501 }, { run });
  await assert.rejects(access(launchAgentPaths(home).plistPath));
});

test("failed bootstrap restores the previous plist", async () => {
  const home = await mkdtemp(join(tmpdir(), "launchagent-rollback-"));
  const paths = launchAgentPaths(home);
  await writeFile(paths.plistPath, "previous", { mode: 0o600 }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
    await writeFile(paths.plistPath, "previous", { mode: 0o600 });
  });
  const calls: string[] = [];
  let bootstraps = 0;
  const run = async (command: string, args: string[], options?: { allowFailure?: boolean }) => {
    calls.push(`${command} ${args[0]}`);
    if (command === "/bin/launchctl" && args[0] === "print") return { code: 0, stdout: "active" };
    if (command === "/bin/launchctl" && args[0] === "bootstrap" && bootstraps++ === 0) throw new Error("bootstrap failed");
    return { code: 0, stdout: "" };
  };
  await assert.rejects(installLaunchAgent({ home, projectRoot: "/project", nodePath: "/node", uid: 501, skipBuild: true }, { run }), /bootstrap failed/);
  assert.equal(await readFile(paths.plistPath, "utf8"), "previous");
  assert.deepEqual(calls.slice(-3), ["/bin/launchctl bootout", "/bin/launchctl bootstrap", "/bin/launchctl kickstart"]);
});

test("failed candidate kickstart reloads a previously active job", async () => {
  const home = await mkdtemp(join(tmpdir(), "launchagent-active-kickstart-"));
  const paths = launchAgentPaths(home);
  await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
  await writeFile(paths.plistPath, "previous", { mode: 0o600 });
  const calls: string[] = [];
  let kickstarts = 0;
  const run = async (command: string, args: string[]) => {
    calls.push(`${command} ${args[0]}`);
    if (command === "/bin/launchctl" && args[0] === "print") return { code: 0, stdout: "active" };
    if (command === "/bin/launchctl" && args[0] === "kickstart" && kickstarts++ === 0) throw new Error("kickstart failed");
    return { code: 0, stdout: "" };
  };
  await assert.rejects(installLaunchAgent({ home, projectRoot: "/project", nodePath: "/node", uid: 501, skipBuild: true }, { run }), /kickstart failed/);
  assert.equal(await readFile(paths.plistPath, "utf8"), "previous");
  assert.deepEqual(calls.slice(-3), ["/bin/launchctl bootout", "/bin/launchctl bootstrap", "/bin/launchctl kickstart"]);
});

test("fresh install and kickstart failures unload candidates without loading absent prior jobs", async () => {
  for (const failing of ["bootstrap", "kickstart"]) {
    const home = await mkdtemp(join(tmpdir(), `launchagent-${failing}-`));
    await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      calls.push(`${command} ${args[0]}`);
      if (command === "/bin/launchctl" && args[0] === "print") return { code: 113, stdout: "" };
      if (command === "/bin/launchctl" && args[0] === failing) throw new Error(`${failing} failed`);
      return { code: 0, stdout: "" };
    };
    await assert.rejects(installLaunchAgent({ home, projectRoot: "/project", nodePath: "/node", uid: 501, skipBuild: true }, { run }), new RegExp(`${failing} failed`));
    await assert.rejects(access(launchAgentPaths(home).plistPath));
    assert.equal(calls.filter((call) => call === "/bin/launchctl bootout").length, 2);
    assert.equal(calls.filter((call) => call === "/bin/launchctl bootstrap").length, failing === "bootstrap" ? 1 : 1);
  }
});

test("SIGTERM and SIGINT close the application once", async () => {
  const handlers = new Map<string, () => void>();
  let closes = 0;
  const dispose = registerShutdownHandlers({ close: async () => { closes += 1; } }, { once: (signal, handler) => { handlers.set(signal, handler); } });
  handlers.get("SIGTERM")!();
  handlers.get("SIGINT")!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  dispose();
});

test("operations docs keep bearer off argv and expose users only through outbound chat", async () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const docs = `${await read("README.md")}\n${await read("docs/remote-access.md")}\n${await read("docs/openclaw-local-setup.md")}`;
  assert.doesNotMatch(docs, /Tailscale Serve|Tailscale Funnel|ssh -N|-L \d+|gateway\.tailscale|API forwarding/i);
  assert.match(docs, /OpenClaw outbound chat channels/i);
  assert.match(docs, /SERVICE_TOKEN=.*security find-generic-password/);
  assert.match(docs, /curl --config -/);
  assert.match(docs, /unset SERVICE_TOKEN/);
  assert.doesNotMatch(docs, /export OPENCLAW_SERVICE_TOKEN|curl[^\n]*Authorization: Bearer/);
  assert.match(docs, /npm run build[\s\S]*npm pack[\s\S]*openclaw plugins install/);
  assert.match(docs, /ownerAllowFrom/);
});
