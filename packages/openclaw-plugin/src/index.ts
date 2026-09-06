import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { mergeInboundPathRoots } from "openclaw/plugin-sdk/channel-inbound";
import {
  TOOL_NAMES,
  createGatewayClient,
  createKeychainSecretProvider,
  createOpenClawRegistration,
  createStageMediaCommandHandler,
  parsePluginConfig,
} from "./core.js";

function register(api: OpenClawPluginApi) {
  const config = parsePluginConfig(api.pluginConfig);
  const roots = mergeInboundPathRoots(config.attachmentRoots);
  const secret = createKeychainSecretProvider(config.keychainService, config.timeoutMs);
  const gateway = createGatewayClient({
    baseUrl: config.baseUrl,
    getServiceToken: () => secret(config.serviceTokenAccount),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  const gatewayWithSecrets = { ...gateway, secret };
  const handleStageMediaCommand = createStageMediaCommandHandler();

  api.on("inbound_claim", (event, context) => {
    const ownerAllowFrom = api.config.commands?.ownerAllowFrom?.filter((value): value is string => typeof value === "string");
    return handleStageMediaCommand({
      event,
      context,
      config: { ...config, attachmentRoots: roots },
      ...(ownerAllowFrom === undefined ? {} : { ownerAllowFrom }),
      gateway: gatewayWithSecrets,
    });
  });

  api.registerTool(() => createOpenClawRegistration({ config, gateway: gatewayWithSecrets }).tools as never, { names: [...TOOL_NAMES] });
  for (const command of createOpenClawRegistration({ config, gateway: gatewayWithSecrets }).commands) api.registerCommand(command as never);
}

export default definePluginEntry({
  id: "fb-marketing-server",
  name: "Meta Ads Local Gateway",
  description: "Curated Meta Ads tools and deterministic owner commands for the loopback gateway.",
  configSchema: {
    validate(value) {
      try { return { ok: true, value: parsePluginConfig(value) }; }
      catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : "Invalid configuration"] }; }
    },
  },
  register,
});

export { register };
