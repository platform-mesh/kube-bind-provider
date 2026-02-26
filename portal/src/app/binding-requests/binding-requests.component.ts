/**
 * Binding Requests Component
 *
 * Displays and manages BindableResourcesRequest resources.
 * Users can create new binding requests, view status, and get instructions
 * for completing the binding on their remote clusters.
 */
import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
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
import '@ui5/webcomponents-icons/dist/hint.js';

import { BindableResourcesRequest, BindingsService, ClusterBinding, Namespace } from '../bindings/bindings.service';

@Component({
  selector: 'app-binding-requests',
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
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './binding-requests.component.html',
  styleUrl: './binding-requests.component.scss',
})
export class BindingRequestsComponent {
  private luigiContextService = inject(LuigiContextService);
  private bindingsService = inject(BindingsService);
  private router = inject(Router);

  public luigiContext = toSignal(this.luigiContextService.contextObservable(), {
    initialValue: { context: {}, contextType: ILuigiContextTypes.INIT },
  });

  public bindings = signal<BindableResourcesRequest[]>([]);
  public clusterBindings = signal<ClusterBinding[]>([]);
  public namespaces = signal<Namespace[]>([]);
  public loading = signal<boolean>(true);
  public currentUserEmail = signal<string | null>(null);

  // Map from binding name to its target namespace (parsed from kubeconfig)
  public bindingTargetNamespaces = signal<Map<string, string>>(new Map());

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

  // Binding details dialog
  public showDetailsDialog = signal<boolean>(false);
  public selectedBinding = signal<BindableResourcesRequest | null>(null);
  public bindingResponseContent = signal<string>('');

  constructor() {
    effect(() => {
      const ctx = this.luigiContext();
      console.log('[BindingRequests] Luigi context:', ctx.contextType);
    });

    this.bindingsService.getCurrentUserEmail().subscribe((email) => {
      if (email) {
        this.currentUserEmail.set(email);
      }
    });
  }

  public ngOnInit(): void {
    LuigiClient.addInitListener(() => {
      LuigiClient.uxManager().showLoadingIndicator();
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
        // Parse kubeconfig for each succeeded binding to get target namespaces
        this.parseBindingTargetNamespaces(bindings);
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

  /**
   * Parse kubeconfig from each succeeded binding to extract the target namespace.
   * The namespace is stored in the kubeconfig context and represents where the
   * ClusterBinding resource will be created.
   */
  private parseBindingTargetNamespaces(bindings: BindableResourcesRequest[]): void {
    const succeededBindings = bindings.filter(
      (b) => b.status?.phase === 'Succeeded' && b.status?.kubeconfigSecretRef
    );

    for (const binding of succeededBindings) {
      const secretRef = binding.status!.kubeconfigSecretRef!;
      const namespace = binding.metadata.namespace || 'default';
      const bindingKey = `${namespace}/${binding.metadata.name}`;

      // Skip if we already have this namespace cached
      if (this.bindingTargetNamespaces().has(bindingKey)) {
        continue;
      }

      this.bindingsService.getSecret(secretRef.name, namespace).subscribe({
        next: (secret) => {
          if (secret?.data) {
            const key = secretRef.key || 'binding-response';
            const encodedContent = secret.data[key];
            if (encodedContent) {
              try {
                const decodedContent = atob(encodedContent);
                const targetNamespace = this.extractNamespaceFromBindingResponse(decodedContent);
                if (targetNamespace) {
                  const currentMap = new Map(this.bindingTargetNamespaces());
                  currentMap.set(bindingKey, targetNamespace);
                  this.bindingTargetNamespaces.set(currentMap);
                }
              } catch (e) {
                console.error('Error parsing binding response:', e);
              }
            }
          }
        },
        error: (err) => {
          console.error('Error fetching secret for binding:', binding.metadata.name, err);
        },
      });
    }
  }

  /**
   * Extract namespace from binding response JSON.
   * The binding response contains a kubeconfig field with base64-encoded kubeconfig,
   * which has the target namespace in the context.
   */
  private extractNamespaceFromBindingResponse(content: string): string | null {
    try {
      const response = JSON.parse(content);
      if (response.kubeconfig) {
        const kubeconfigYaml = atob(response.kubeconfig);
        // Parse the kubeconfig YAML to extract namespace from context
        // Looking for pattern: namespace: <value>
        const namespaceMatch = kubeconfigYaml.match(/namespace:\s*([^\s\n]+)/);
        if (namespaceMatch && namespaceMatch[1]) {
          return namespaceMatch[1];
        }
      }
    } catch (e) {
      console.error('Error extracting namespace from binding response:', e);
    }
    return null;
  }

  public loadClusterBindings(): void {
    this.bindingsService.listClusterBindings().subscribe({
      next: (clusterBindings) => {
        this.clusterBindings.set(clusterBindings);
      },
      error: (err) => {
        console.error('Failed to load cluster bindings:', err);
      },
    });
  }

  /**
   * Get the linked ClusterBinding for a BindingRequest.
   * The linking is done by matching the target namespace from the kubeconfig
   * (stored in binding response) with the ClusterBinding's namespace.
   */
  public getLinkedClusterBinding(request: BindableResourcesRequest): ClusterBinding | undefined {
    const requestNamespace = request.metadata.namespace || 'default';
    const bindingKey = `${requestNamespace}/${request.metadata.name}`;
    const targetNamespace = this.bindingTargetNamespaces().get(bindingKey);

    if (targetNamespace) {
      // Match ClusterBinding by the target namespace from kubeconfig
      return this.clusterBindings().find((cb) => cb.metadata.namespace === targetNamespace);
    }

    // Fallback: try matching by request namespace (legacy behavior)
    return this.clusterBindings().find((cb) => cb.metadata.namespace === requestNamespace);
  }

  public hasLinkedClusterBinding(request: BindableResourcesRequest): boolean {
    return !!this.getLinkedClusterBinding(request);
  }

  /**
   * Get the target namespace for a binding request (parsed from kubeconfig).
   */
  public getLinkedNamespace(request: BindableResourcesRequest): string | undefined {
    const requestNamespace = request.metadata.namespace || 'default';
    const bindingKey = `${requestNamespace}/${request.metadata.name}`;
    return this.bindingTargetNamespaces().get(bindingKey);
  }

  /**
   * Navigate to the ClusterBindings view filtered by the linked binding's namespace.
   */
  public navigateToLinkedBinding(request: BindableResourcesRequest, event: Event): void {
    event.stopPropagation();
    const linkedBinding = this.getLinkedClusterBinding(request);
    if (linkedBinding) {
      // Navigate using Angular router (within the same micro-frontend)
      const namespace = linkedBinding.metadata.namespace || '';
      const name = linkedBinding.metadata.name || '';
      this.router.navigate(['/bindings'], {
        queryParams: { namespace, highlight: name }
      });
    }
  }

  /**
   * Get the health status of a linked ClusterBinding.
   */
  public getLinkedBindingStatus(request: BindableResourcesRequest): string {
    const cb = this.getLinkedClusterBinding(request);
    if (!cb) return 'Unknown';

    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
    }
    return cb.status?.lastHeartbeatTime ? 'Connected' : 'Unknown';
  }

  /**
   * Get CSS class for the linked binding status.
   */
  public getLinkedBindingClass(request: BindableResourcesRequest): string {
    const cb = this.getLinkedClusterBinding(request);
    if (!cb) return 'pending';

    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'success' : 'error';
    }
    return cb.status?.lastHeartbeatTime ? 'success' : 'pending';
  }

  /**
   * Get icon for the linked binding status.
   */
  public getLinkedBindingIcon(request: BindableResourcesRequest): string {
    const cb = this.getLinkedClusterBinding(request);
    if (!cb) return 'hint';

    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'connected' : 'disconnected';
    }
    return cb.status?.lastHeartbeatTime ? 'connected' : 'hint';
  }

