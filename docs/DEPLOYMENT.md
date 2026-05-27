# Local Deployment with Images

Build the provider container images, load them into a local kind cluster, and install via Helm. Use this mode to validate the full deployment path end-to-end.

For iterating on code without rebuilding images, see [DEVELOPMENT.md](DEVELOPMENT.md).

This guide assumes the prerequisites and provider workspace bootstrap from [DEVELOPMENT.md](DEVELOPMENT.md) (steps 1–2) are already done — the backend kubeconfig (`backend.kubeconfig`) must exist before the Helm install.

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
kubectl delete secret kube-bind-provider-kubeconfig -n kube-bind-system --ignore-not-found
kubectl create secret generic kube-bind-provider-kubeconfig \
  --from-file=kubeconfig=backend.kubeconfig \
  -n kube-bind-system

# Install using upstream chart with provider values
helm upgrade --install kube-bind-backend \
  oci://ghcr.io/kube-bind/charts/backend \
  --version 0.8.1 \
  -f deploy/helm/backend-values.yaml \
  --set backend.image.tag=0.0.0-dfa3d5c84db3988a14fa8b27a8fedc9b6dd1c49e \
  -n kube-bind-system

# Install using local chart with provider values (for development).
# Bootstrap is done out-of-cluster in DEVELOPMENT.md step 2, so no init container is needed here.
# `backend.image.tag` is the upstream backend tag — separate from $IMAGE_TAG which
# only controls the provider-init/portal images built by `make images`.
# TODO: Once changes are released in kube-bind, we can move to official kube-bind image.
helm upgrade --install kube-bind-backend \
  ../../kube-bind/kube-bind/deploy/charts/backend \
  -f deploy/helm/backend-values.yaml \
  -n kube-bind-system \
  --set 'backend.image.repository=ghcr.io/kube-bind/backend' \
  --set 'backend.image.tag=0.0.0-dfa3d5c84db3988a14fa8b27a8fedc9b6dd1c49e' \
  --set 'backend.image.pullPolicy=Always'
```

### Deploy Portal

```bash
# Update chart dependencies
make helm-deps

# Install portal (assumes IMAGE_TAG was exported above).
# httpRoute + middleware are off by default; enable them so the portal is reachable
# via the platform-mesh gateway. referenceGrant is gated on httpRoute.enabled and
# defaults to true.
helm upgrade --install kube-bind-portal \
  deploy/helm/kube-bind-portal \
  -n kube-bind-system \
  --set image.tag=$IMAGE_TAG \
  --set httpRoute.enabled=true \
  --set middleware.enabled=true
```
