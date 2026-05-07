import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  LuigiContextService,
  LuigiContextServiceImpl,
} from '@luigi-project/client-support-angular';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    {
      provide: LuigiContextService,
      useClass: LuigiContextServiceImpl,
    },
  ],
};
