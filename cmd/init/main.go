/*
Copyright 2026 The Platform Mesh Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	confighelpers "github.com/kcp-dev/kcp/config/helpers"
	"github.com/kcp-dev/logicalcluster/v3"
	"github.com/spf13/pflag"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/apimachinery/pkg/util/wait"
	genericapiserver "k8s.io/apiserver/pkg/server"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	logsv1 "k8s.io/component-base/logs/api/v1"
	"k8s.io/klog/v2"

	bootstrap "github.com/kube-bind/kube-bind/contrib/kcp/bootstrap"
	bootstrapcore "github.com/kube-bind/kube-bind/contrib/kcp/bootstrap/config/core"
	"github.com/kube-bind/kube-bind/contrib/kcp/bootstrap/options"
	deploy "github.com/kube-bind/kube-bind/contrib/kcp/deploy"

	backendconfig "github.com/platform-mesh/kube-bind-provider/config/backend"
	provider "github.com/platform-mesh/kube-bind-provider/config/provider"
)

var (
	hostOverride   string
	seedWorkspaces bool
)

func main() {
	ctx := genericapiserver.SetupSignalContext()
	if err := run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	defer klog.Flush()

	options := options.NewOptions()
	options.AddFlags(pflag.CommandLine)
	pflag.StringVar(&hostOverride, "host-override", os.Getenv("HOST_OVERRIDE"),
		"Override the server URL in the generated backend kubeconfig (e.g. https://frontproxy-front-proxy.platform-mesh-system:6443)")
	pflag.BoolVar(&seedWorkspaces, "seed-workspaces", false,
		"Create the kube-bind workspace hierarchy under root before bootstrapping (standalone/admin use). "+
			"When false (default, ManagedProvider) bootstrap into the existing provider workspace the kubeconfig points at.")
	pflag.Parse()

	logger := klog.FromContext(ctx)
	logger.Info("Bootstrapping api")

	// setup logging first
	if err := logsv1.ValidateAndApply(options.Logs, nil); err != nil {
		return err
	}

	// Complete options and build the kcp client config. NewConfig strips the workspace path
	// from the kubeconfig host, so the target workspace is derived separately below.
	completed, err := options.Complete()
	if err != nil {
		return err
	}
	if err := completed.Validate(); err != nil {
		return err
	}

	config, err := bootstrap.NewConfig(completed)
	if err != nil {
		return err
	}

	if err := bootstrapProvider(ctx, config, seedWorkspaces, options.KCPKubeConfig); err != nil {
		return err
	}

	// bootstrap provider-specific resources
	logger.Info("Bootstrapping provider resources")
	dynamicClient := config.DynamicClusterClient.Cluster(deploy.KubeBindRootClusterName)
	discoveryClient := config.ApiextensionsClient.Cluster(deploy.KubeBindRootClusterName).Discovery()

	if err := confighelpers.Bootstrap(
		ctx,
		discoveryClient,
		dynamicClient,
		sets.New[string](),
		provider.FS,
		confighelpers.ReplaceOption(),
	); err != nil {
		logger.Error(err, "failed to bootstrap provider resources")
		return err
	}

	// bootstrap backend resources (ServiceAccount, RBAC, token secret)
	logger.Info("Bootstrapping backend resources")
	if err := confighelpers.Bootstrap(
		ctx,
		discoveryClient,
		dynamicClient,
		sets.New[string](),
		backendconfig.FS,
		confighelpers.ReplaceOption(),
	); err != nil {
		logger.Error(err, "failed to bootstrap backend resources")
		return err
	}

	// update kube-bind.io APIExport with provider label
	logger.Info("Updating kube-bind.io APIExport with provider label")
	kcpClient := config.KcpClusterClient.Cluster(deploy.KubeBindRootClusterName)
	apiExport, err := kcpClient.ApisV1alpha2().APIExports().Get(ctx, "kube-bind.io", metav1.GetOptions{})
	if err != nil {
		logger.Error(err, "failed to get kube-bind.io APIExport")
		return err
	}

	if apiExport.Labels == nil {
		apiExport.Labels = make(map[string]string)
	}
	apiExport.Labels["ui.platform-mesh.io/content-for"] = "kube-bind.io"

	_, err = kcpClient.ApisV1alpha2().APIExports().Update(ctx, apiExport, metav1.UpdateOptions{})
	if err != nil {
		logger.Error(err, "failed to update kube-bind.io APIExport")
		return err
	}

	// create kubeconfig secret for backend
	logger.Info("Creating backend kubeconfig secret")
	kubeClient, err := kubernetes.NewForConfig(config.ClientConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}
	// scope the client to the workspace
	wsConfig := *config.ClientConfig
	wsConfig.Host = config.ClientConfig.Host + deploy.KubeBindRootClusterName.RequestPath()
	wsKubeClient, err := kubernetes.NewForConfig(&wsConfig)
	if err != nil {
		return fmt.Errorf("failed to create workspace-scoped kubernetes client: %w", err)
	}
	_ = kubeClient // keep for future use
	if err := createBackendKubeconfigSecret(ctx, wsKubeClient, config.ClientConfig, hostOverride); err != nil {
		return fmt.Errorf("failed to create backend kubeconfig secret: %w", err)
	}

	logger.Info("Provider bootstrap completed successfully")
	return nil
}

// bootstrapProvider provisions the kube-bind APIs into the target workspace.
//
// When seedWorkspaces is true (standalone/admin) it creates the kube-bind workspace hierarchy
// under root first, then bootstraps into it — this requires a kubeconfig with root admin.
//
// When false (ManagedProvider, the default) the operator has already provisioned the provider
// workspace and handed us a kubeconfig scoped to it, so we bootstrap the kube-bind APIs INTO
// that workspace without creating any workspaces (the scoped service account can't).
func bootstrapProvider(ctx context.Context, config *bootstrap.Config, seedWorkspaces bool, kcpKubeconfig string) error {
	logger := klog.FromContext(ctx)

	if seedWorkspaces {
		deploy.KubeBindRootClusterName = logicalcluster.NewPath("root:providers:kube-bind")
		server, err := bootstrap.NewServer(ctx, config)
		if err != nil {
			return err
		}
		// TODO(upstream): server.Start always runs bootstrapconfig.Bootstrap, which creates the
		// kube-bind workspace hierarchy under root. The ManagedProvider flow below has to skip
		// that step (the scoped service account can't create workspaces), which is why it
		// re-implements the remaining core + deploy bootstrap by hand. Add a skip-workspace-
		// creation option to kube-bind's bootstrap.Config (Server already carries it, so Start
		// keeps its signature) so both flows can share Start and this branch collapses to a
		// single call.
		return server.Start(ctx)
	}

	// Retarget the core + kube-bind bootstrap at the workspace the kubeconfig points at.
	current, err := currentWorkspace(kcpKubeconfig)
	if err != nil {
		return err
	}
	logger.Info("Bootstrapping into existing provider workspace", "cluster", current.String())
	deploy.KubeBindRootClusterName = current
	bootstrapcore.KubeBindRootClusterName = current

	// The core bootstrap creates a ServiceAccount and token Secret in the "default" namespace.
	// In the seed flow the workspace is created as an organization type (which extends universal),
	// so kcp's universal initializer provisions the default namespace for us. A provider workspace
	// created out-of-band (kubectl ws create / operator-provisioned) may use a type that does not,
	// so ensure it exists up front before the core bootstrap runs.
	if err := ensureDefaultNamespace(ctx, config.ClientConfig, current); err != nil {
		return fmt.Errorf("failed to ensure default namespace in provider workspace: %w", err)
	}

	batteries := sets.New[string]()
	if err := bootstrapcore.Bootstrap(ctx, config.KcpClusterClient, config.ApiextensionsClient, config.DynamicClusterClient, batteries); err != nil {
		return fmt.Errorf("failed to bootstrap core APIs into provider workspace: %w", err)
	}
	if err := deploy.Bootstrap(ctx, config.KcpClusterClient, config.ApiextensionsClient, config.DynamicClusterClient, batteries); err != nil {
		return fmt.Errorf("failed to bootstrap kube-bind APIs into provider workspace: %w", err)
	}
	return nil
}

// currentWorkspace derives the logical cluster the kubeconfig is scoped to from its server
// URL (the /clusters/<name> path segment). Used to bootstrap into the pre-provisioned
// provider workspace under ManagedProvider, where we must not create workspaces.
func currentWorkspace(kubeconfigPath string) (logicalcluster.Path, error) {
	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	if err != nil {
		return logicalcluster.None, fmt.Errorf("failed to load kubeconfig %q: %w", kubeconfigPath, err)
	}
	u, err := url.Parse(cfg.Host)
	if err != nil {
		return logicalcluster.None, fmt.Errorf("failed to parse kubeconfig host %q: %w", cfg.Host, err)
	}
	name := strings.Trim(strings.TrimPrefix(u.Path, "/clusters/"), "/")
	if name == "" {
		return logicalcluster.None, fmt.Errorf("kubeconfig host %q has no /clusters/<name> path; cannot determine target workspace", cfg.Host)
	}
	return logicalcluster.NewPath(name), nil
}

// ensureDefaultNamespace creates the "default" namespace in the given workspace if it does not
// already exist. The core kube-bind bootstrap expects it (it places a ServiceAccount and token
// Secret there), but an out-of-band provisioned provider workspace does not have one.
func ensureDefaultNamespace(ctx context.Context, restConfig *rest.Config, ws logicalcluster.Path) error {
	logger := klog.FromContext(ctx)

	wsConfig := *restConfig
	wsConfig.Host = restConfig.Host + ws.RequestPath()
	client, err := kubernetes.NewForConfig(&wsConfig)
	if err != nil {
		return fmt.Errorf("failed to create workspace-scoped kubernetes client: %w", err)
	}

	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}}
	if _, err := client.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{}); err != nil {
		if apierrors.IsAlreadyExists(err) {
			logger.V(2).Info("default namespace already exists", "cluster", ws.String())
			return nil
		}
		return err
	}
	logger.Info("created default namespace", "cluster", ws.String())
	return nil
}

// createBackendKubeconfigSecret creates a Secret containing a kubeconfig
// that the backend can use to connect to the kcp workspace.
func createBackendKubeconfigSecret(ctx context.Context, client kubernetes.Interface, restConfig *rest.Config, hostOverride string) error {
	logger := klog.FromContext(ctx)

	// Wait for the service account token secret to be populated
	var tokenSecret *corev1.Secret
	err := wait.PollUntilContextTimeout(ctx, time.Second, 30*time.Second, true, func(ctx context.Context) (bool, error) {
		secret, err := client.CoreV1().Secrets("default").Get(ctx, "kube-bind-backend-token", metav1.GetOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) {
				logger.V(2).Info("waiting for service account token secret to be created")
				return false, nil
			}
			return false, err
		}
		if len(secret.Data["token"]) == 0 {
			logger.V(2).Info("waiting for service account token to be populated")
			return false, nil
		}
		tokenSecret = secret
		return true, nil
	})
	if err != nil {
		return fmt.Errorf("failed to wait for service account token: %w", err)
	}

	token := string(tokenSecret.Data["token"])
	caCert := tokenSecret.Data["ca.crt"]

	// Build kubeconfig pointing to this workspace
	server := restConfig.Host + deploy.KubeBindRootClusterName.RequestPath()
	if hostOverride != "" {
		// Preserve the workspace path, replacing only the scheme+host+port with the override.
		if u, err := url.Parse(restConfig.Host); err == nil && u.Path != "" {
			server = hostOverride + u.Path + deploy.KubeBindRootClusterName.RequestPath()
		} else {
			server = hostOverride + deploy.KubeBindRootClusterName.RequestPath()
		}
		logger.Info("Using host override for kubeconfig", "server", server)
	}
	kubeconfig := clientcmdapi.Config{
		Kind:       "Config",
		APIVersion: "v1",
		Clusters: map[string]*clientcmdapi.Cluster{
			"workspace": {
				Server:                   server,
				CertificateAuthorityData: caCert,
			},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"backend": {
				Token: token,
			},
		},
		Contexts: map[string]*clientcmdapi.Context{
			"workspace": {
				Cluster:  "workspace",
				AuthInfo: "backend",
			},
		},
		CurrentContext: "workspace",
	}

	kubeconfigBytes, err := clientcmd.Write(kubeconfig)
	if err != nil {
		return fmt.Errorf("failed to marshal kubeconfig: %w", err)
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "kube-bind-backend-kubeconfig",
			Namespace: "default",
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"kubeconfig": kubeconfigBytes,
		},
	}

	_, err = client.CoreV1().Secrets("default").Create(ctx, secret, metav1.CreateOptions{})
	if err != nil {
		if apierrors.IsAlreadyExists(err) {
			logger.Info("kubeconfig secret already exists, updating")
			existing, err := client.CoreV1().Secrets("default").Get(ctx, secret.Name, metav1.GetOptions{})
			if err != nil {
				return fmt.Errorf("failed to get existing secret: %w", err)
			}
			secret.ResourceVersion = existing.ResourceVersion
			if _, err = client.CoreV1().Secrets("default").Update(ctx, secret, metav1.UpdateOptions{}); err != nil {
				return fmt.Errorf("failed to update secret: %w", err)
			}
			logger.Info("updated kubeconfig secret")
			return nil
		}
		return fmt.Errorf("failed to create secret: %w", err)
	}

	logger.Info("created kubeconfig secret", "name", secret.Name)
	return nil
}
