# ScreenShare Operations

Self-hosted screen recording and share-link workspace (a Cap fork), running on
this machine under Docker and published through the shared Cloudflare tunnel.

- **Local:** <http://localhost:3003> — signed in automatically as the owner.
- **Public:** <https://screenshare.rocstarrmedia.com> — this is what the portal
  tile opens, and what share links point at.
- **Media:** <https://screenshare-media.rocstarrmedia.com> — object storage.
  Recordings are served from here via presigned URLs.

## Architecture

| Container | Role |
| --- | --- |
| `cap-web` | Next.js app: dashboard, share pages, API, background workflows |
| `cap-media-server` | ffmpeg transcode, thumbnails, animated previews |
| `cap-mysql` | Titles, share settings, comments, analytics, folders |
| `cap-minio` | The video files themselves (S3-compatible) |

Both `cap-mysql` and `cap-minio` keep their data in Docker volumes on this PC.
That is the only copy — see [Backups](#backups).

## Access model

Two different doors, deliberately:

**On this machine** (`Host` is `localhost` / `127.0.0.1`), `SCREENSHARE_DISABLE_AUTH=true`
signs you straight in as the owner. No password, no login screen.

**Through the tunnel**, that bypass does not apply. cloudflared forwards the
original `Host`, so a tunnelled request never looks local, and the app requires a
Cloudflare Access assertion instead. This is what makes it safe to publish: if
the bypass applied to public traffic, every visitor on the internet would land in
your dashboard as the owner.

Share pages (`/s/...`) stay public either way, so clients can watch a recording
without signing in to anything.

### Finishing setup: the Cloudflare Access application

> **Status: configured 2026-09-14.** Zero Trust team `delicate-rice-e58e.cloudflareaccess.com`.
> Two self-hosted applications on `screenshare.rocstarrmedia.com`:
>
> - **`screenshare`** — the whole hostname, reusable policy **RocStarr Media Admins**
>   (the same allow-list as govbid, agent, fastbooks and socialplanner), login method
>   **One-time PIN**: Cloudflare emails the sign-in code itself, no email service needed.
> - **`screenshare-public`** — Bypass policy **ScreenShare public share links** on
>   `/s`, `/_next`, `/api/playlist`, `/api/video/preview`, `/api/auth/session`.
>
> `CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `CLOUDFLARE_ACCESS_AUD` are set in `.env`. To
> give someone access, add their email to RocStarr Media Admins — note that also
> grants them the other four apps.
>
> The steps below are kept for rebuilding it from scratch.
>
> Identity on the bypassed paths comes from the `CF_Authorization` cookie rather
> than the `Cf-Access-Jwt-Assertion` header: Access never evaluates a Bypass
> destination, so it sends no header there. Both carry the same signed token and
> are verified identically. Without the cookie, a signed-in owner or team member
> looks anonymous on a share page's media routes and cannot play a recording
> that is not public.


Until this is done the public dashboard is closed — the portal tile reaches the
app but lands on a sign-in page. Share links already work.

You create **two** applications on the same hostname. Access matches the most
specific path first, so the bypass wins for the paths it names and the protected
one catches everything else.

**1. Public paths (create this first, so you don't lock out share links.)**

Zero Trust → **Access → Applications → Add an application → Self-hosted**

- Name: `ScreenShare public`
- Add these as the application's domains — subdomain `screenshare`, domain
  `rocstarrmedia.com`, with each path in turn:

  | Path | Why |
  | --- | --- |
  | `s` | The share pages themselves |
  | `_next` | App JavaScript and CSS — without this share pages render broken |
  | `api/playlist` | Resolves the video source for the player |
  | `api/video/preview` | Thumbnail and preview |
  | `api/auth/session` | Client session check; returns empty for a viewer |

  If your dashboard only accepts one domain per application, make one bypass
  application per path instead.
- Policy: name it `Anyone`, action **Bypass**, include **Everyone**.

Bypassing these is safe. `api/playlist` and `api/video/preview` enforce each
video's own visibility and password rules inside the app, so a bypass at the edge
does not expose a private recording. `_next` is build output with no user data.

**2. Everything else**

Add a second self-hosted application:

- Name: `ScreenShare`
- Domain: subdomain `screenshare`, domain `rocstarrmedia.com`, path empty
- Policy: action **Allow**, include **Emails** listing your address and each team
  member's — or **Emails ending in** `@yourdomain.com`

**3. Wire the app to it**

From the second application's **Overview**, copy the **Application Audience (AUD)
Tag**. Your team domain is on Zero Trust → **Settings → Custom Pages** and looks
like `yourteam.cloudflareaccess.com`.

```
CLOUDFLARE_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=<the AUD tag>
```

```powershell
docker compose up -d cap-web
```

**4. Check it**

In a private window:

- A share link plays with no sign-in prompt.
- `https://screenshare.rocstarrmedia.com/dashboard/caps` shows the Cloudflare
  sign-in, and after you authenticate lands in your library with your recordings.
- `http://localhost:3003` still opens directly, as always.

The app verifies that assertion against Cloudflare's published signing keys on
every request, so the identity cannot be forged by anything reaching the origin
directly. Unsigned, expired, tampered and wrong-audience tokens are all rejected.

> **Do not** put Access in front of `screenshare-media.rocstarrmedia.com`.
> Recordings load from there with presigned URLs; challenging that hostname
> breaks playback for every viewer. MinIO already rejects any request without a
> valid signature.

### Signing in, and why no email arrives

There is no email provider configured (`RESEND_API_KEY` is empty), so the app
**cannot** send the verification email. Rather than failing, it prints the code
to the container log:

```powershell
.\scripts\windows\Get-ScreenShareLoginCode.ps1
```

Request a code on the sign-in page, run that, and type in what it prints. Codes
expire 10 minutes after they are issued.

The sign-in and verification pages say this outright when email isn't configured,
rather than claiming a code was emailed.

This is a stopgap for reaching the public URL before Cloudflare Access is in
place. Two ways to stop needing it:

- **Finish the Access application** (above). Access then handles sign-in and no
  code is ever issued.
- **Set `RESEND_API_KEY` and `RESEND_FROM_DOMAIN`** in `.env` if you want real
  emails, which also requires a domain verified in Resend. If Resend rejects a send
  (unverified domain, wrong key), sign-in now fails with an error instead of
  pretending the code went out — `docker logs cap-web` shows Resend's reason.

All three routes in — the localhost bypass, an Access assertion, and an emailed
code — resolve to the *same* owner account, because `SCREENSHARE_OWNER_EMAIL` is
also the address on that account. That matters: NextAuth matches accounts by
email, so if the owner account still used the placeholder `owner@screenshare.local`,
signing in with your real address would silently create a second, empty account
and your recordings would appear to have vanished.

### Team members

Anyone your Access policy admits gets their own account in the workspace the
first time they open it — their own library, with shared spaces and comments.
No invite emails, no passwords.

`SCREENSHARE_OWNER_EMAIL` in `.env` names the one address that maps onto the
*owner* account instead of a member account, so your library looks the same
whether you come in on localhost or through the public URL.

## Transcripts, captions and AI summaries

Without any keys, the owner can still create a transcript from the video page:
**Transcript → Generate transcript** runs Whisper in the owner's browser (the
model downloads once from Hugging Face and jsDelivr, then stays cached) and saves
captions for every viewer. Optional keys make it automatic. Add to `.env` and
restart `cap-web`:

