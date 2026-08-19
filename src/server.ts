import { createRuntime, runtimeEnvironment } from "./runtime.js";

const { serviceToken, ownerIdentity, port } = runtimeEnvironment(process.env);
const app = await createRuntime({ serviceToken, ownerIdentity });
await app.listen({ host: "127.0.0.1", port });