  /**
   * Check if the linked ClusterBinding is in Ready state.
   */
  public isLinkedBindingReady(request: BindableResourcesRequest): boolean {
    const cb = this.getLinkedClusterBinding(request);
    if (!cb) return false;

    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    return readyCondition?.status === 'True';
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
        header: 'Delete Binding Request',
        body: `Are you sure you want to delete the binding request "${binding.metadata.name}"?`,
        buttonConfirm: 'Delete',
        buttonDismiss: 'Cancel',
      })
      .then(() => {
        this.bindingsService.deleteBinding(binding.metadata.name, binding.metadata.namespace || 'default').subscribe({
          next: (success) => {
            if (success) {
              LuigiClient.uxManager().showAlert({
                text: `Binding request "${binding.metadata.name}" deleted`,
                type: 'success',
                closeAfter: 3000,
              });
              this.loadBindings();
            } else {
              LuigiClient.uxManager().showAlert({
                text: 'Failed to delete binding request',
                type: 'error',
                closeAfter: 3000,
              });
            }
          },
          error: () => {
            LuigiClient.uxManager().showAlert({
              text: 'Failed to delete binding request',
              type: 'error',
              closeAfter: 3000,
            });
          },
        });
      })
      .catch(() => {
        console.log('Binding request deletion cancelled');
      });
  }

  public openBindingDetails(binding: BindableResourcesRequest): void {
    this.selectedBinding.set(binding);
    this.bindingResponseContent.set('');
    this.showDetailsDialog.set(true);

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
    const bindingName = binding.metadata.name;
    const command = `kubectl get secret ${secretName} -n ${namespace} -o jsonpath='{.data.response}' | base64 -d | kubectl bind deploy --provider-kubeconfig-secret-name kubeconfig-${bindingName} -f -`;
    this.copyToClipboard(command, 'Deploy command copied to clipboard');
  }

  public copyDeployCommand(): void {
    const binding = this.selectedBinding();
    if (!binding) return;

    const command = `kubectl bind deploy --provider-kubeconfig-secret-name kubeconfig-${binding.metadata.name} --file ${binding.metadata.name}-binding.json`;
    this.copyToClipboard(command, 'Deploy command copied to clipboard');
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

  private copyToClipboard(text: string, successMessage: string): void {
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
