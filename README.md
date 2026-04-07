# Kube Bind provider

This repository outlines how one uses kube-bind as provider in the PlatformMesh.io.

## Architecture

Three separate images work together:

| Image | Source | Description |
|-------|--------|-------------|
| `ghcr.io/kube-bind/backend` | upstream kube-bind | The kube-bind backend server |
| `ghcr.io/platform-mesh/kube-bind-provider-init` | this repo | Init container that bootstraps provider resources into kcp |
| `ghcr.io/platform-mesh/kube-bind-provider-portal` | this repo | Angular portal UI (Luigi microfrontend) |

## Prerequisites

```bash
cp ../helm-charts/.secret/kcp/admin.kubeconfig kcp-admin.kubeconfig
export PM_KUBECONFIG="$(realpath kcp-admin.kubeconfig)"
kind export kubeconfig --name platform-mesh --kubeconfig compute.kubeconfig
export COMPUTE_KUBECONFIG="$(realpath compute.kubeconfig)"
```

## Local Development

### 1. Create Provider Workspace Hierarchy

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl ws use :
KUBECONFIG=$PM_KUBECONFIG kubectl ws create providers --type=root:providers --enter --ignore-existing
KUBECONFIG=$PM_KUBECONFIG kubectl ws create kube-bind --type=root:provider --enter --ignore-existing
```

### 2. Bootstrap Provider Resources

Seed kube-bind assets + platform-mesh.io assets into the provider workspace:

TODO: This should be moved into providers bootstrap process, where secret is emitted out to the provider.

```bash
go run cmd/init/main.go --kcp-kubeconfig $PM_KUBECONFIG \
  --host-override=https://frontproxy-front-proxy.platform-mesh-system:6443
```

Extract the generated backend kubeconfig from kcp:

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl get secret kube-bind-backend-kubeconfig -n default -o jsonpath='{.data.kubeconfig}' | base64 -d > backend.kubeconfig
```

### 3. Run the Backend

```bash
KUBECONFIG=$PM_KUBECONFIG \
go run github.com/kube-bind/kube-bind/cmd/backend \
  --multicluster-runtime-provider kcp \
  --apiexport-endpoint-slice-name=kube-bind.io \
  --external-address=https://frontproxy-front-proxy.platform-mesh-system:6443 \
  --pretty-name="PlatformMesh.io" \
  --frontend-disabled=true \
  --namespace-prefix="kube-bind-" \
  --schema-source apiresourceschemas \
  --consumer-scope=cluster \
  --apibinding-ignore-prefixes core.platform-mesh.io \
  --apibinding-ignore-prefixes tenancy.kcp.io \
  --apibinding-ignore-prefixes topology.kcp.io \
  --apibinding-ignore-prefixes kube-bind.io \
  --isolation=None
```

### 4. Run the Portal UI

```bash
cd portal
npm install
npm start
```

The dev server will start at `http://localhost:4300`. The portal integrates with the Platform Mesh Portal via Luigi microfrontend framework.

## Container Images

### Build and Load into Kind (typical workflow)

```bash
export IMAGE_TAG=platform-mesh
make images kind-load-all IMAGE_TAG=$IMAGE_TAG
```

### Individual Targets

```bash
# Build images
make init-image-build          # init container
make portal-image-build        # portal UI
make images                    # both

# Load into kind
make kind-load-init
make kind-load-portal
make kind-load-all

# Push to registry
make images-push
make init-image-push
make portal-image-push
```

### Override Variables

```bash
make images IMAGE_TAG=v0.1.0
make images IMAGE_REGISTRY=my-registry.io/org
make kind-load-all KIND_CLUSTER=my-cluster
```

### Run Portal Container Locally

```bash
make portal-run                # foreground (http://localhost:4300)
make portal-run-detached       # background
make portal-stop               # stop background container
```

## Helm Deployment

### Deploy Backend (upstream kube-bind chart + init container)

The upstream kube-bind Helm chart is extended with `initContainers` support. Use the provided values file:

```bash
# Create the kubeconfig secret
kubectl create namespace kube-bind-system
kubectl create secret generic kube-bind-provider-kubeconfig \
  --from-file=kubeconfig=backend.kubeconfig \
  -n kube-bind-system

# Install using upstream chart with provider values
helm upgrade --install kube-bind-backend \
  oci://ghcr.io/kube-bind/charts/backend \
  --version 0.0.0-6f9a8da664039515d1eeac60ad9596b9f0202ec6 \
  -f deploy/helm/backend-values.yaml \
  -n kube-bind-system

# Install using local chart with provider values (for development)
helm upgrade --install kube-bind-backend \
  ../../kube-bind/kube-bind/deploy/charts/backend \
  -f deploy/helm/backend-values.yaml \
  -n kube-bind-system
```

### Deploy Portal

```bash
# Update chart dependencies
make helm-deps

# Install portal
helm upgrade --install kube-bind-portal \
  deploy/helm/kube-bind-portal \
  -n kube-bind-system \
  --set image.tag="platform-mesh"
```

## Portal Features

- List all binding requests with a tile-based grid view
- Create new binding requests with required fields:
  - Name
  - Namespace
  - Cluster Identity
  - Kubeconfig Secret Name/Key
- Delete binding requests with confirmation
- Phase status badges (pending, success, error)

## TODO

- We need a way to produce Templates for services too. Some kind of modular UI or PM specific controller. Maybe a kube-bind/kcp converting apiexport to a template.