| Variable | Enables |
| --- | --- |
| `DEEPGRAM_API_KEY` | Automatic transcription of every upload |
| `OPENAI_API_KEY` / `GROQ_API_KEY` | AI titles, summaries, chapters (any one) |

## Loom-style sharing and insights

All stored in MySQL; nothing external is required.

- **Insights tab** (owner and team, on the video page): views, unique viewers,
  average watched, finished views, total watch time, a drop-off chart, and a
  list of who watched how much. Views from the owner are not counted. Tinybird
  is optional; counts use the local `video_views` table either way.
- **Share tab** (owner): call-to-action button with click tracking, "ask for
  name and email" before watching, "let viewers download", and custom
  thumbnails (upload, use current frame, restore original). The original
  thumbnail is kept as `screenshot/screen-capture-original.jpg`.
- **View alerts**: every new viewer creates a notification in the bell menu;
  viewers who passed the email gate show by name and email.
- **Editor**: *Remove silences* cuts pauses longer than a second, using the
  video's transcript.
- **Web recorder settings**: 3-2-1 countdown, noise filter, capture quality
  (720p to 4K) and speaker notes shown on the recording bar.
- **Camera bubble**: background blur (sparkle button), on top of the existing
  size, shape, mirror and picture-in-picture controls. The segmentation model
  loads from jsDelivr and Google's model storage on first use.
