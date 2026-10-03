# syntax=docker/dockerfile:1

###################
# build-env-front #
###################

FROM node:lts-bookworm-slim AS build

LABEL maintainer="Eylexander <me@eylexander.fr>"

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY ./package.json ./package-lock.json ./
RUN npm ci

COPY . .

# Static export to /app/out
RUN npm run build

################
# target image #
################

# The site is fully static: nginx serves it and proxies /api (see docker/nginx.conf).
FROM nginx:alpine

COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80/tcp
