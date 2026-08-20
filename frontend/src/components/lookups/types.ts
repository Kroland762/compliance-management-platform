export type LookupKind =
  | 'departments' | 'personnel' | 'auditors' | 'roles' | 'assets' | 'risks'
  | 'assessment-templates' | 'product-questionnaires' | 'product-types'
  | 'account-data-sources' | 'account-rules';

export interface LookupOption {
  value: string;
  label: string;
  disabled?: boolean;
  meta?: Record<string, unknown>;
  searchText?: string;
}

export interface LookupPage {
  items: LookupOption[];
  selectedItems: LookupOption[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean };
}
