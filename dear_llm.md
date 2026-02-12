# Agent Notes for health-skillz

## Server Configuration

This VM (`cobra-traceroute.exe.xyz`) runs the **vnext** branch.

- The server runs via **systemd**: `sudo systemctl restart health-skillz`
- The systemd unit sets `CONFIG_PATH=./config.vnext.json` — do NOT change this.
- **Never start the server manually without `CONFIG_PATH=./config.vnext.json`.**
  Bare `bun run dev` defaults to `config.json` which points at the **production**
  domain (`health-skillz.joshuamandel.com`) on a different VM (`s003.exe.xyz`).

### Config files

| File | baseURL | Purpose |
|---|---|---|
| `config.json` | `https://health-skillz.joshuamandel.com` | Production (different VM — do not use here) |
| `config.vnext.json` | `https://health-skillz-vnext.joshuamandel.com` | **This VM** — vnext branch |
| `config.local.json` | `http://localhost:3000` | Local dev with separate OAuth client IDs |

### DNS mapping

- `health-skillz.joshuamandel.com` → `s003.exe.xyz` (production, NOT this VM)
- `health-skillz-vnext.joshuamandel.com` → `cobra-traceroute.exe.xyz` (this VM)

### To restart the server

```bash
sudo systemctl restart health-skillz
journalctl -u health-skillz -f   # watch logs
```

Verify the startup log says `Base URL: https://health-skillz-vnext.joshuamandel.com`.
