# `config/platfrom-mesh-ocm` — ManagedProvider via OCM

Deploys the kube-bind provider (backend + Angular portal) onto a PlatformMesh runtime
cluster from a **single, self-contained OCM component**,
`github.com/platform-mesh/kube-bind-provider`, published by this repo.

```sh
kubectl apply -k config/platfrom-mesh-ocm
```

## Self-contained component

The OCM component bundles **everything** the provider needs — both upstream kube-bind
artifacts and this repo's own:

| Resource | Type | Origin |
|---|---|---|
| `backend-chart` | helmChart (external) | upstream `ghcr.io/kbind-dev/charts/backend`, relocated in |
| `backend-image` | ociImage (external)  | upstream `ghcr.io/kbind-dev/backend`, relocated in |
| `portal-chart`  | helmChart (local)    | our `kube-bind-portal` chart, packaged + pushed by `make helm-push`, referenced by OCI |
| `init-image`    | ociImage (local)     | `ghcr.io/platform-mesh/kube-bind-provider-init` |
| `portal-image`  | ociImage (local)     | `ghcr.io/platform-mesh/kube-bind-provider-portal` |

(The kcp bootstrap manifests under `config/` are embedded in the init image via `go:embed`,
so they are not shipped as a separate component resource.)

Every chart and image is an OCI artifact reference: our portal chart is packaged and pushed
by `make helm-push`, which must run **before** `ocm-build` so OCM can resolve it (the release
target `make ocm-release` chains `images-push → helm-push → ocm-push`). `ocm-push` then
transfers with `--copy-resources`, relocating the upstream chart + image and our own artifacts
into `ghcr.io/platform-mesh`. After that, the entire provider resolves from **our** registry —
no runtime dependency on the upstream registries.

## How the ManagedProvider works

Both runtime deployments use an `ocm:` source pointing at the one component. You give the
OCM coordinates inline (`registry` + `component` + `version` + `resourceName`) and the
platform-mesh-operator creates the `delivery.ocm.software` `Repository`/`Component`/
`Resource` objects; the ocm-controller resolves the descriptor and each chart is deployed
via Flux (`OCIRepository` + `HelmRelease`).

```yaml
ocm:
  name: kube-bind-backend                                # generated object names
  registry: ghcr.io/platform-mesh                        # → Repository (created by operator)
  component: github.com/platform-mesh/kube-bind-provider # → Component  (created by operator)
  version: "0.0.1"
  resourceName: backend-chart                            # resource within the component
  values: {...}                                          # Helm values (how to configure)
```

`name` is set explicitly on each entry because backend and portal resolve from the **same**
component and would otherwise collide on the generated object names.

The operator lifecycle (WaitPlatformMesh → ProviderResource → WaitProvider →
KubeconfigCopy → Deploy) provisions a dedicated kcp provider workspace and copies a scoped
admin kubeconfig into `platform-mesh-system` as Secret `kube-bind-provider-kubeconfig`. The
backend deployment's **init container** (built by this repo, injected through the upstream
chart's `initContainers` value) bootstraps that workspace (kube-bind APIExport/schemas +
backend RBAC/ServiceAccount); the init container and the backend share that kubeconfig at
`/etc/kube-bind`.

## Prerequisites

1. The ocm-controller (ocm-k8s-toolkit) must be installed in the runtime cluster
   (provides the `delivery.ocm.software` CRDs).
2. The component must be published first:
   ```sh
   make ocm-push            # build + transfer (relocating all resources) to ghcr.io/platform-mesh
   ```
   Keep the `version:` in each `ocm:` entry in sync with the published `VERSION`.
3. Set the front-proxy ClusterIP in [kustomization.yaml](kustomization.yaml) so the backend
   pod can resolve `root.kcp.localhost` (see the comment there).
