# Kube Bind provider

This repository outlines how one uses kube-bind as provider in the PlatformMesh.io.

## Architecture

Three separate images work together:

| Image | Source | Description |
|-------|--------|-------------|
| `ghcr.io/kube-bind/backend` | upstream kube-bind | The kube-bind backend server |
| `ghcr.io/platform-mesh/kube-bind-provider-init` | this repo | Init container that bootstraps provider resources into kcp |
| `ghcr.io/platform-mesh/kube-bind-provider-portal` | this repo | Angular portal UI (Luigi microfrontend) |

## Guides

- **[Development](docs/DEVELOPMENT.md)** — run the backend (`go run`) and portal (`npm start`) directly from source against a local kcp + kind setup. Use for code iteration.
- **[Local Deployment with Images](docs/DEPLOYMENT.md)** — build container images, load them into kind, and install via Helm. Use to validate the full deployment path.
- **[PlatformMesh Demo](docs/PM-DEMO.md)** — end-to-end demo: get PM kubeconfig → bootstrap → load images → Helm install. Mixes the two above into a single happy-path script.

## Portal Features

- List all binding requests with a tile-based grid view
- Create new binding requests with required fields:
  - Name
  - Namespace
  - Cluster Identity
  - Kubeconfig Secret Name/Key
- Delete binding requests with confirmation
- Phase status badges (pending, success, error)
