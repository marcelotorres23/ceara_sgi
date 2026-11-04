FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json ./
COPY apps/api/package.json apps/api/
RUN npm install --workspace @sgi/api --include-workspace-root

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate

EXPOSE 3333
CMD ["npm", "run", "dev"]
