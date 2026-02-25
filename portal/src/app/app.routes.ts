import { Routes } from '@angular/router';
import { BindingRequestsComponent } from './binding-requests/binding-requests.component';
import { ClusterBindingsComponent } from './cluster-bindings/cluster-bindings.component';

export const routes: Routes = [
  { path: '', redirectTo: 'requests', pathMatch: 'full' },
  { path: 'requests', component: BindingRequestsComponent },
  { path: 'bindings', component: ClusterBindingsComponent },
  { path: '**', redirectTo: 'requests' },
];
