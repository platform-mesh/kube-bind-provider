import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import LuigiClient from '@luigi-project/client';
import { ILuigiContextTypes, LuigiContextService } from '@luigi-project/client-support-angular';
import { forkJoin } from 'rxjs';
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

import '@ui5/webcomponents-icons/dist/calendar.js';
import '@ui5/webcomponents-icons/dist/chain-link.js';
import '@ui5/webcomponents-icons/dist/connected.js';
import '@ui5/webcomponents-icons/dist/disconnected.js';
import '@ui5/webcomponents-icons/dist/error.js';
import '@ui5/webcomponents-icons/dist/hint.js';
import '@ui5/webcomponents-icons/dist/navigation-down-arrow.js';
import '@ui5/webcomponents-icons/dist/navigation-right-arrow.js';
import '@ui5/webcomponents-icons/dist/pending.js';
import '@ui5/webcomponents-icons/dist/refresh.js';
import '@ui5/webcomponents-icons/dist/slim-arrow-down.js';
import '@ui5/webcomponents-icons/dist/slim-arrow-right.js';
import '@ui5/webcomponents-icons/dist/sys-enter-2.js';

import { APIServiceExport, BindingsService, ClusterBinding } from '../bindings/bindings.service';

interface ClusterGroup {
  namespace: string;
  clusterBinding: ClusterBinding | null;
  prettyName: string;
  identity: string | null;
  author: string | null;
  exports: APIServiceExport[];
}

