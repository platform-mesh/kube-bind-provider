# PlatformMesh Demo

End-to-end demo path: bootstrap the provider workspace, build and load the provider images into kind, and deploy the backend + portal via Helm. The backend runs in-cluster (not via `go run`), so this exercises the same images and charts used in a real deployment.

For pure code iteration without rebuilding images, see [DEVELOPMENT.md](DEVELOPMENT.md).
For just the image build and Helm reference, see [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Get the PlatformMesh Kubeconfig

```bash
cp ../helm-charts/.secret/kcp/admin.kubeconfig kcp-admin.kubeconfig
export PM_KUBECONFIG="$(realpath kcp-admin.kubeconfig)"
kind export kubeconfig --name platform-mesh --kubeconfig compute.kubeconfig
export COMPUTE_KUBECONFIG="$(realpath compute.kubeconfig)"
```

## 2. Bootstrap Provider Resources

Create the provider workspace hierarchy:

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl ws use :
KUBECONFIG=$PM_KUBECONFIG kubectl ws create providers --type=root:providers --enter --ignore-existing
KUBECONFIG=$PM_KUBECONFIG kubectl ws create kube-bind --type=root:provider --enter --ignore-existing
```

Seed kube-bind + platform-mesh.io assets into the provider workspace. The `--host-override` flag ensures the generated backend kubeconfig points at the front-proxy service, which is what the in-cluster backend will use to reach kcp.

```bash
go run cmd/init/main.go --kcp-kubeconfig $PM_KUBECONFIG \
  --host-override=https://frontproxy-front-proxy.platform-mesh-system:8443
```

Extract the generated backend kubeconfig:

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl get secret kube-bind-backend-kubeconfig -n default -o jsonpath='{.data.kubeconfig}' | base64 -d > backend.kubeconfig
```

## 3. Build and Load Images into Kind

TODO: Replace with pre-built images once the tags are available.

```bash
export IMAGE_TAG=platform-mesh
make images kind-load-all IMAGE_TAG=$IMAGE_TAG
```

## 4. Run Helm Charts

Create the kubeconfig secret the backend will mount:

```bash
kubectl create namespace kube-bind-system
kubectl delete secret kube-bind-provider-kubeconfig -n kube-bind-system --ignore-not-found
kubectl create secret generic kube-bind-provider-kubeconfig \
  --from-file=kubeconfig=backend.kubeconfig \
  -n kube-bind-system
```

Install the backend. Bootstrap was done out-of-cluster in step 2, so no init container is needed here. `backend.image.tag` is the upstream backend tag — separate from `$IMAGE_TAG` which controls the provider-init/portal images built by `make images`.

```bash
helm upgrade --install kube-bind-backend \
  ../../kube-bind/kube-bind/deploy/charts/backend \
  -f deploy/helm/backend-values.yaml \
  -n kube-bind-system \
  --set 'backend.image.repository=ghcr.io/kube-bind/backend' \
  --set 'backend.image.tag=0.0.0-dfa3d5c84db3988a14fa8b27a8fedc9b6dd1c49e' \
  --set 'backend.image.pullPolicy=Always'
```

Install the portal:

```bash
make helm-deps

helm upgrade --install kube-bind-portal \
  deploy/helm/kube-bind-portal \
  -n kube-bind-system \
  --set image.tag=$IMAGE_TAG \
  --set httpRoute.enabled=true \
  --set middleware.enabled=true
```

Once the pods are healthy, exercise the portal with the sample resources from [DEVELOPMENT.md § Testing the Portal with Sample Resources](DEVELOPMENT.md#testing-the-portal-with-sample-resources).



# Check 

```
kubectl get pods -n kube-bind-system 
NAME                                 READY   STATUS    RESTARTS   AGE
kube-bind-backend-6786c7dc48-p6q7x   1/1     Running   0          114s
kube-bind-portal-d66c5557c-sz8kp     0/1     Running   0          5s
```