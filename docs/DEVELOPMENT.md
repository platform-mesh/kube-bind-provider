# Development

Run the backend and portal directly from source against a local kcp + kind setup. Use this mode for iterating on code without rebuilding container images.

For container-image-based deployment (build, kind-load, Helm install), see [DEPLOYMENT.md](DEPLOYMENT.md).

## Prerequisites

```bash
cp ../helm-charts/.secret/kcp/admin.kubeconfig kcp-admin.kubeconfig
export PM_KUBECONFIG="$(realpath kcp-admin.kubeconfig)"
kind export kubeconfig --name platform-mesh --kubeconfig compute.kubeconfig
export COMPUTE_KUBECONFIG="$(realpath compute.kubeconfig)"
```

## 1. Create Provider Workspace Hierarchy

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl ws use :
KUBECONFIG=$PM_KUBECONFIG kubectl ws create providers --type=root:providers --enter --ignore-existing
KUBECONFIG=$PM_KUBECONFIG kubectl ws create kube-bind --type=root:provider --enter --ignore-existing
```

## 2. Bootstrap Provider Resources

Seed kube-bind assets + platform-mesh.io assets into the provider workspace:

TODO: This should be moved into providers bootstrap process, where secret is emitted out to the provider.
For now backend does not need to have such high privileges, so we can run this separately with admin kubeconfig.

Important: The `--host-override` flag is required to ensure the backend generates kubeconfigs with the correct API server address that is accessible from where the kube-bind backend is running. In this case, since we're running the backend locally, we point it to the front-proxy service in the cluster.

```bash
go run cmd/init/main.go --kcp-kubeconfig $PM_KUBECONFIG \
  --host-override=https://frontproxy-front-proxy.platform-mesh-system:8443
```

Extract the generated backend kubeconfig from kcp:

```bash
KUBECONFIG=$PM_KUBECONFIG kubectl get secret kube-bind-backend-kubeconfig -n default -o jsonpath='{.data.kubeconfig}' | base64 -d > backend.kubeconfig
```

## 3. Run the Backend

```bash
KUBECONFIG=$PM_KUBECONFIG \
go run github.com/kube-bind/kube-bind/cmd/backend \
  --multicluster-runtime-provider kcp \
  --apiexport-endpoint-slice-name=kube-bind.io \
  --external-address=https://frontproxy-front-proxy.platform-mesh-system:8443 \
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

## 4. Run the Portal UI

```bash
cd portal
npm install
npm start
```

The dev server will start at `http://localhost:4300`. The portal integrates with the Platform Mesh Portal via Luigi microfrontend framework.

## Testing the Portal with Sample Resources

Create some sample resources in the provider cluster (compute cluster) that the portal will pick up and display:

```bash
NAMESPACE=cowboys
kubectl create ns $NAMESPACE

kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: colt-45-permit
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  serial_number: C45-123456
  permit_date: "1881-04-15"
  issued_by: Tombstone Marshal
---
apiVersion: wildwest.platform-mesh.io/v1alpha1
kind: Cowboy
metadata:
  name: billy-the-kid
spec:
  intent: Ride the range and protect the cattle
  secretRefs:
    - name: colt-45-permit       # exists -> green chip
      namespace: ${NAMESPACE}
    - name: missing-saddlebag    # does NOT exist -> red chip
      namespace: ${NAMESPACE}
---
apiVersion: wildwest.platform-mesh.io/v1alpha1
kind: Cowboy
metadata:
  name: lonely-ranger
spec:
  intent: Ride alone
  # no secretRefs -> Secret Refs row is hidden in the UI
EOF
```
