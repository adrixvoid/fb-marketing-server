# Private operation and outbound chat access

Users interact only through OpenClaw outbound chat channels. `fb-marketing-server` remains on `127.0.0.1`, and OpenClaw is its only caller. Never forward, proxy, or publish either local API for user access.

## Install the service

Compiled local startup reads `openclaw-service-token` and `openclaw-owner-identity` from the `fb-marketing-server` login Keychain. The LaunchAgent contains no secrets.

```bash
npm run service:install
npm run service:status
```

The installer builds first, precreates the private data/log directories and mode-`0600` logs, atomically writes a mode-`0600` plist, validates it with `/usr/bin/plutil`, and loads it in the current user domain. It uses absolute Node/project paths because LaunchAgents do not load shell profiles. It starts at login and restarts after an unexpected nonzero exit, with a 30-second throttle to prevent rapid restart loops. A clean exit remains stopped until login, manual kickstart, or reinstall.

Logs are under `~/Library/Logs/fb-marketing-server/`. Remove only this job and plist with `npm run service:uninstall`.

## Verify health without exposing the bearer

Keep the token in a non-exported shell variable, pass the header through curl configuration on stdin, then unset it:

```bash
SERVICE_TOKEN="$(security find-generic-password -s fb-marketing-server -a openclaw-service-token -w)"
printf 'header = "Authorization: Bearer %s"\n' "$SERVICE_TOKEN" | \
  curl --config - --fail --silent --show-error --url http://127.0.0.1:3000/health
unset SERVICE_TOKEN
```

The secret is not in curl argv, shell history, a persisted environment export, or command output.

## User and administrator boundaries

- Users reach capabilities through configured OpenClaw outbound chat channels only.
- Tailscale or SSH may provide authenticated administrative shell access to the Mac only.
- Both local APIs remain loopback-only and are never user-access boundaries.
- Keep the macOS firewall enabled and router ingress disabled.
- Keep FileVault enabled and the login Keychain available only to the LaunchAgent user session.
- If the user logs out or Keychain access fails, repair local access; never copy secrets into files or process arguments.

## Rotate the service token

Update the Keychain item and the protected plugin configuration together, then restart both processes. A mismatch intentionally fails closed. Never put service credentials in a plist, `.env`, repository, model schema, prompt, or log.

## Backup and restore

Backups stay under the private application data root. The command refuses paths outside it and existing destinations.

```bash
DATA="$HOME/Library/Application Support/fb-marketing-server"
mkdir -m 700 -p "$DATA/backups"
npm run db -- backup "$DATA/backups/state-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Restore stops the service and publishes only to a new file:

```bash
DATA="$HOME/Library/Application Support/fb-marketing-server"
npm run service:uninstall
if [ -e "$DATA/state.pre-restore.sqlite" ] || [ -L "$DATA/state.pre-restore.sqlite" ]; then
  printf '%s\n' 'Refusing restore: state.pre-restore.sqlite already exists.' >&2
  exit 1
fi
mv -n "$DATA/state.sqlite" "$DATA/state.pre-restore.sqlite"
npm run db -- restore "$DATA/backups/<verified-backup>.sqlite" "$DATA/state.sqlite"
npm run service:install
npm run service:status
```

If `state.pre-restore.sqlite` already exists, stop and verify or relocate it before retrying; never overwrite it. If health fails, uninstall, remove the failed restored file, move `state.pre-restore.sqlite` back, and reinstall. Never restore while the service is running.

## Checklist

- [ ] Both local services listen only on loopback.
- [ ] Users access only an allowlisted OpenClaw outbound chat channel.
- [ ] Service and Meta credentials never enter prompts, tools, argv, logs, or Git.
- [ ] The deterministic owner command boundary authorizes every mutation.
- [ ] FileVault, firewall, private file modes, Keychain access, and backup restore are verified.
