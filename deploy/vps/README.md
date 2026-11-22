# Dev agent on a VPS

Runs the backend with the dev agent enabled on an Ubuntu/Debian server, behind HTTPS, so the
live `/admin/dev` page (Netlify) can use it.

## 1. On the server
```sh
git clone https://github.com/nandhakumarbmdev/chai_time.git && cd chai_time/deploy/vps
sudo ./setup.sh agent.example.com     # your domain; its DNS A record must point at this server
```
It installs Node 22, git, the `claude` CLI and Caddy (HTTPS), creates a `chai` service user, and
starts a systemd service `chai-dev-agent`. It prints a generated `ADMIN_KEY`.

## 2. Fill in the secrets
Edit `/etc/chai-dev-agent.env` (root-only, mode 600):
- `MONGODB_URI`: same database the app uses
- `ANTHROPIC_API_KEY`: for the agent
- `GITHUB_TOKEN`: fine-grained token, only the `chai_time` repo, **Contents: Read and write**

```sh
sudo systemctl restart chai-dev-agent
curl https://agent.example.com/api/dev/status    # {"enabled":true,"keyRequired":true,...}
```

## 3. Point the page at it
Netlify → Site configuration → Environment variables: `VITE_DEV_API_URL=https://agent.example.com`,
then trigger a deploy. Open `/admin/dev`, paste the `ADMIN_KEY`.

## Day to day
- Logs: `journalctl -u chai-dev-agent -f`
- Update the server's code: `sudo -u chai git -C /opt/chai_time pull && sudo systemctl restart chai-dev-agent`
  (the agent works from a fresh `origin/main` for each job, but the running server code only updates this way)
- `DEV_DEPLOY=branch` (default here) pushes `dev/<id>` branches; merge on GitHub to deploy.
  Set `DEV_DEPLOY=main` only once you trust it: a passing job then goes straight to production.
- Rotate the key: change `ADMIN_KEY` in the env file and restart.
