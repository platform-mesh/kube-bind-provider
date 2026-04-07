import { Routes } from '@angular/router';
import { BindingRequestsComponent } from './binding-requests/binding-requests.component';
import { ClusterBindingsComponent } from './cluster-bindings/cluster-bindings.component';
import { ServiceMappingsComponent } from './service-mappings/service-mappings.component';

export const routes: Routes = [
  { path: '', redirectTo: 'requests', pathMatch: 'full' },
  { path: 'requests', component: BindingRequestsComponent },
  { path: 'bindings', component: ClusterBindingsComponent },
  { path: 'service-mappings', component: ServiceMappingsComponent },
  { path: '**', redirectTo: 'requests' },
];
