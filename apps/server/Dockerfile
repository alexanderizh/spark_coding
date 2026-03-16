FROM node:22.18.0-alpine

WORKDIR /workspace

COPY package.json yarn.lock ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/server ./apps/server

RUN yarn install --frozen-lockfile
RUN yarn build:shared && yarn build:server

WORKDIR /workspace/apps/server

EXPOSE 7001

CMD ["node", "dist/bootstrap.js"]
