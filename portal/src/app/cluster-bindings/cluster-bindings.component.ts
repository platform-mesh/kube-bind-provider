/**
 * Cluster Bindings Component
 *
 * Displays ClusterBinding resources which represent active bindings
 * from remote clusters that have completed the binding process.
 */
import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
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
  LabelComponent,
  TextComponent,
  TitleComponent,
  ToolbarButtonComponent,
  ToolbarComponent,
} from '@ui5/webcomponents-ngx';

// Import UI5 icons used in the template
import '@ui5/webcomponents-icons/dist/calendar.js';
import '@ui5/webcomponents-icons/dist/chain-link.js';
import '@ui5/webcomponents-icons/dist/connected.js';
import '@ui5/webcomponents-icons/dist/copy.js';
import '@ui5/webcomponents-icons/dist/delete.js';
import '@ui5/webcomponents-icons/dist/disconnected.js';
import '@ui5/webcomponents-icons/dist/refresh.js';
import '@ui5/webcomponents-icons/dist/hint.js';

import { BindingsService, ClusterBinding } from '../bindings/bindings.service';

@Component({
  selector: 'app-cluster-bindings',
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
    ButtonComponent,
    DialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './cluster-bindings.component.html',
  styleUrl: './cluster-bindings.component.scss',
})
export class ClusterBindingsComponent {
  private luigiContextService = inject(LuigiContextService);
  private bindingsService = inject(BindingsService);
  private route = inject(ActivatedRoute);

  public luigiContext = toSignal(this.luigiContextService.contextObservable(), {
    initialValue: { context: {}, contextType: ILuigiContextTypes.INIT },
  });

  public clusterBindings = signal<ClusterBinding[]>([]);
  public loading = signal<boolean>(true);

  // Highlighted binding from query params (namespace/name)
  public highlightedNamespace = signal<string | null>(null);
  public highlightedName = signal<string | null>(null);

  // Cluster Binding details dialog
  public showClusterBindingDetailsDialog = signal<boolean>(false);
  public selectedClusterBinding = signal<ClusterBinding | null>(null);

  constructor() {
    effect(() => {
      const ctx = this.luigiContext();
      console.log('[ClusterBindings] Luigi context:', ctx.contextType);
    });
  }

  public ngOnInit(): void {
    // Try to initialize with Luigi context
    LuigiClient.addInitListener(() => {
      console.log('[ClusterBindings] Luigi init listener fired');
      LuigiClient.uxManager().showLoadingIndicator();
      this.loadClusterBindings();
    });

    // Also try loading after a short delay for standalone mode
    setTimeout(() => {
      if (this.loading()) {
        console.log('[ClusterBindings] Fallback loading triggered');
        this.loadClusterBindings();
      }
    }, 1000);

    // Check for highlight query params
    this.route.queryParams.subscribe(params => {
      if (params['namespace']) {
        this.highlightedNamespace.set(params['namespace']);
      }
      if (params['highlight']) {
        this.highlightedName.set(params['highlight']);
      }
    });
  }

  /**
   * Check if a binding should be highlighted (from navigation)
   */
  public isHighlighted(cb: ClusterBinding): boolean {
    const ns = this.highlightedNamespace();
    const name = this.highlightedName();
    if (!ns && !name) return false;
    return cb.metadata.namespace === ns || cb.metadata.name === name;
  }

  public loadClusterBindings(): void {
    this.loading.set(true);
    this.bindingsService.listClusterBindings().subscribe({
      next: (clusterBindings) => {
        this.clusterBindings.set(clusterBindings);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
      },
      error: (err) => {
        console.error('Failed to load cluster bindings:', err);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
        LuigiClient.uxManager().showAlert({
          text: 'Failed to load cluster bindings',
          type: 'error',
          closeAfter: 3000,
        });
      },
    });
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
    if (lower === 'succeeded' || lower === 'connected' || lower === 'ready') return 'success';
    if (lower === 'failed' || lower === 'error') return 'error';
    return 'pending';
  }

  public getPhaseIcon(phase: string | undefined): string {
    if (!phase) return 'disconnected';
    const lower = phase.toLowerCase();
    if (lower === 'succeeded' || lower === 'connected' || lower === 'ready') return 'connected';
    if (lower === 'failed' || lower === 'error') return 'disconnected';
    return 'hint';
  }

  /**
   * Get health status based on conditions (specifically the Ready condition)
   */
  public getHealthStatus(cb: ClusterBinding): string {
    const readyCondition = cb.status?.conditions?.find(c => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
    }
    // If no Ready condition, check for Healthy condition
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
   * Delete a ClusterBinding after confirmation.
   */
  public deleteClusterBinding(cb: ClusterBinding, event: Event): void {
    event.stopPropagation();
    LuigiClient.uxManager()
      .showConfirmationModal({
        type: 'warning',
        header: 'Delete Cluster Binding',
        body: `Are you sure you want to delete the cluster binding "${cb.metadata.name}" in namespace "${cb.metadata.namespace}"? This will disconnect the remote cluster.`,
        buttonConfirm: 'Delete',
        buttonDismiss: 'Cancel',
      })
      .then(() => {
        this.bindingsService.deleteClusterBinding(cb.metadata.name, cb.metadata.namespace || 'default').subscribe({
          next: (success) => {
            if (success) {
              LuigiClient.uxManager().showAlert({
                text: `Cluster binding "${cb.metadata.name}" deleted`,
                type: 'success',
                closeAfter: 3000,
              });
              this.loadClusterBindings();
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

  // Cluster Binding Details Dialog methods
  public openClusterBindingDetails(cb: ClusterBinding): void {
    this.selectedClusterBinding.set(cb);
    this.showClusterBindingDetailsDialog.set(true);
  }

  public closeClusterBindingDetailsDialog(): void {
    this.showClusterBindingDetailsDialog.set(false);
    this.selectedClusterBinding.set(null);
  }

  public copyClusterBindingCommand(): void {
    const cb = this.selectedClusterBinding();
    if (!cb?.status?.consumerSecretRef) return;

    const command = `kubectl apply -f - <<EOF
apiVersion: kube-bind.io/v1alpha2
kind: APIServiceBindingBundle
metadata:
  name: all-bindings
spec:
  kubeconfigSecretRef:
    key: kubeconfig
    name: ${cb.status.consumerSecretRef.name}
    namespace: ${cb.status.consumerSecretRef.namespace}
EOF`;
    this.copyToClipboard(command, 'Command copied to clipboard');
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
