# syntax=docker/dockerfile:1

#############
# build-env #
#############

FROM cosmtrek/air:v1.64.5

ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /opt/yt-dlp \
    && curl -fsSL -o /opt/yt-dlp/yt-dlp \
       "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux$([ "$TARGETARCH" = arm64 ] && echo _aarch64)" \
    && chmod +x /opt/yt-dlp/yt-dlp

COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

ENV YTDLP_PATH=/opt/yt-dlp/yt-dlp

WORKDIR /go/src/

COPY . .

EXPOSE 8080/tcp

ENTRYPOINT ["air", "-c", "/go/src/.air.toml"]
