FROM node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS base
ARG SOURCE_DATE_EPOCH
ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN apk update && \
  apk add --no-cache python3 make g++ gcc libc6-compat bash && \
  npm install --global node-gyp && \
  corepack enable

COPY . ./app
WORKDIR /app

FROM base AS build

ARG COMMIT_TAG
ENV COMMIT_TAG=${COMMIT_TAG}
ENV NEXT_TELEMETRY_DISABLED=1

RUN --mount=type=cache,id=pnpm,target=/pnpm/store CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile

RUN pnpm build

RUN rm -rf .next/cache

# 镜像瘦身（方案 2）：@vercel/nft 追踪服务端依赖，组装运行时子集（.runtime-stage/）
# 只保留 dist/index.js 实际依赖的文件 + 原生模块 + fs 读取文件，削减 node_modules
RUN node scripts/trace-server.mjs && \
  echo "trace-server done"

FROM node:22.22.2-alpine3.23@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
ARG SOURCE_DATE_EPOCH
ARG COMMIT_TAG
ENV NODE_ENV=production
ENV COMMIT_TAG=${COMMIT_TAG}

RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai

USER node:node

WORKDIR /app

# 运行时只拷追踪出的依赖子集 + Next 产物 + 静态资源
COPY --chown=node:node --from=build /app/.runtime-stage/ /app/
COPY --chown=node:node --from=build /app/.next /app/.next
COPY --chown=node:node --from=build /app/public /app/public

RUN touch config/DOCKER && \
  echo "{\"commitTag\": \"${COMMIT_TAG}\"}" > committag.json

EXPOSE 5055

CMD [ "node", "dist/index.js" ]
