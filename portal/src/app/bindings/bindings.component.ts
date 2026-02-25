/**
 * Cluster Bindings Management Page Component
 *
 * This component allows users to onboard external Kubernetes clusters to the
 * kube-bind service. Users create BindableResourcesRequest resources which
 * trigger the backend to generate onboarding credentials.
 *
 * Flow:
 * 1. User clicks "Connect Cluster" and provides:
 *    - Cluster Name: A friendly name for this cluster binding
 *    - Cluster Identity: The unique ID of the external cluster
 *      (obtained via: kubectl get namespace kube-system -o jsonpath='{.metadata.uid}')
 * 2. Backend processes the request and creates credentials in a Secret
 * 3. User can view the credentials once status.phase becomes "Succeeded"
 */
import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import LuigiClient from '@luigi-project/client';
import { ILuigiContextTypes, LuigiContextService } from '@luigi-project/client-support-angular';
import {
  AvatarComponent,
  ButtonComponent,
  DialogComponent,
  DynamicPageComponent,
  DynamicPageHeaderComponent,
  DynamicPageTitleComponent,
  IconComponent,
  InputComponent,
  LabelComponent,
  OptionComponent,
  SelectComponent,
  TabComponent,
  TabContainerComponent,
  TextComponent,
  TitleComponent,
  ToolbarButtonComponent,
  ToolbarComponent,
} from '@ui5/webcomponents-ngx';

// Import UI5 icons used in the template
import '@ui5/webcomponents-icons/dist/add.js';
import '@ui5/webcomponents-icons/dist/calendar.js';
import '@ui5/webcomponents-icons/dist/delete.js';
import '@ui5/webcomponents-icons/dist/connected.js';
import '@ui5/webcomponents-icons/dist/disconnected.js';
import '@ui5/webcomponents-icons/dist/refresh.js';
import '@ui5/webcomponents-icons/dist/copy.js';
import '@ui5/webcomponents-icons/dist/download.js';
import '@ui5/webcomponents-icons/dist/hint.js';
import '@ui5/webcomponents-icons/dist/chain-link.js';

import { BindableResourcesRequest, BindingsService, ClusterBinding, Namespace } from './bindings.service';

