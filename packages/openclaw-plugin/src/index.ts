import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { mergeInboundPathRoots } from "openclaw/plugin-sdk/channel-inbound";
import {
  TOOL_NAMES,
  TrustedAttachmentStore,
  attachmentContextKey,
  createGatewayClient,
  createKeychainSecretProvider,
  createOpenClawRegistration,
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
  const attachments = new TrustedAttachmentStore(roots);

  api.on("inbound_claim", (event, context) => {
    const metadata = event.metadata ?? {};
    const paths = Array.isArray(metadata.mediaPaths) ? metadata.mediaPaths.filter((path): path is string => typeof path === "string") : [];
    const types = Array.isArray(metadata.mediaTypes) ? metadata.mediaTypes.filter((type): type is string => typeof type === "string") : [];
    if (paths.length > 0) attachments.capture(attachmentContextKey({
      channel: context.channelId,
      account: context.accountId,
      conversation: context.conversationId,
      sender: context.senderId,
    }), paths, types, { channel: context.channelId, ...(context.messageId === undefined ? {} : { messageId: context.messageId }) });
    return { handled: false };
  });

  api.registerTool((toolContext) => createOpenClawRegistration({ config, gateway: gatewayWithSecrets, attachments, toolContext }).tools as never, { names: [...TOOL_NAMES] });
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
