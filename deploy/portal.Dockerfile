FROM node:24.15@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS build

WORKDIR /app

# Copy package files first for better caching
COPY portal/package.json portal/package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY portal/ .

# Build the Angular application for production
RUN npm run build

FROM nginx:alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
# Angular 17+ outputs to dist/<project>/browser
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist/kube-bind-portal/browser /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/nginx.conf

# Fix permissions for non-root nginx user (uid 101)
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx && \
    chown -R 101:101 /var/cache/nginx /var/run /var/log/nginx /etc/nginx/conf.d

EXPOSE 8080
USER 101
