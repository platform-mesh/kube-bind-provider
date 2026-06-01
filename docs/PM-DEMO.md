# PlatformMesh Demo

End-to-end demo path: bootstrap the provider workspace, build and load the provider images into kind, and deploy the backend + portal via Helm. The backend runs in-cluster (not via `go run`), so this exercises the same images and charts used in a real deployment.

For pure code iteration without rebuilding images, see [DEVELOPMENT.md](DEVELOPMENT.md).
For just the image build and Helm reference, see [DEPLOYMENT.md](DEPLOYMENT.md).

We will be using 

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

Seed kube-bind + platform-mesh.io assets into the provider workspace. The `--host-override` flag stamps the externally-reachable kcp hostname into the generated kubeconfig. We use `https://root.kcp.localhost:8443` because:

- It is the SNI hostname the platform-mesh Istio gateway routes to the kcp root shard (`kcp-root-shard-tlsroute` in the `infra` chart). In this single-shard kind setup all workspaces live on the root shard, so path-based routing (`/clusters/<id>/...`) resolves correctly through it.
- It is resolvable **inside** the provider cluster via the backend pod's `hostAliases` (mapped to the frontproxy ClusterIP — see [deploy/helm/backend-values.yaml](../deploy/helm/backend-values.yaml)).
- It is resolvable **from a consumer kind cluster** by adding a `hostAlias` to the konnector pod pointing `root.kcp.localhost` at the host-gateway IP — the same trick contrib-examples uses for the api-syncagent (`contrib-examples/msp-postgres-localsetup/hack/syncagent-install.sh`).

`https://localhost:8443` (the front-proxy TLSRoute hostname) does not work for consumer pods, because `localhost` already resolves to the pod itself and cannot be overridden via `hostAliases`.

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
  oci://ghcr.io/kube-bind/charts/backend \
  --version 0.8.1 \
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

## 5. Create a Consumer Kind Cluster

The platform-mesh kind cluster is the **provider** (runs kcp + the kube-bind backend + portal). To exercise the full bind flow we need a second, separate cluster — the **consumer** — where the konnector will run and where bound APIs become available.

Create the consumer cluster:

```bash
kind create cluster --name kube-bind-consumer
kind export kubeconfig --name kube-bind-consumer --kubeconfig consumer.kubeconfig
export CONSUMER_KUBECONFIG="$(realpath consumer.kubeconfig)"
```

Confirm it is up:

```bash
KUBECONFIG=$CONSUMER_KUBECONFIG kubectl get nodes
```

### Networking note: resolving `root.kcp.localhost` from the consumer

The kubeconfigs handed out by the provider's portal point at `https://root.kcp.localhost:8443`. Both kind clusters share the default `kind` docker network, and the platform-mesh kind cluster publishes 8443 on host loopback. The consumer's konnector reaches kcp by:

1. Resolving `root.kcp.localhost` inside the konnector pod to the host-gateway IP (the IP `host.docker.internal` resolves to from inside the kind node). This must be set via `hostAliases` on the konnector deployment, because the name is not in any real DNS.
2. The kind node forwards that to the host's published `127.0.0.1:8443`.
3. The platform-mesh Istio gateway accepts the TLS handshake, routes by SNI `root.kcp.localhost` (`kcp-root-shard-tlsroute` in the `infra` chart), and lands on the root shard, which serves the workspace path embedded in the kubeconfig.

Resolve the host-gateway IP dynamically from inside the consumer kind node and apply it as a `hostAlias` to the konnector deployment after `kubectl bind` installs it. The exact pattern is in `contrib-examples/msp-postgres-localsetup/hack/syncagent-install.sh` — same network topology, same SNI hostname, same trick.

No extra kind-network configuration is needed beyond keeping both clusters on the default `kind` docker network.

## 6. Bind APIs via the Portal UI

Steps you will need todo in platfrom-mesh portal:

1. Get consumer cluster identity `kubectl bind cluster-identity` and creaet BindingRequest. Wait until the status is `Success`.
2. Click on it and "Copy binding file and deploy" and apply the copied yaml to the consumer cluster (`kubectl apply -f - --kubeconfig $CONSUMER_KUBECONFIG`).
3. This will deploy konnector. But IMPORTANT, before konnector becomes ready, patch the deployment to add `hostAlias` for `root.kcp.localhost`:

```bash 
# Resolve host-gateway IP from inside the consumer kind control-plane node.
CONSUMER_NODE=kube-bind-consumer-control-plane
HOSTGW_IP=$(docker exec "$CONSUMER_NODE" getent ahostsv4 host.docker.internal | awk 'NR==1 {print $1}')
echo "host-gateway IP for consumer pods: $HOSTGW_IP"

# Patch the konnector Deployment to resolve root.kcp.localhost -> host-gateway IP.
KUBECONFIG=$CONSUMER_KUBECONFIG kubectl -n kube-bind patch deployment konnector \
  --type=strategic \
  -p "$(cat <<EOF
spec:
  template:
    spec:
      hostAliases:
        - ip: "$HOSTGW_IP"
          hostnames:
            - root.kcp.localhost
EOF
)"

# Wait for the rollout.
KUBECONFIG=$CONSUMER_KUBECONFIG kubectl -n kube-bind rollout status deployment/konnector
```

4. Once this works, you should be able to see `ClusterBinding` Ready in cluster binding window. Click on it
and copy `APIServiceBindingBundle` and apply it to consumer cluster. This tells "kbind" that you agree to pull every API contract from provider(platform-mesh) and bind to consumer cluster.

These steps are one-time steps to establish trust and connectivity between the provider and consumer clusters. After this, any APIs the provider exposes and the consumer subscribes to will be automatically pushed and become available in the consumer cluster without needing to repeat these steps.

5. Now in `ServiceMappings` page you should see that your Platfrom mesh account has one API available - 
`postgresql.cnpg.io-postgresql.cnpg.io-jln62`. Click `+` and Create Export Request. This will instruct kbind to push this contract to consumer cluster. 

6. In Active Bindings page, you should see Active Binding per clusters. This shows that now your external cosnumer is directly linked to the platfrom-mesh account.

On the consumer cluster:
```bash
KUBECONFIG=$CONSUMER_KUBECONFIG kubectl get crd | grep postgresql.cnpg.io 
clusters.postgresql.cnpg.io             2026-06-01T12:23:22Z       
```

If you create object in the consumer cluster:

```
KUBECONFIG=$CONSUMER_KUBECONFIG kubectl apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-postgres-cluster
spec:
  instances: 1
  storage:
    size: 1Gi
EOF
```

in UI if you how "All namespaces" in postgress tab you should see new API from consumer cluster. 