@Component({
  selector: 'app-active-bindings',
  standalone: true,
  imports: [
    DynamicPageComponent,
    DynamicPageTitleComponent,
    DynamicPageHeaderComponent,
    AvatarComponent,
    ButtonComponent,
    TitleComponent,
    LabelComponent,
    TextComponent,
    ToolbarComponent,
    ToolbarButtonComponent,
    IconComponent,
    DialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './active-bindings.component.html',
  styleUrl: './active-bindings.component.scss',
})
export class ActiveBindingsComponent {
  private luigiContextService = inject(LuigiContextService);
  private bindingsService = inject(BindingsService);
  private router = inject(Router);

  public luigiContext = toSignal(this.luigiContextService.contextObservable(), {
    initialValue: { context: {}, contextType: ILuigiContextTypes.INIT },
  });

  public exports = signal<APIServiceExport[]>([]);
  public clusterBindings = signal<ClusterBinding[]>([]);
  public loading = signal<boolean>(true);

  public showDetailsDialog = signal<boolean>(false);
  public selectedExport = signal<APIServiceExport | null>(null);

  public collapsedClusters = signal<Set<string>>(new Set());

  public clusterGroups = computed<ClusterGroup[]>(() => {
    const cbByNs = new Map<string, ClusterBinding>();
    for (const cb of this.clusterBindings()) {
      const ns = cb.metadata.namespace || 'default';
      cbByNs.set(ns, cb);
    }

    const groups = new Map<string, ClusterGroup>();
    for (const ex of this.exports()) {
      const ns = ex.metadata.namespace || 'default';
      let g = groups.get(ns);
      if (!g) {
        const cb = cbByNs.get(ns) || null;
        g = {
          namespace: ns,
          clusterBinding: cb,
          prettyName:
            cb?.metadata.annotations?.['backend.kube-bind.io/cluster-pretty-name'] || ns,
          identity: cb?.metadata.annotations?.['backend.kube-bind.io/identity'] || null,
          author: cb?.metadata.annotations?.['backend.kube-bind.io/author'] || null,
          exports: [],
        };
        groups.set(ns, g);
      }
      g.exports.push(ex);
    }

    return [...groups.values()].sort((a, b) => a.prettyName.localeCompare(b.prettyName));
  });

  constructor() {
    effect(() => {
      const ctx = this.luigiContext();
      console.log('[ActiveBindings] Luigi context:', ctx.contextType);
    });
  }

  public ngOnInit(): void {
    LuigiClient.addInitListener(() => {
      LuigiClient.uxManager().showLoadingIndicator();
      this.loadExports();
    });

    setTimeout(() => {
      if (this.loading()) {
        this.loadExports();
      }
    }, 1000);
  }

  public loadExports(): void {
    this.loading.set(true);
    forkJoin({
      exports: this.bindingsService.listAPIServiceExports(),
      clusters: this.bindingsService.listClusterBindings(),
    }).subscribe({
      next: ({ exports, clusters }) => {
        this.exports.set(exports);
        this.clusterBindings.set(clusters);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
      },
      error: (err) => {
        console.error('Failed to load active bindings:', err);
        this.loading.set(false);
        LuigiClient.uxManager().hideLoadingIndicator();
        LuigiClient.uxManager().showAlert({
          text: 'Failed to load active bindings',
          type: 'error',
          closeAfter: 3000,
        });
      },
    });
  }

  public navigateToCluster(group: ClusterGroup, event?: Event): void {
    event?.stopPropagation();
    const cb = group.clusterBinding;
    if (!cb) return;
    this.router.navigate(['/bindings'], {
      queryParams: {
        namespace: cb.metadata.namespace || '',
        highlight: cb.metadata.name || '',
      },
    });
  }

  public isCollapsed(group: ClusterGroup): boolean {
    return this.collapsedClusters().has(group.namespace);
  }

  public toggleCollapsed(group: ClusterGroup, event?: Event): void {
    event?.stopPropagation();
    this.collapsedClusters.update((prev) => {
      const next = new Set(prev);
      if (next.has(group.namespace)) {
        next.delete(group.namespace);
      } else {
        next.add(group.namespace);
      }
      return next;
    });
  }

  public collapseAll(): void {
    this.collapsedClusters.set(new Set(this.clusterGroups().map((g) => g.namespace)));
  }

  public expandAll(): void {
    this.collapsedClusters.set(new Set());
  }

  public allCollapsed(): boolean {
    const groups = this.clusterGroups();
    if (groups.length === 0) return false;
    const collapsed = this.collapsedClusters();
    return groups.every((g) => collapsed.has(g.namespace));
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

  public getResourceLabel(ex: APIServiceExport): string {
    const r = ex.spec.resources?.[0];
    if (!r) return ex.metadata.name;
    return `${r.resource}.${r.group}`;
  }

  public getVersionsLabel(ex: APIServiceExport): string {
    const r = ex.spec.resources?.[0];
    return r?.versions?.join(', ') || '';
  }

  public getOverallHealth(ex: APIServiceExport): 'success' | 'error' | 'pending' {
    const conds = ex.status?.conditions || [];
    if (conds.length === 0) return 'pending';
    const anyFalse = conds.some(c => c.status === 'False');
    if (anyFalse) return 'error';
    const allTrue = conds.every(c => c.status === 'True');
    return allTrue ? 'success' : 'pending';
  }

  public getOverallHealthLabel(ex: APIServiceExport): string {
    const h = this.getOverallHealth(ex);
    if (h === 'success') return 'Active';
    if (h === 'error') return 'Degraded';
    return 'Pending';
  }

  public getOverallHealthIcon(ex: APIServiceExport): string {
    const h = this.getOverallHealth(ex);
    if (h === 'success') return 'connected';
    if (h === 'error') return 'disconnected';
    return 'hint';
  }

  public getConditionClass(cond: { type: string; status: string }): string {
    if (cond.status === 'True') {
      return cond.type.toLowerCase().includes('failed') || cond.type.toLowerCase().includes('error')
        ? 'error'
        : 'success';
    }
    if (cond.status === 'False') return 'error';
    return 'pending';
  }

  public getConditionIcon(cond: { type: string; status: string }): string {
    const cls = this.getConditionClass(cond);
    if (cls === 'success') return 'sys-enter-2';
    if (cls === 'error') return 'error';
    return 'pending';
  }

  public openDetails(ex: APIServiceExport): void {
    this.selectedExport.set(ex);
    this.showDetailsDialog.set(true);
  }

  public closeDetails(): void {
    this.showDetailsDialog.set(false);
    this.selectedExport.set(null);
  }
}