@Component({
  selector: 'app-bindings',
  standalone: true,
  imports: [
    DynamicPageComponent,
    DynamicPageTitleComponent,
    DynamicPageHeaderComponent,
    AvatarComponent,
    TitleComponent,
    LabelComponent,
    TextComponent,
    ToolbarComponent,
    ToolbarButtonComponent,
    IconComponent,
    InputComponent,
    ButtonComponent,
    DialogComponent,
    SelectComponent,
    OptionComponent,
    TabContainerComponent,
    TabComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './bindings.component.html',
  styleUrl: './bindings.component.scss',
})
export class BindingsComponent {
  private luigiContextService = inject(LuigiContextService);
  private bindingsService = inject(BindingsService);

  public luigiContext = toSignal(this.luigiContextService.contextObservable(), {
    initialValue: { context: {}, contextType: ILuigiContextTypes.INIT },
  });

  public bindings = signal<BindableResourcesRequest[]>([]);
  public clusterBindings = signal<ClusterBinding[]>([]);
  public namespaces = signal<Namespace[]>([]);
  public loading = signal<boolean>(true);
  public clusterBindingsLoading = signal<boolean>(true);
  public currentUserEmail = signal<string | null>(null);
  public activeTab = signal<string>('requests');

  // Add cluster dialog
  public showAddDialog = signal<boolean>(false);
  public newClusterName = signal<string>('');
  public newClusterNamespace = signal<string>('');
  public newClusterIdentity = signal<string>('');
  public newClusterTTL = signal<string>('1h');

  // TTL options for the dropdown
  public ttlOptions = [
    { value: '30m', label: '30 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '2h', label: '2 hours' },
    { value: '6h', label: '6 hours' },
    { value: '12h', label: '12 hours' },
    { value: '24h', label: '24 hours' },
  ];

  // Credentials dialog (legacy, can be removed later)
  public showCredentialsDialog = signal<boolean>(false);
  public credentialsContent = signal<string>('');
  public credentialsLoading = signal<boolean>(false);

  // Binding details dialog
  public showDetailsDialog = signal<boolean>(false);
  public selectedBinding = signal<BindableResourcesRequest | null>(null);
  public bindingResponseContent = signal<string>('');

  constructor() {
    // Try to get current user email for auto-populating author
    this.bindingsService.getCurrentUserEmail().subscribe((email) => {
      if (email) {
        this.currentUserEmail.set(email);
      }
    });
  }

  public ngOnInit(): void {
    LuigiClient.addInitListener((context: any) => {
      LuigiClient.uxManager().showLoadingIndicator();

      // Set active tab from Luigi context if provided
      if (context?.activeTab) {
        this.activeTab.set(context.activeTab);
      }

      this.loadNamespaces();
      this.loadBindings();
      this.loadClusterBindings();
    });
  }

  public loadNamespaces(): void {
    this.bindingsService.listNamespaces().subscribe({
      next: (namespaces) => {
        this.namespaces.set(namespaces);
        if (namespaces.length > 0 && !this.newClusterNamespace()) {
          this.newClusterNamespace.set(namespaces[0].metadata.name);
        }
      },
      error: (err) => {
        console.error('Failed to load namespaces:', err);
      },
    });
  }

  public loadBindings(): void {
    this.loading.set(true);
    this.bindingsService.listBindings().subscribe({
      next: (bindings) => {
        this.bindings.set(bindings);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
      },
      error: (err) => {
        console.error('Failed to load bindings:', err);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
        LuigiClient.uxManager().showAlert({
          text: 'Failed to load binding requests',
          type: 'error',
          closeAfter: 3000,
        });
      },
    });
  }

  public loadClusterBindings(): void {
    this.clusterBindingsLoading.set(true);
    this.bindingsService.listClusterBindings().subscribe({
      next: (clusterBindings) => {
        this.clusterBindings.set(clusterBindings);
        this.clusterBindingsLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load cluster bindings:', err);
        this.clusterBindingsLoading.set(false);
      },
    });
  }

  public onTabSelect(event: Event): void {
    const tabContainer = event.target as any;
    const selectedTab = tabContainer.selectedItem;
    if (selectedTab) {
      this.activeTab.set(selectedTab.getAttribute('data-key') || 'requests');
    }
  }

  /**
   * Find the ClusterBinding that corresponds to a BindableResourcesRequest
   * ClusterBindings are created in the same namespace as the request
   */
  public getLinkedClusterBinding(request: BindableResourcesRequest): ClusterBinding | undefined {
    const requestNamespace = request.metadata.namespace;
    // ClusterBinding is typically named "cluster" and lives in the same namespace
    return this.clusterBindings().find(
      (cb) => cb.metadata.namespace === requestNamespace
    );
  }

  /**
   * Check if a binding request has a corresponding ClusterBinding
   */
  public hasLinkedClusterBinding(request: BindableResourcesRequest): boolean {
    return !!this.getLinkedClusterBinding(request);
  }

  public openAddDialog(): void {
    this.newClusterName.set('');
    this.newClusterIdentity.set('');
    this.newClusterTTL.set('1h');
    if (this.namespaces().length > 0) {
      this.newClusterNamespace.set(this.namespaces()[0].metadata.name);
    }
    this.showAddDialog.set(true);
  }

  public closeAddDialog(): void {
    this.showAddDialog.set(false);
  }

  public onClusterNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.newClusterName.set(input.value);
  }

  public onClusterIdentityInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.newClusterIdentity.set(input.value);
  }

  public onNamespaceChange(event: Event): void {
    const select = event.target as any;
    this.newClusterNamespace.set(select.selectedOption?.value || '');
  }

  public onTTLChange(event: Event): void {
    const select = event.target as any;
    this.newClusterTTL.set(select.selectedOption?.value || '1h');
  }

  public confirmAddCluster(): void {
    const clusterName = this.newClusterName().trim();
    const namespace = this.newClusterNamespace().trim();
    const clusterIdentity = this.newClusterIdentity().trim();
    const ttl = this.newClusterTTL();

    if (!clusterName) {
      LuigiClient.uxManager().showAlert({
        text: 'Please enter a name for the cluster',
        type: 'warning',
        closeAfter: 3000,
      });
      return;
    }

    if (!namespace) {
      LuigiClient.uxManager().showAlert({
        text: 'Please select a namespace',
        type: 'warning',
        closeAfter: 3000,
      });
      return;
    }

    if (!clusterIdentity) {
      LuigiClient.uxManager().showAlert({
        text: 'Please enter the cluster identity',
        type: 'warning',
        closeAfter: 3000,
      });
      return;
    }

    // Use current user email as author if available
    const author = this.currentUserEmail() || undefined;

    this.bindingsService.createBinding(clusterName, namespace, clusterIdentity, author, ttl).subscribe({
      next: (success) => {
        if (success) {
          LuigiClient.uxManager().showAlert({
            text: `Cluster "${clusterName}" binding request created successfully`,
            type: 'success',
            closeAfter: 3000,
          });
          this.closeAddDialog();
          this.loadBindings();
        } else {
          LuigiClient.uxManager().showAlert({
            text: 'Failed to create cluster binding request',
            type: 'error',
            closeAfter: 3000,
          });
        }
      },
      error: () => {
        LuigiClient.uxManager().showAlert({
          text: 'Failed to create cluster binding request',
          type: 'error',
          closeAfter: 3000,
        });
      },
    });
  }

  public deleteBinding(binding: BindableResourcesRequest): void {
    LuigiClient.uxManager()
      .showConfirmationModal({
        type: 'warning',
        header: 'Delete Cluster Binding',
        body: `Are you sure you want to delete the binding for cluster "${binding.metadata.name}"? This will revoke access for this cluster.`,
        buttonConfirm: 'Delete',
        buttonDismiss: 'Cancel',
      })
      .then(() => {
        this.bindingsService
          .deleteBinding(binding.metadata.name, binding.metadata.namespace || 'default')
          .subscribe({
            next: (success) => {
              if (success) {
                LuigiClient.uxManager().showAlert({
                  text: `Cluster binding "${binding.metadata.name}" deleted`,
                  type: 'success',
                  closeAfter: 3000,
                });
                this.loadBindings();
              } else {
                LuigiClient.uxManager().showAlert({
                  text: 'Failed to delete cluster binding',
                  type: 'error',
                  closeAfter: 3000,
                });
              }
            },
            error: () => {
              LuigiClient.uxManager().showAlert({
                text: 'Failed to delete cluster binding',
                type: 'error',
                closeAfter: 3000,
              });
            },
          });
      })
      .catch(() => {
        console.log('Cluster binding deletion cancelled');
      });
  }

  public viewCredentials(binding: BindableResourcesRequest): void {
    if (!binding.status?.kubeconfigSecretRef) {
      LuigiClient.uxManager().showAlert({
        text: 'Credentials not yet available. Please wait for the binding to complete.',
        type: 'warning',
        closeAfter: 3000,
      });
      return;
    }

    this.selectedBinding.set(binding);
    this.credentialsLoading.set(true);
    this.credentialsContent.set('');
    this.showCredentialsDialog.set(true);

    const secretRef = binding.status.kubeconfigSecretRef;
    const namespace = binding.metadata.namespace || 'default';

    this.bindingsService.getSecret(secretRef.name, namespace).subscribe({
      next: (secret) => {
        this.credentialsLoading.set(false);
        if (secret?.data) {
          const key = secretRef.key || 'kubeconfig';
          const encodedContent = secret.data[key];
          if (encodedContent) {
            // Decode base64 content
            try {
              const decodedContent = atob(encodedContent);
              this.credentialsContent.set(decodedContent);
            } catch {
              this.credentialsContent.set(encodedContent);
            }
          } else {
            this.credentialsContent.set('Secret key not found: ' + key);
          }
        } else {
          this.credentialsContent.set('Secret not found or empty');
        }
      },
      error: (err) => {
        this.credentialsLoading.set(false);
        this.credentialsContent.set('Error loading credentials: ' + err.message);
      },
    });
  }

  public closeCredentialsDialog(): void {
    this.showCredentialsDialog.set(false);
    this.selectedBinding.set(null);
    this.credentialsContent.set('');
  }

  public copyCredentials(): void {
    const content = this.credentialsContent();
    if (content) {
      this.copyToClipboard(content, 'Credentials copied to clipboard');
    }
  }

  public downloadCredentials(): void {
    const content = this.credentialsContent();
    const binding = this.selectedBinding();
    if (content && binding) {
      const blob = new Blob([content], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${binding.metadata.name}-kubeconfig.yaml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  public getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(/[-_\s]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  public getColorScheme(
    name: string
  ):
    | 'Accent1'
    | 'Accent2'
    | 'Accent3'
    | 'Accent4'
    | 'Accent5'
    | 'Accent6'
    | 'Accent7'
    | 'Accent8'
    | 'Accent9'
    | 'Accent10' {
    const schemes = [
      'Accent1',
      'Accent2',
      'Accent3',
      'Accent4',
      'Accent5',
      'Accent6',
      'Accent7',
      'Accent8',
      'Accent9',
      'Accent10',
    ] as const;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return schemes[Math.abs(hash) % schemes.length];
  }

  public getPhaseClass(phase: string | undefined): string {
    if (!phase) return 'pending';
    const lower = phase.toLowerCase();
    if (lower === 'succeeded') return 'success';
    if (lower === 'failed') return 'error';
    return 'pending';
  }

  public getPhaseIcon(phase: string | undefined): string {
    if (!phase) return 'disconnected';
    const lower = phase.toLowerCase();
    if (lower === 'succeeded') return 'connected';
    if (lower === 'failed') return 'disconnected';
    return 'hint';
  }

  public formatDate(timestamp: string | undefined): string {
    if (!timestamp) return 'Unknown';
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  }

  public truncateIdentity(identity: string | undefined): string {
    if (!identity) return 'N/A';
    if (identity.length <= 12) return identity;
    return identity.substring(0, 8) + '...' + identity.substring(identity.length - 4);
  }

  /**
   * Get health status based on conditions (specifically the Ready condition)
   */
  public getHealthStatus(cb: ClusterBinding): string {
    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
    }
    const healthyCondition = cb.status?.conditions?.find(c => c.type === 'Healthy');
    if (healthyCondition) {
      return healthyCondition.status === 'True' ? 'Healthy' : 'Unhealthy';
    }
    return cb.status?.lastHeartbeatTime ? 'Connected' : 'Unknown';
  }

  public getHealthClass(cb: ClusterBinding): string {
    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'success' : 'error';
    }
    const healthyCondition = cb.status?.conditions?.find(c => c.type === 'Healthy');
    if (healthyCondition) {
      return healthyCondition.status === 'True' ? 'success' : 'error';
    }
    return cb.status?.lastHeartbeatTime ? 'success' : 'pending';
  }

  public getHealthIcon(cb: ClusterBinding): string {
    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'connected' : 'disconnected';
    }
    const healthyCondition = cb.status?.conditions?.find(c => c.type === 'Healthy');
    if (healthyCondition) {
      return healthyCondition.status === 'True' ? 'connected' : 'disconnected';
    }
    return cb.status?.lastHeartbeatTime ? 'connected' : 'hint';
  }

  // Binding details dialog methods
  public openBindingDetails(binding: BindableResourcesRequest): void {
    this.selectedBinding.set(binding);
    this.bindingResponseContent.set('');
    this.showDetailsDialog.set(true);

    // Pre-fetch the binding response content if available
    if (binding.status?.kubeconfigSecretRef) {
      const secretRef = binding.status.kubeconfigSecretRef;
      const namespace = binding.metadata.namespace || 'default';

      this.bindingsService.getSecret(secretRef.name, namespace).subscribe({
        next: (secret) => {
          if (secret?.data) {
            const key = secretRef.key || 'response';
            const encodedContent = secret.data[key];
            if (encodedContent) {
              try {
                const decodedContent = atob(encodedContent);
                this.bindingResponseContent.set(decodedContent);
              } catch {
                this.bindingResponseContent.set(encodedContent);
              }
            }
          }
        },
        error: (err) => {
          console.error('Error fetching binding response:', err);
        },
      });
    }
  }

  public closeDetailsDialog(): void {
    this.showDetailsDialog.set(false);
    this.selectedBinding.set(null);
    this.bindingResponseContent.set('');
  }

  public copyApplyCommand(): void {
    const binding = this.selectedBinding();
    if (!binding?.status?.kubeconfigSecretRef) return;

    const secretName = binding.status.kubeconfigSecretRef.name;
    const namespace = binding.metadata.namespace || 'default';
    const command = `kubectl get secret ${secretName} -n ${namespace} -o jsonpath='{.data.response}' | base64 -d | KUBECONFIG=remote kubectl apply -f -`;
    this.copyToClipboard(command, 'Apply command copied to clipboard');
  }

  public copyDeployCommand(): void {
    const binding = this.selectedBinding();
    if (!binding) return;

    const command = `kubectl bind deploy --file ${binding.metadata.name}-binding.json`;
    this.copyToClipboard(command, 'Deploy command copied to clipboard');
  }

  public downloadBindingFile(): void {
    const binding = this.selectedBinding();
    const content = this.bindingResponseContent();

    if (!binding) {
      LuigiClient.uxManager().showAlert({
        text: 'No binding selected',
        type: 'error',
        closeAfter: 2000,
      });
      return;
    }

    // If we already have the content, download it directly
    if (content) {
      this.performDownload(binding.metadata.name, content);
      return;
    }

    // Try to fetch it if not already loaded
    if (!binding.status?.kubeconfigSecretRef) {
      LuigiClient.uxManager().showAlert({
        text: 'Binding response not yet available',
        type: 'warning',
        closeAfter: 2000,
      });
      return;
    }

    const secretRef = binding.status.kubeconfigSecretRef;
    const namespace = binding.metadata.namespace || 'default';

    console.log('[Download] Fetching secret:', secretRef.name, 'namespace:', namespace, 'key:', secretRef.key);

    this.bindingsService.getSecret(secretRef.name, namespace).subscribe({
      next: (secret) => {
        console.log('[Download] Secret data keys:', secret?.data ? Object.keys(secret.data) : 'no data');

        if (secret?.data) {
          // Try the specified key first, then fallback to 'response'
          const key = secretRef.key || 'response';
          let encodedContent = secret.data[key];

          // If the specified key doesn't exist, try to find any available key
          if (!encodedContent && Object.keys(secret.data).length > 0) {
            const availableKey = Object.keys(secret.data)[0];
            console.log('[Download] Key', key, 'not found, using:', availableKey);
            encodedContent = secret.data[availableKey];
          }

          if (encodedContent) {
            try {
              const decodedContent = atob(encodedContent);
              this.bindingResponseContent.set(decodedContent);
              this.performDownload(binding.metadata.name, decodedContent);
            } catch {
              // If base64 decode fails, use content as-is
              this.bindingResponseContent.set(encodedContent);
              this.performDownload(binding.metadata.name, encodedContent);
            }
          } else {
            LuigiClient.uxManager().showAlert({
              text: `Secret key "${key}" not found in secret`,
              type: 'error',
              closeAfter: 3000,
            });
          }
        } else {
          LuigiClient.uxManager().showAlert({
            text: 'Secret has no data',
            type: 'error',
            closeAfter: 2000,
          });
        }
      },
      error: (err) => {
        console.error('[Download] Failed to fetch secret:', err);
        LuigiClient.uxManager().showAlert({
          text: 'Failed to fetch binding response',
          type: 'error',
          closeAfter: 2000,
        });
      },
    });
  }

  private performDownload(name: string, content: string): void {
    const filename = `${name}-binding.json`;

    try {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      LuigiClient.uxManager().showAlert({
        text: `Downloading ${filename}`,
        type: 'success',
        closeAfter: 2000,
      });
    } catch (error) {
      console.error('Download failed:', error);
      LuigiClient.uxManager().showAlert({
        text: 'Failed to download file. Try using the Copy button instead.',
        type: 'error',
        closeAfter: 3000,
      });
    }
  }

  public copyBindingFile(): void {
    const binding = this.selectedBinding();
    const content = this.bindingResponseContent();

    if (!binding) {
      LuigiClient.uxManager().showAlert({
        text: 'No binding selected',
        type: 'error',
        closeAfter: 2000,
      });
      return;
    }

    if (content) {
      this.copyToClipboard(content, `Binding content copied. Save as ${binding.metadata.name}-binding.json`);
      return;
    }

    // Try to fetch if not already loaded
    if (!binding.status?.kubeconfigSecretRef) {
      LuigiClient.uxManager().showAlert({
        text: 'Binding response not yet available',
        type: 'warning',
        closeAfter: 2000,
      });
      return;
    }

    const secretRef = binding.status.kubeconfigSecretRef;
    const namespace = binding.metadata.namespace || 'default';

    this.bindingsService.getSecret(secretRef.name, namespace).subscribe({
      next: (secret) => {
        if (secret?.data) {
          const key = secretRef.key || 'response';
          let encodedContent = secret.data[key];

          if (!encodedContent && Object.keys(secret.data).length > 0) {
            encodedContent = secret.data[Object.keys(secret.data)[0]];
          }

          if (encodedContent) {
            try {
              const decodedContent = atob(encodedContent);
              this.bindingResponseContent.set(decodedContent);
              this.copyToClipboard(decodedContent, `Binding content copied. Save as ${binding.metadata.name}-binding.json`);
            } catch {
              this.copyToClipboard(encodedContent, `Binding content copied. Save as ${binding.metadata.name}-binding.json`);
            }
          } else {
            LuigiClient.uxManager().showAlert({
              text: 'Secret key not found',
              type: 'error',
              closeAfter: 2000,
            });
          }
        }
      },
      error: () => {
        LuigiClient.uxManager().showAlert({
          text: 'Failed to fetch binding response',
          type: 'error',
          closeAfter: 2000,
        });
      },
    });
  }

  public copyInstallCommands(): void {
    const commands = `kubectl krew index add bind https://github.com/kube-bind/krew-index.git
kubectl krew install bind/bind`;
    this.copyToClipboard(commands, 'Install commands copied to clipboard');
  }

  private copyToClipboard(text: string, successMessage: string): void {
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        () => {
          LuigiClient.uxManager().showAlert({
            text: successMessage,
            type: 'success',
            closeAfter: 2000,
          });
        },
        () => this.fallbackCopyToClipboard(text, successMessage)
      );
    } else {
      this.fallbackCopyToClipboard(text, successMessage);
    }
  }

  private fallbackCopyToClipboard(text: string, successMessage: string): void {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        LuigiClient.uxManager().showAlert({
          text: successMessage,
          type: 'success',
          closeAfter: 2000,
        });
      } else {
        LuigiClient.uxManager().showAlert({
          text: 'Failed to copy to clipboard',
          type: 'error',
          closeAfter: 2000,
        });
      }
    } catch {
      LuigiClient.uxManager().showAlert({
        text: 'Failed to copy to clipboard',
        type: 'error',
        closeAfter: 2000,
      });
    }

    document.body.removeChild(textArea);
  }
}
