FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY apps/web/package.json apps/web/
RUN npm install --workspace @sgi/web --include-workspace-root

COPY apps/web ./apps/web
WORKDIR /app/apps/web

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
