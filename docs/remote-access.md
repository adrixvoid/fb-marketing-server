# Secure remote access

Keep `fb-marketing-server` private. It should listen only on `127.0.0.1`; OpenClaw is the authenticated gateway, and remote users reach OpenClaw through a private network.

## Recommended topology

```text
Remote chat/user
      |
      | Tailscale (private tailnet)
      v
OpenClaw Gateway (token authentication)
      |
      | localhost HTTP + internal service token
      v
fb-marketing-server (127.0.0.1 only)
      |
      | HTTPS
      v
Meta Marketing API
```

Do not expose `fb-marketing-server` directly through a public IP, router port forwarding, Tailscale Funnel, or a public reverse proxy.

## OpenClaw configuration

Configure OpenClaw to remain bound to loopback, require token authentication, and use Tailscale Serve for private remote access:

```bash
openclaw config set gateway.bind loopback
openclaw config set gateway.auth.mode token
openclaw doctor --generate-gateway-token
openclaw config set gateway.tailscale.mode serve
openclaw config set gateway.trustedProxies '["127.0.0.1"]'
openclaw gateway restart
```

Notes:

- `serve` exposes the gateway only inside the authenticated Tailscale network.
- Do not use `funnel`; it publishes the service to the public Internet.
- `trustedProxies` handles local proxy headers. It does not replace gateway authentication.
- Store the generated gateway token outside the repository and never include it in logs or AI prompts.

## fb-marketing-server configuration

The application must use a loopback host and a separate internal service token. Generate `OPENCLAW_SERVICE_TOKEN` cryptographically at random outside the repository, store it in macOS Keychain or inject it through a protected SecretRef/runtime mechanism, and restrict access to the OpenClaw plugin and `fb-marketing-server` processes.

This `.env` fragment is illustrative only; a persisted `.env` is not the recommended secret location:

```dotenv
HOST=127.0.0.1
PORT=3000
OPENCLAW_SERVICE_TOKEN=<runtime-injected-random-secret>
```

Every request from OpenClaw should include the service credential:

```http
Authorization: Bearer <OPENCLAW_SERVICE_TOKEN>
```

`fb-marketing-server` must reject requests with a missing or invalid credential even though both services run on the same machine. The service token is separate from all Meta access tokens. Exclude any fallback secret file from Git, apply restrictive file/ACL permissions, rotate the token after suspected exposure and on the operating schedule, and never place it in prompts, model tools, command output, or logs.

## Remote access checklist

- [ ] `fb-marketing-server` listens on `127.0.0.1`, not `0.0.0.0`.
- [ ] OpenClaw uses `gateway.bind=loopback`.
- [ ] OpenClaw gateway token authentication is enabled.
- [ ] Remote access uses Tailscale Serve, not Funnel.
- [ ] Tailscale users and devices are explicitly authorized.
- [ ] OpenClaw and `fb-marketing-server` use a dedicated internal service token.
- [ ] The service token is injected from protected storage, excluded from Git, access-restricted, and covered by rotation procedures.
- [ ] Meta access tokens never leave `fb-marketing-server`.
- [ ] Logs redact authorization headers, Meta tokens, and app secrets.
- [ ] Approval uses the deterministic, owner-only command boundary defined in [Target architecture](architecture.md#approval-identity-and-command-boundary).
- [ ] Firewall and router port forwarding do not expose either local service.

## SSH tunnel fallback

For temporary administrative access without Tailscale, forward a local port over SSH:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@server
```

Then access OpenClaw through `127.0.0.1:18789` on the administrator's machine. Keep gateway authentication enabled. This is appropriate for occasional administration, not as the primary chat integration.

## Verification

On the server, confirm that neither service listens on a public interface:

```bash
lsof -nP -iTCP -sTCP:LISTEN
```

Expected listeners include `127.0.0.1:18789` for OpenClaw and `127.0.0.1:3000` for `fb-marketing-server`. Any listener on `0.0.0.0` or a public interface must be reviewed.

## References

- [OpenClaw Gateway CLI](https://docs.openclaw.ai/cli/gateway)
- [OpenClaw secrets management](https://docs.openclaw.ai/gateway/secrets)
- [OpenClaw remote access](https://docs.openclaw.ai/gateway/remote)
- [OpenClaw Tailscale](https://docs.openclaw.ai/gateway/tailscale)
