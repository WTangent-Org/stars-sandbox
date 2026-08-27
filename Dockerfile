# 星球物理模拟器 —— 全栈一体化镜像
# 同时支持：Kimi 发布（dist/boot.js）与 Docker 部署（朋友服务器）
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# 服务端运行时只需要 ws（其余依赖已打进 bundle）
RUN npm install ws@^8.18.0 --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=8321
EXPOSE 8321
# 启动 dist/boot.js（Kimi 发布平台约定入口，内部转发到服务器）
CMD ["node", "dist/boot.js"]
