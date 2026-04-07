/**
 * Service Mappings Component
 *
 * Displays APIBindings from kcp workspace and allows mapping them
 * to kube-bind service exports for remote clusters.
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
  TextComponent,
  TitleComponent,
  ToolbarButtonComponent,
  ToolbarComponent,
} from '@ui5/webcomponents-ngx';
import { FormsModule } from '@angular/forms';

// Import UI5 icons used in the template
import '@ui5/webcomponents-icons/dist/add.js';
import '@ui5/webcomponents-icons/dist/calendar.js';
import '@ui5/webcomponents-icons/dist/connected.js';
import '@ui5/webcomponents-icons/dist/delete.js';
import '@ui5/webcomponents-icons/dist/disconnected.js';
import '@ui5/webcomponents-icons/dist/hint.js';
import '@ui5/webcomponents-icons/dist/refresh.js';
import '@ui5/webcomponents-icons/dist/share-2.js';
import '@ui5/webcomponents-icons/dist/sys-minus.js';

import {
  APIBinding,
  APIServiceExportRequest,
  BindingsService,
  ClusterBinding,
  ExportResource,
  PermissionClaim,
} from '../bindings/bindings.service';

// APIBindings to exclude from the list (internal/system bindings)
const EXCLUDED_APIBINDING_PREFIXES = [
  'core.platform-mesh.io',
  'kube-bind.io',
  'tenancy.kcp.io',
  'topology.kcp.io',
];

@Component({
  selector: 'app-service-mappings',
  standalone: true,
  imports: [
    FormsModule,
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
    InputComponent,
    SelectComponent,
    OptionComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './service-mappings.component.html',
  styleUrl: './service-mappings.component.scss',
})
export class ServiceMappingsComponent {
  // Default namespace for export requests (will be obtained from context in future)
  private readonly DEFAULT_EXPORT_NAMESPACE = 'default';
  private luigiContextService = inject(LuigiContextService);
  private bindingsService = inject(BindingsService);

  public luigiContext = toSignal(this.luigiContextService.contextObservable(), {
    initialValue: { context: {}, contextType: ILuigiContextTypes.INIT },
  });

  public apiBindings = signal<APIBinding[]>([]);
  public exportRequests = signal<APIServiceExportRequest[]>([]);
  public clusterBindings = signal<ClusterBinding[]>([]);
  public loading = signal<boolean>(true);
  public loadingExportRequests = signal<boolean>(false);

  // Export Request Dialog
  public showExportDialog = signal<boolean>(false);
  public selectedAPIBinding = signal<APIBinding | null>(null);
  public exportRequestName = signal<string>('');
  public selectedNamespace = signal<string>('');

  // Permission claims for the dialog
  public permissionClaims = signal<PermissionClaim[]>([]);
  public newPermissionGroup = signal<string>('');
  public newPermissionResource = signal<string>('secrets');

  constructor() {
    effect(() => {
      const ctx = this.luigiContext();
      console.log('[ServiceMappings] Luigi context:', ctx.contextType);
    });
  }

  public ngOnInit(): void {
    // Try to initialize with Luigi context
    LuigiClient.addInitListener(() => {
      console.log('[ServiceMappings] Luigi init listener fired');
      LuigiClient.uxManager().showLoadingIndicator();
      this.loadData();
    });

    // Also try loading after a short delay for standalone mode
    setTimeout(() => {
      if (this.loading()) {
        console.log('[ServiceMappings] Fallback loading triggered');
        this.loadData();
      }
    }, 1000);
  }

  public loadData(): void {
    this.loadAPIBindings();
    this.loadClusterBindings();
  }

  public loadClusterBindings(): void {
    this.bindingsService.listClusterBindings().subscribe({
      next: (clusterBindings) => {
        this.clusterBindings.set(clusterBindings);
        // Load export requests for all namespaces
        this.loadAllExportRequests();
      },
      error: (err) => {
        console.error('Failed to load cluster bindings:', err);
      },
    });
  }

  public loadAllExportRequests(): void {
    // Get unique namespaces from cluster bindings
    const namespaces = this.getClusterBindingNamespaces();
    if (namespaces.length === 0) {
      this.exportRequests.set([]);
      return;
    }

    this.loadingExportRequests.set(true);
    // Load export requests from all namespaces and combine them
    const allRequests: APIServiceExportRequest[] = [];
    let completedCount = 0;

    namespaces.forEach((ns) => {
      this.bindingsService.listAPIServiceExportRequests(ns).subscribe({
        next: (requests) => {
          allRequests.push(...requests);
          completedCount++;
          if (completedCount === namespaces.length) {
            this.exportRequests.set(allRequests);
            this.loadingExportRequests.set(false);
          }
        },
        error: (err) => {
          console.error(`Failed to load export requests from namespace ${ns}:`, err);
          completedCount++;
          if (completedCount === namespaces.length) {
            this.exportRequests.set(allRequests);
            this.loadingExportRequests.set(false);
          }
        },
      });
    });
  }

  public getClusterBindingNamespaces(): string[] {
    const namespaces = new Set<string>();
    this.clusterBindings().forEach((cb) => {
      if (cb.metadata.namespace) {
        namespaces.add(cb.metadata.namespace);
      }
    });
    return Array.from(namespaces);
  }

  public loadAPIBindings(): void {
    this.loading.set(true);
    this.bindingsService.listAPIBindings().subscribe({
      next: (apiBindings) => {
        // Filter out excluded bindings
        const filtered = apiBindings.filter((ab) => {
          return !EXCLUDED_APIBINDING_PREFIXES.some((prefix) => ab.metadata.name.startsWith(prefix));
        });
        this.apiBindings.set(filtered);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
      },
      error: (err) => {
        console.error('Failed to load API bindings:', err);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
        LuigiClient.uxManager().showAlert({
          text: 'Failed to load API bindings',
          type: 'error',
          closeAfter: 3000,
        });
      },
    });
  }


  // Export Dialog methods
  public openExportDialog(ab: APIBinding): void {
    this.selectedAPIBinding.set(ab);
    // Default name from the first bound resource or the binding name
    const defaultName = ab.status?.boundResources?.[0]?.resource || ab.metadata.name;
    this.exportRequestName.set(defaultName);
    this.permissionClaims.set([]);
    // Set default namespace to first available cluster binding namespace
    const namespaces = this.getClusterBindingNamespaces();
    this.selectedNamespace.set(namespaces.length > 0 ? namespaces[0] : '');
    this.showExportDialog.set(true);
  }

  public onNamespaceChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedNamespace.set(select.value);
  }

  public closeExportDialog(): void {
    this.showExportDialog.set(false);
    this.selectedAPIBinding.set(null);
    this.permissionClaims.set([]);
  }

  public addPermissionClaim(): void {
    const group = this.newPermissionGroup();
    const resource = this.newPermissionResource();
    if (resource) {
      const claims = [...this.permissionClaims()];
      claims.push({ group, resource });
      this.permissionClaims.set(claims);
      this.newPermissionGroup.set('');
      this.newPermissionResource.set('secrets');
    }
  }

  public removePermissionClaim(index: number): void {
    const claims = [...this.permissionClaims()];
    claims.splice(index, 1);
    this.permissionClaims.set(claims);
  }

  public createExportRequest(): void {
    const ab = this.selectedAPIBinding();
    if (!ab) return;

    const name = this.exportRequestName();
    const namespace = this.selectedNamespace();

    if (!namespace) {
      LuigiClient.uxManager().showAlert({
        text: 'Please select a target namespace',
        type: 'error',
        closeAfter: 3000,
      });
      return;
    }

    // Build resources from bound resources
    const resources: ExportResource[] = (ab.status?.boundResources || []).map((br) => ({
      group: br.group,
      resource: br.resource,
      versions: ['v1alpha1'], // Default version, could be extracted from APIBinding if available
    }));

    if (resources.length === 0) {
      LuigiClient.uxManager().showAlert({
        text: 'No bound resources found in APIBinding',
        type: 'error',
        closeAfter: 3000,
      });
      return;
    }

    this.bindingsService
      .createAPIServiceExportRequest(name, namespace, resources, this.permissionClaims())
      .subscribe({
        next: (success) => {
          if (success) {
            LuigiClient.uxManager().showAlert({
              text: 'Export request created successfully',
              type: 'success',
              closeAfter: 3000,
            });
            this.closeExportDialog();
            this.loadAllExportRequests();
          } else {
            LuigiClient.uxManager().showAlert({
              text: 'Failed to create export request',
              type: 'error',
              closeAfter: 3000,
            });
          }
        },
        error: (err) => {
          console.error('Failed to create export request:', err);
          LuigiClient.uxManager().showAlert({
            text: 'Failed to create export request',
            type: 'error',
            closeAfter: 3000,
          });
        },
      });
  }

  public deleteExportRequest(req: APIServiceExportRequest): void {
    const namespace = req.metadata.namespace || this.DEFAULT_EXPORT_NAMESPACE;
    LuigiClient.uxManager()
      .showConfirmationModal({
        header: 'Delete Export Request',
        body: `Are you sure you want to delete the export request "${req.metadata.name}"?`,
        buttonConfirm: 'Delete',
        buttonDismiss: 'Cancel',
      })
      .then(() => {
        this.bindingsService.deleteAPIServiceExportRequest(req.metadata.name, namespace).subscribe({
          next: (success) => {
            if (success) {
              LuigiClient.uxManager().showAlert({
                text: 'Export request deleted successfully',
                type: 'success',
                closeAfter: 3000,
              });
              this.loadAllExportRequests();
            } else {
              LuigiClient.uxManager().showAlert({
                text: 'Failed to delete export request',
                type: 'error',
                closeAfter: 3000,
              });
            }
          },
        });
      })
      .catch(() => {
        console.log('Export request deletion cancelled');
      });
  }

  public getExportRequestStatus(req: APIServiceExportRequest): string {
    const readyCondition = req.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
    }
    return req.status?.phase || 'Pending';
  }

  public getExportRequestClass(req: APIServiceExportRequest): string {
    const readyCondition = req.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'success' : 'error';
    }
    return 'pending';
  }

  public getExportRequestStatusMessage(req: APIServiceExportRequest): string | null {
    const readyCondition = req.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition && readyCondition.status !== 'True') {
      // Return reason and/or message if available
      if (readyCondition.message) {
        return readyCondition.reason
          ? `${readyCondition.reason}: ${readyCondition.message}`
          : readyCondition.message;
      }
      return readyCondition.reason || null;
    }
    return null;
  }

  public getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(/[-_.\s]+/);
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

  public getReadyStatus(ab: APIBinding): string {
    const readyCondition = ab.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
    }
    return 'Unknown';
  }

  public getReadyClass(ab: APIBinding): string {
    const readyCondition = ab.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'success' : 'error';
    }
    return 'pending';
  }

  public getReadyIcon(ab: APIBinding): string {
    const readyCondition = ab.status?.conditions?.find((c) => c.type === 'Ready');
    if (readyCondition) {
      return readyCondition.status === 'True' ? 'connected' : 'disconnected';
    }
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

  public getBoundResources(ab: APIBinding): string {
    const resources = ab.status?.boundResources;
    if (!resources || resources.length === 0) return 'None';
    return resources.map((r) => `${r.resource}.${r.group}`).join(', ');
  }
}
