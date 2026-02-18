export { handler } from './lambda.js';
export {
  TenantOnboardingService,
  NotFoundError,
  ValidationError
} from './services/tenant-onboarding-service.js';
export type { TenantSetupSnapshot } from './domain/tenant.js';
