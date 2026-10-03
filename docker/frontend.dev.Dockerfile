# syntax=docker/dockerfile:1

#############
# build-env #
#############

FROM node:lts

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000/tcp

ENTRYPOINT ["npm", "run", "dev"]
