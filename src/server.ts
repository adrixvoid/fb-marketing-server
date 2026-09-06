import { createRuntime, loadProductionEnvironment } from "./runtime.js";
import { MacOSKeychainSecretProvider } from "./secrets.js";
import { registerShutdownHandlers } from "./shutdown.js";

const secrets = new MacOSKeychainSecretProvider("fb-marketing-server");
const { serviceToken, ownerIdentity, port } = await loadProductionEnvironment(secrets, process.env);
const app = await createRuntime({ serviceToken, ownerIdentity, secretProvider: secrets });
registerShutdownHandlers(app);
await app.listen({ host: "127.0.0.1", port });
