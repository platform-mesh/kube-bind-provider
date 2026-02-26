/**
 * Cluster Bindings Service - GraphQL API Client
 *
 * This service manages BindableResourcesRequest resources which represent
 * external cluster onboarding requests in the kube-bind system.
 *
 * Flow:
 * 1. User creates a BindableResourcesRequest with their cluster identity
 * 2. Backend processes the request and generates onboarding credentials
 * 3. Credentials are stored in a Secret referenced by status.kubeconfigSecretRef
 * 4. User retrieves the secret content to configure their external cluster
 *
 * To get cluster identity on the external cluster:
 *   kubectl bind cluster-identity
 * or manually:
 *   kubectl get namespace kube-system -o jsonpath='{.metadata.uid}'
 */
import { Injectable, inject } from '@angular/core';
import { LuigiContextService } from '@luigi-project/client-support-angular';
import { from, map, Observable, of, switchMap, catchError, filter } from 'rxjs';

export interface SecretKeyRef {
  name: string;
  key: string;
}

export interface ClusterIdentity {
  identity: string;
}

export interface BindableResourcesRequest {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
  };
  spec: {
    templateRef?: {
      name: string;
    };
    author?: string;
    clusterIdentity: ClusterIdentity;
    kubeconfigSecretRef?: SecretKeyRef;
    ttlAfterFinished?: string;
  };
  status?: {
    phase?: 'Pending' | 'Failed' | 'Succeeded';
    kubeconfigSecretRef?: SecretKeyRef;
    completionTime?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

export interface Namespace {
  metadata: {
    name: string;
  };
}

export interface ClusterBinding {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    kubeconfigSecretRef?: SecretKeyRef;
    providerPrettyName?: string;
  };
  status?: {
    lastHeartbeatTime?: string;
    heartbeatInterval?: string;
    konnectorVersion?: string;
    consumerSecretRef?: {
      name: string;
      namespace: string;
    };
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

export interface Secret {
  metadata: {
    name: string;
    namespace?: string;
  };
  data?: Record<string, string>;
}

export interface BindingListResponse {
  kube_bind_io: {
    v1alpha2: {
      BindableResourcesRequests: {
        items: BindableResourcesRequest[];
      };
    };
  };
}

export interface NamespaceListResponse {
  v1: {
    Namespaces: {
      items: Namespace[];
    };
  };
}

export interface SecretResponse {
  v1: {
    Secret: Secret;
  };
}

export interface ClusterBindingListResponse {
  kube_bind_io: {
    v1alpha2: {
      ClusterBindings: {
        items: ClusterBinding[];
      };
    };
  };
}

export interface APIBinding {
  metadata: {
    name: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    reference?: {
      export?: {
        path?: string;
        name?: string;
      };
    };
  };
  status?: {
    phase?: string;
    boundResources?: Array<{
      group: string;
      resource: string;
    }>;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

export interface APIBindingListResponse {
  apis_kcp_io: {
    v1alpha1: {
      APIBindings: {
        items: APIBinding[];
      };
    };
  };
}

export interface PermissionClaim {
  group: string;
  resource: string;
  selector?: {
    labelSelector?: {
      matchLabels?: Record<string, string>;
    };
  };
}

export interface ExportResource {
  group: string;
  resource: string;
  versions: string[];
}

export interface APIServiceExportRequest {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  spec: {
    permissionClaims?: PermissionClaim[];
    resources?: ExportResource[];
  };
  status?: {
    phase?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
  };
}

export interface APIServiceExportRequestListResponse {
  kube_bind_io: {
    v1alpha2: {
      APIServiceExportRequests: {
        items: APIServiceExportRequest[];
      };
    };
  };
}

const LIST_BINDINGS_QUERY = `
  query ListBindings {
    kube_bind_io {
      v1alpha2 {
        BindableResourcesRequests {
          items {
            metadata {
              name
              namespace
              creationTimestamp
            }
            spec {
              templateRef {
                name
              }
              author
              clusterIdentity {
                identity
              }
              kubeconfigSecretRef {
                name
                key
              }
            }
            status {
              phase
              kubeconfigSecretRef {
                name
                key
              }
              completionTime
              conditions {
                type
                status
                reason
                message
                lastTransitionTime
              }
            }
          }
        }
      }
    }
  }
`;

const LIST_NAMESPACES_QUERY = `
  query ListNamespaces {
    v1 {
      Namespaces {
        items {
          metadata {
            name
          }
        }
      }
    }
  }
`;

const GET_SECRET_QUERY = `
  query GetSecret($name: String!, $namespace: String!) {
    v1 {
      Secret(name: $name, namespace: $namespace) {
        metadata {
          name
          namespace
        }
        data
      }
    }
  }
`;

const LIST_CLUSTER_BINDINGS_QUERY = `
  query ListClusterBindings {
    kube_bind_io {
      v1alpha2 {
        ClusterBindings {
          items {
            metadata {
              name
              namespace
              creationTimestamp
              labels
            }
            spec {
              kubeconfigSecretRef {
                name
                key
              }
              providerPrettyName
            }
            status {
              lastHeartbeatTime
              heartbeatInterval
              konnectorVersion
              consumerSecretRef {
                name
                namespace
              }
              conditions {
                type
                status
                reason
                message
                lastTransitionTime
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_BINDING_MUTATION = `
  mutation CreateBinding($name: String!, $namespace: String!, $author: String, $clusterIdentity: String!, $ttlAfterFinished: String) {
    kube_bind_io {
      v1alpha2 {
        createBindableResourcesRequest(
          namespace: $namespace
          object: {
            metadata: { name: $name }
            spec: {
              author: $author
              clusterIdentity: { identity: $clusterIdentity }
              ttlAfterFinished: $ttlAfterFinished
            }
          }
        ) {
          metadata {
            name
            namespace
          }
        }
      }
    }
  }
`;

const DELETE_BINDING_MUTATION = `
  mutation DeleteBinding($name: String!, $namespace: String!) {
    kube_bind_io {
      v1alpha2 {
        deleteBindableResourcesRequest(name: $name, namespace: $namespace)
      }
    }
  }
`;

const LIST_API_BINDINGS_QUERY = `
  query ListAPIBindings {
    apis_kcp_io {
      v1alpha1 {
        APIBindings {
          items {
            metadata {
              name
              creationTimestamp
              labels
              annotations
            }
            spec {
              reference {
                export {
                  path
                  name
                }
              }
            }
            status {
              phase
              boundResources {
                group
                resource
              }
              conditions {
                type
                status
                reason
                message
                lastTransitionTime
              }
            }
          }
        }
      }
    }
  }
`;

const DELETE_CLUSTER_BINDING_MUTATION = `
  mutation DeleteClusterBinding($name: String!, $namespace: String!) {
    kube_bind_io {
      v1alpha2 {
        deleteClusterBinding(name: $name, namespace: $namespace)
      }
    }
  }
`;

const LIST_API_SERVICE_EXPORT_REQUESTS_QUERY = `
  query ListAPIServiceExportRequests($namespace: String!) {
    kube_bind_io {
      v1alpha2 {
        APIServiceExportRequests(namespace: $namespace) {
          items {
            metadata {
              name
              namespace
              creationTimestamp
              labels
            }
            spec {
              permissionClaims {
                group
                resource
              }
              resources {
                group
                resource
                versions
              }
            }
            status {
              phase
              conditions {
                type
                status
                reason
                message
                lastTransitionTime
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_API_SERVICE_EXPORT_REQUEST_MUTATION = `
  mutation CreateAPIServiceExportRequest(
    $name: String!,
    $namespace: String!,
    $resources: [KubeBindIoV1alpha2APIServiceExportRequestspecspecresourcesInput!]
  ) {
    kube_bind_io {
      v1alpha2 {
        createAPIServiceExportRequest(
          namespace: $namespace
          object: {
            metadata: { name: $name }
            spec: {
              resources: $resources
            }
          }
        ) {
          metadata {
            name
            namespace
          }
        }
      }
    }
  }
`;

const DELETE_API_SERVICE_EXPORT_REQUEST_MUTATION = `
  mutation DeleteAPIServiceExportRequest($name: String!, $namespace: String!) {
    kube_bind_io {
      v1alpha2 {
        deleteAPIServiceExportRequest(name: $name, namespace: $namespace)
      }
    }
  }
`;

interface GraphQLConfig {
  endpoint: string;
  token: string | null;
}

@Injectable({ providedIn: 'root' })
export class BindingsService {
  private luigiContextService = inject(LuigiContextService);

  /**
   * Extracts GraphQL endpoint and auth token from the Luigi context.
   */
  private getGraphQLConfig(): Observable<GraphQLConfig> {
    return this.luigiContextService.contextObservable().pipe(
      filter((ctx) => {
        const hasContext = !!ctx?.context && Object.keys(ctx.context).length > 0;
        console.log('[BindingsService] Context check:', { hasContext, ctx });
        return hasContext;
      }),
      map((ctx) => {
        const context = ctx.context as any;
        const token = context.token || null;
        let endpoint = context.portalContext?.crdGatewayApiUrl;
        if (!endpoint) {
          console.warn('crdGatewayApiUrl not found in context, falling back to default');
          endpoint = context.portalBaseUrl + '/graphql';
        }
        console.log('[BindingsService] Using endpoint:', endpoint);
        return { endpoint, token };
      })
    );
  }

  /**
   * Get current user email from Luigi context for auto-populating author field.
   */
  public getCurrentUserEmail(): Observable<string | null> {
    return this.luigiContextService.contextObservable().pipe(
      filter((ctx) => !!ctx?.context),
      map((ctx) => {
        const context = ctx.context as any;
        // Try various places where user email might be stored
        return (
          context.userEmail ||
          context.portalContext?.userEmail ||
          context.user?.email ||
          context.portalContext?.user?.email ||
          null
        );
      })
    );
  }

  private buildHeaders(token: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * List all BindableResourcesRequests (cluster binding requests).
   */
  listBindings(): Observable<BindableResourcesRequest[]> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: LIST_BINDINGS_QUERY,
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: { data: BindingListResponse }) => {
        return response.data?.kube_bind_io?.v1alpha2?.BindableResourcesRequests?.items || [];
      }),
      catchError((error) => {
        console.error('Error fetching bindings:', error);
        return of([]);
      })
    );
  }

  /**
   * List all Namespaces available to the user.
   */
  listNamespaces(): Observable<Namespace[]> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: LIST_NAMESPACES_QUERY,
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: { data: NamespaceListResponse }) => {
        return response.data?.v1?.Namespaces?.items || [];
      }),
      catchError((error) => {
        console.error('Error fetching namespaces:', error);
        return of([]);
      })
    );
  }

  /**
   * Get the secret containing the binding response/kubeconfig.
   */
  getSecret(name: string, namespace: string): Observable<Secret | null> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: GET_SECRET_QUERY,
              variables: { name, namespace },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: { data: SecretResponse }) => {
        return response.data?.v1?.Secret || null;
      }),
      catchError((error) => {
        console.error('Error fetching secret:', error);
        return of(null);
      })
    );
  }

  /**
   * Create a new BindableResourcesRequest to onboard an external cluster.
   *
   * @param clusterName - Name for this cluster binding (becomes metadata.name)
   * @param namespace - Namespace to create the request in
   * @param clusterIdentity - Unique identity of the external cluster (from kubectl bind cluster-identity)
   * @param author - Optional author identifier (e.g., user email)
   * @param ttlAfterFinished - Optional TTL duration for the request (e.g., '1h', '30m')
   */
  createBinding(
    clusterName: string,
    namespace: string,
    clusterIdentity: string,
    author?: string,
    ttlAfterFinished?: string
  ): Observable<boolean> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: CREATE_BINDING_MUTATION,
              variables: {
                name: clusterName,
                namespace,
                author: author || 'portal-ui',
                clusterIdentity,
                ttlAfterFinished: ttlAfterFinished || '1h',
              },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: any) => {
        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          return false;
        }
        return !!response.data?.kube_bind_io?.v1alpha2?.createBindableResourcesRequest;
      }),
      catchError((error) => {
        console.error('Error creating binding:', error);
        return of(false);
      })
    );
  }

  /**
   * List all ClusterBindings (active bindings from remote clusters).
   */
  listClusterBindings(): Observable<ClusterBinding[]> {
    console.log('[BindingsService] listClusterBindings called');
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) => {
        console.log('[BindingsService] Fetching cluster bindings from:', endpoint);
        return from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: LIST_CLUSTER_BINDINGS_QUERY,
            }),
          }).then((res) => res.json())
        );
      }),
      map((response: { data: ClusterBindingListResponse }) => {
        console.log('[BindingsService] ClusterBindings response:', response);
        return response.data?.kube_bind_io?.v1alpha2?.ClusterBindings?.items || [];
      }),
      catchError((error) => {
        console.error('Error fetching cluster bindings:', error);
        return of([]);
      })
    );
  }

  /**
   * List all APIBindings from kcp workspace.
   */
  listAPIBindings(): Observable<APIBinding[]> {
    console.log('[BindingsService] listAPIBindings called');
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) => {
        console.log('[BindingsService] Fetching API bindings from:', endpoint);
        return from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: LIST_API_BINDINGS_QUERY,
            }),
          }).then((res) => res.json())
        );
      }),
      map((response: { data: APIBindingListResponse }) => {
        console.log('[BindingsService] APIBindings response:', response);
        return response.data?.apis_kcp_io?.v1alpha1?.APIBindings?.items || [];
      }),
      catchError((error) => {
        console.error('Error fetching API bindings:', error);
        return of([]);
      })
    );
  }

  /**
   * Delete a BindableResourcesRequest.
   */
  deleteBinding(name: string, namespace: string): Observable<boolean> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: DELETE_BINDING_MUTATION,
              variables: { name, namespace },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: any) => {
        return !!response.data?.kube_bind_io?.v1alpha2?.deleteBindableResourcesRequest;
      }),
      catchError((error) => {
        console.error('Error deleting binding:', error);
        return of(false);
      })
    );
  }

  /**
   * Delete a ClusterBinding.
   */
  deleteClusterBinding(name: string, namespace: string): Observable<boolean> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: DELETE_CLUSTER_BINDING_MUTATION,
              variables: { name, namespace },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: any) => {
        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          return false;
        }
        return !!response.data?.kube_bind_io?.v1alpha2?.deleteClusterBinding;
      }),
      catchError((error) => {
        console.error('Error deleting cluster binding:', error);
        return of(false);
      })
    );
  }

  /**
   * List all APIServiceExportRequests in a namespace.
   */
  listAPIServiceExportRequests(namespace: string): Observable<APIServiceExportRequest[]> {
    console.log('[BindingsService] listAPIServiceExportRequests called for namespace:', namespace);
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) => {
        console.log('[BindingsService] Fetching API service export requests from:', endpoint);
        return from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: LIST_API_SERVICE_EXPORT_REQUESTS_QUERY,
              variables: { namespace },
            }),
          }).then((res) => res.json())
        );
      }),
      map((response: { data: APIServiceExportRequestListResponse }) => {
        console.log('[BindingsService] APIServiceExportRequests response:', response);
        return response.data?.kube_bind_io?.v1alpha2?.APIServiceExportRequests?.items || [];
      }),
      catchError((error) => {
        console.error('Error fetching API service export requests:', error);
        return of([]);
      })
    );
  }

  /**
   * Create a new APIServiceExportRequest.
   * Note: permissionClaims is currently not supported in the GraphQL schema
   */
  createAPIServiceExportRequest(
    name: string,
    namespace: string,
    resources: ExportResource[],
    _permissionClaims?: PermissionClaim[]
  ): Observable<boolean> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: CREATE_API_SERVICE_EXPORT_REQUEST_MUTATION,
              variables: {
                name,
                namespace,
                resources,
              },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: any) => {
        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          return false;
        }
        return !!response.data?.kube_bind_io?.v1alpha2?.createAPIServiceExportRequest;
      }),
      catchError((error) => {
        console.error('Error creating API service export request:', error);
        return of(false);
      })
    );
  }

  /**
   * Delete an APIServiceExportRequest.
   */
  deleteAPIServiceExportRequest(name: string, namespace: string): Observable<boolean> {
    return this.getGraphQLConfig().pipe(
      switchMap(({ endpoint, token }) =>
        from(
          fetch(endpoint, {
            method: 'POST',
            headers: this.buildHeaders(token),
            body: JSON.stringify({
              query: DELETE_API_SERVICE_EXPORT_REQUEST_MUTATION,
              variables: { name, namespace },
            }),
          }).then((res) => res.json())
        )
      ),
      map((response: any) => {
        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          return false;
        }
        return !!response.data?.kube_bind_io?.v1alpha2?.deleteAPIServiceExportRequest;
      }),
      catchError((error) => {
        console.error('Error deleting API service export request:', error);
        return of(false);
      })
    );
  }
}
