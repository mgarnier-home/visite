# Étape 1 : build de l'application Angular
FROM --platform=$BUILDPLATFORM docker.io/library/node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS front
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build

# Étape 2 : build du binaire Go (le front est embarqué depuis backend/web/dist)
FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.26.4-alpine@sha256:3ad57304ad93bbec8548a0437ad9e06a455660655d9af011d58b993f6f615648 AS back
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=v0.0.0
ARG COMMIT=commitsha
ARG DATE=undefined
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=front /src/frontend/dist/frontend/browser/ ./web/dist/
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
    -ldflags="-X 'github.com/mgarnier-home/utils/buildinfo.Version=${VERSION}' -X 'github.com/mgarnier-home/utils/buildinfo.Commit=${COMMIT}' -X 'github.com/mgarnier-home/utils/buildinfo.Date=${DATE}'" \
    -o /out/visite .

# Étape 3 : image finale
FROM docker.io/library/alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN addgroup -S visite && adduser -S -G visite -H -h /data visite \
    && mkdir -p /data/photos \
    && chown -R visite:visite /data
COPY --from=back /out/visite /usr/local/bin/visite
ENV VISITE_DB_PATH=/data/visite.db \
    VISITE_PHOTOS_DIR=/data/photos
USER visite
WORKDIR /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/version || exit 1
ENTRYPOINT ["/usr/local/bin/visite"]
