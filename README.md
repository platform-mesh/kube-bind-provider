# Kube Bind provider

This repository outlines how one uses kube-bind as provider in the PlatformMesh.io.


```bash
# Navigate to root workspace
kubectl ws use :

# Create the providers parent workspace (if it doesn't exist)
kubectl ws create providers --type=root:providers --enter --ignore-existing

# Create your provider workspace
kubectl ws create kube-bind --type=root:provider --enter --ignore-existing
```

We need to seed kube-bind assets + platfrom-mesh.io assets into the provider workspace. This is done by running the `init` command in this repository.

```bash
# Run the init command to seed kube-bind assets into the provider workspace
go run cmd/init/main.go --kcp-kubeconfig {path-to-kcp-kubeconfig}/kcp/admin.kubeconfig  
```


Now backend should be running in backend-only mode:
TODO: Add how to run this outside platform-mesh as container using upstream helm chart.


```
go run github.com/kube-bind/kube-bind/cmd/backend \
  --multicluster-runtime-provider kcp \
  --apiexport-endpoint-slice-name=kube-bind.io \
  --pretty-name="PlatformMesh.io" \
  --frontend-disabled=true \
  --namespace-prefix="kube-bind-" \
  --schema-source apiresourceschemas \
  --consumer-scope=cluster \
  --isolation=None
```

TODO:
We need a way to produce Templates for services too. Some kind of modular UI or PM specific controller. Maybe a kube-bind/kcp converting apiexport to a template.