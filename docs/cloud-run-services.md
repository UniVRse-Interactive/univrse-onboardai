# Cloud Run services

In the cloud, OnboardAi runs as three separate Cloud Run services built from one `Dockerfile`. Each has its own Docker target and starts from its own file in `server/`. Every service listens on `HOST` (default `0.0.0.0`) and `PORT` (default `8080`) and stops cleanly on SIGTERM.

| Service | Entry file               | Docker target | Health path   | What it does                                                                                        |
| ------- | ------------------------ | ------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `web`   | `server/web-service.mjs` | `web`         | `/web-health` | Serves `dist/` and the avatar, and proxies `/api/*` to the api service. Holds no secrets.           |
| `api`   | `server/api-service.mjs` | `api`         | `/api/health` | Serves every `/api/*` route: chat, saved conversations, support summary, Drive search, `/api/voice` |
| `tts`   | `server/tts-service.mjs` | `tts`         | `/health`     | `POST /voice` renders speech with Kokoro. `/health` returns 503 until the model has loaded.         |

The `tts` image carries the Kokoro model (downloaded at build time by `npm run voice:prepare`). The `web` image carries `dist/`. The `api` image carries neither.

## Settings each service reads

| Service | Variable                                                                                                                                | Meaning                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| all     | `HOST`, `PORT`                                                                                                                          | Where to listen. Defaults `0.0.0.0` and `8080`.                                                      |
| web     | `API_SERVICE_URL`                                                                                                                       | Required. Base URL of the api service. The web service refuses to start without a valid http(s) URL. |
| web     | `TRUST_PROXY`                                                                                                                           | Trusted proxy hops. Default `1`.                                                                     |
| api     | `TTS_SERVICE_URL`                                                                                                                       | Base URL of the tts service. If unset, the api loads Kokoro in its own process instead.              |
| api     | `TRUST_PROXY`                                                                                                                           | Trusted proxy hops. Default `2`.                                                                     |
| api     | `AI_MODE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_CLOUD_PROJECT`, `CHAT_DATABASE_PATH`, `KNOWLEDGE_WARMUP` | Same meaning as in `.env.example`.                                                                   |
| tts     | `KOKORO_CACHE_DIR`                                                                                                                      | Where the baked-in model lives. Default `.cache/kokoro`. Nothing is downloaded at start-up.          |

`TRUST_PROXY` accepts a number, `true`, `false`, or an Express trust-proxy string. A `.env` file in the working directory is also loaded.

## Request flow

```
browser -> web -> api -> tts
```

The browser only ever talks to the web origin. `/api/*` is a same-origin request to web, which forwards it to api; the api calls tts only for `/api/voice`. This keeps the `alya_session` cookie first-party (it is `httpOnly`, `sameSite=strict`, path `/api`), so it keeps working and the api's same-origin check still makes sense. The proxy passes the api's `Set-Cookie` headers back unchanged, streams the response, and answers 502 or 504 if the api is down or too slow.

## Trusted proxy hops

The api needs the end user's IP (rate limit) and the public host (origin check), but it sits behind two hops.

- **web, `TRUST_PROXY=1`**: one hop is Google's front end, which appends the browser's IP to `X-Forwarded-For`. Express therefore reads the browser's IP and host.
- **api, `TRUST_PROXY=2`**: two hops are Google's front end for the api service (it appends the web instance's address) and the web instance itself. The web proxy discards any `X-Forwarded-*` the browser sent, then sends its own `X-Forwarded-For` (ending in the browser's IP), `X-Forwarded-Host` and `X-Forwarded-Proto`. With two hops, Express skips the web instance and the api sees the browser's IP.

What this affects:

- **Rate limit**: the api allows 30 `POST` requests per minute per `req.ip` (kept in memory, per instance). Because of the hops above, that key is the end user's IP, not Google's or web's.
- **Origin check**: saved-conversation routes compare the `Origin` header's host with `req.host`. Behind the proxy that is the forwarded host, i.e. the host the browser used on the web service.

If you change the number of proxies in front of either service (a load balancer, IAP), change `TRUST_PROXY` to match.

## Known limitation: the api is public

The api service is deployed with the `allUsers` invoker, a deliberate choice for the demo. A client that calls the api URL directly can put its own value in `X-Forwarded-For`. With two trusted hops, that changes the IP the rate limit sees, so the limit can be evaded or aimed at someone else's IP. The origin check is also only as strong as the forwarded host.

The fix is a follow-up, not part of this change: put IAP in front of web and make the api private (internal ingress or IAM-only invocation). No code was changed for it.

## The avatar

`/avatars/alya/alya.glb` is the pre-compressed `alya.glb.gz` (about 55 MB, 52 MiB) sent with `Content-Encoding: gzip`. It is streamed **without** a `Content-Length`. Cloud Run caps HTTP/1 responses that are not chunked at 32 MiB, so an exact length would break the download; without it Node uses chunked transfer. The shared code is `server/avatar-route.mjs`, used by both the web service and `server/index.mjs`.

## Conversation storage

Saved conversations are SQLite, in `.cache/chat/conversations.sqlite` on the api instance's disk (override with `CHAT_DATABASE_PATH`). That disk is lost when the instance restarts or is redeployed, so chats are lost with it. The api runs with `max-instances=1` so every request sees the same database. Moving to Firestore is the follow-up that removes both limits.

## Deploy order and where it happens

Deploy **tts, then api, then web**, because each needs the URL of the one before it (`TTS_SERVICE_URL`, then `API_SERVICE_URL`).

- Automatic deploys: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), on pushes to `main`.
- Infrastructure (services, service accounts, secrets, scaling): the Terraform module [`terraform/onboardai/`](../terraform/onboardai/).

Their contents are not repeated here.

## Local development

`npm run dev` and `npm start` are unchanged: they run `server/index.mjs`, one process with the website, the api routes and the in-process voice, and no proxy.

To run the three services as separate processes (run `npm run build` first for `dist/`, and `npm run voice:prepare` for the voice model):

```bash
PORT=8081 node server/tts-service.mjs
PORT=8082 TTS_SERVICE_URL=http://127.0.0.1:8081 node server/api-service.mjs
PORT=8080 API_SERVICE_URL=http://127.0.0.1:8082 node server/web-service.mjs
```

Then open `http://localhost:8080`. Leave `TTS_SERVICE_URL` out to let the api load the voice itself. Check with `curl localhost:8080/web-health` and `curl localhost:8080/api/health`.
