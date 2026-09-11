import type { AuthUser, TenantContext } from './auth';

export interface AuthSnapshot {
  token: string | null;
  user: AuthUser | null;
  selectedTenant: TenantContext | null;
}

type AuthPatch = Partial<{
  token: string | null;
  user: AuthUser | null;
  contexts: TenantContext[];
  selectedTenant: TenantContext | null;
  isAuthenticated: boolean;
  refreshPending: Promise<void> | null;
}>;

let getSnapshot: (() => AuthSnapshot) | null = null;
let setSnapshot: ((patch: AuthPatch) => void) | null = null;

export function registerAuthBridge(getter: () => AuthSnapshot, setter: (patch: AuthPatch) => void) {
  getSnapshot = getter;
  setSnapshot = setter;
}

export function currentAuthSnapshot(): AuthSnapshot {
  return getSnapshot ? getSnapshot() : { token: null, user: null, selectedTenant: null };
}

export function patchAuthState(patch: AuthPatch) {
  if (setSnapshot) setSnapshot(patch);
}