- **Screenshots**: *Take a screenshot* in the recorder saves the shared screen
  as an image share link and copies the link.

Public viewers reach these through `/s/<id>/view`, which is covered by the
existing Cloudflare Access bypass on `/s`. The older `/api/analytics/track`
endpoint is behind Access, so it never counted public views.

These shipped on 2026-10-21 as migration `0032` (tables `video_views` and
`video_share_options`). The image that ran before them is kept as
`rocstarr-screenshare-web:pre-loom-parity`; to roll back the app (the two new
tables are harmless to leave in place):

```powershell
docker tag rocstarr-screenshare-web:pre-loom-parity rocstarr-screenshare-web:local
docker compose up -d --no-build cap-web
```

## Day-to-day

```powershell
# Health, library size, disk usage, anything stuck mid-processing
.\scripts\windows\Get-ScreenShareStatus.ps1
```

```powershell
# Start everything (also runs at logon via the scheduled task)
docker compose up -d
```

The logon task is installed with `.\scripts\windows\Install-ScreenShareStartupTask.ps1`
and logs to `logs/screenshare-service.log`. It waits for the Docker engine to
come up before starting the stack and retries, because at logon the engine is
usually still booting.

## Backups

Everything lives in two Docker volumes on this PC. Losing the machine loses every
recording. Mirror both somewhere else:

```powershell
.\scripts\windows\Backup-ScreenShare.ps1 -Destination "E:\Backups\ScreenShare"
```

Writes a consistent MySQL dump to `database\` and an incremental mirror of the
recordings to `media\`. Re-running only copies what changed. Database dumps older
than `-KeepDays` (default 30) are pruned; the media mirror is never pruned by age
unless you pass `-MirrorDelete`.

Point `-Destination` at another drive, a NAS, or a synced folder. Worth putting
on a scheduled task.

## Troubleshooting

**A recording sits on "Optimizing video" forever.** Everything asynchronous —
transcoding, thumbnails, transcription, AI, the video editor, Loom import,
desktop recordings — runs through the Workflow runtime at
`/.well-known/workflow/v1/step`. If middleware ever redirects that path, every
job is silently swallowed and uploads stay raw forever. It must return 400 to an
empty POST, not a 307:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3003/.well-known/workflow/v1/step
```

**Share links point at localhost.** `CAP_URL` and `S3_PUBLIC_URL` in `.env` are
what links are built from. They must be the public hostnames, not `localhost`, or
every link you send a client resolves to the client's own machine.

**The public URL 404s.** cloudflared is serving stale ingress. It does not
hot-reload as a Windows service — restart it (elevated):

```powershell
Restart-Service cloudflared -Force
```

Ingress lives in `C:\Users\rsf3582\.cloudflared\config.yml`, shared with the
other tunnelled apps. Validate before restarting:

```powershell
& "C:\cloudflared\cloudflared.exe" --config "C:\Users\rsf3582\.cloudflared\config.yml" tunnel ingress validate
```

**The dashboard says "Unauthorized" on the public URL.** Access is not configured
yet, or `CLOUDFLARE_ACCESS_TEAM_DOMAIN` / `CLOUDFLARE_ACCESS_AUD` do not match the
application. Both must be set for any Access identity to be accepted — the app
fails closed on purpose.
