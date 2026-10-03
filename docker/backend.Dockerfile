# syntax=docker/dockerfile:1

###########
# builder #
###########

FROM golang:trixie AS builder

LABEL maintainer="Eylexander <me@eylexander.fr>"

WORKDIR /go/src/

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o ytdlp-server ./src/cmd

################
# target image #
################

FROM debian:trixie-slim

ARG TARGETARCH

# yt-dlp needs ffmpeg to merge/convert and deno to solve YouTube's JS challenges.
# The standalone binary lives in an app-owned folder so the Settings page can self-update it
# (yt-dlp --update-to); docker-compose.prod.yml keeps that folder on a volume.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 1000 -m app && mkdir /data /opt/yt-dlp \
    && curl -fsSL -o /opt/yt-dlp/yt-dlp \
       "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux$([ "$TARGETARCH" = arm64 ] && echo _aarch64)" \
    && chmod +x /opt/yt-dlp/yt-dlp \
    && chown -R app /data /opt/yt-dlp

COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /opt/app

COPY --from=builder /go/src/ytdlp-server /opt/app/ytdlp-server

ENV DATA_DIR=/data YTDLP_PATH=/opt/yt-dlp/yt-dlp

USER app

EXPOSE 8080/tcp

ENTRYPOINT ["/opt/app/ytdlp-server"]
