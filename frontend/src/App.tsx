import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from './store/auth';
import PrivateRoute from './components/PrivateRoute';
import MainLayout from './components/MainLayout';
import Login from './views/Login';
import TenantSelection from './views/TenantSelection';
import ChangePassword from './views/ChangePassword';
import InvitationAcceptance from './views/InvitationAcceptance';

const Dashboard = lazy(() => import('./views/Dashboard'));
const TemplateManagement = lazy(() => import('./views/admin/TemplateManagement'));
const QualificationLedger = lazy(() => import('./views/QualificationLedger'));
const UserManagement = lazy(() => import('./views/admin/UserManagement'));
const RoleManagement = lazy(() => import('./views/RoleManagement'));
const AuditLogViewer = lazy(() => import('./views/admin/AuditLogViewer'));
const TenantManagement = lazy(() => import('./views/admin/TenantManagement'));
const ReviewTaskList = lazy(() => import('./views/auditor/ReviewTaskList'));
const RiskDetail = lazy(() => import('./views/RiskDetail'));
const RiskForm = lazy(() => import('./views/RiskForm'));
const AssetLedger = lazy(() => import('./views/AssetLedger'));
const AssessmentWizard = lazy(() => import('./views/AssessmentWizard'));
const EvaluationWorkbench = lazy(() => import('./views/EvaluationWorkbench'));
const RemediationActions = lazy(() => import('./views/RemediationActions'));
const RemediationActionDetail = lazy(() => import('./views/RemediationActionDetail'));
const AssessmentPlans = lazy(() => import('./views/AssessmentPlans'));
const AssessmentProjectDetail = lazy(() => import('./views/AssessmentProjectDetail'));
const WorkItems = lazy(() => import('./views/WorkItems'));
const Findings = lazy(() => import('./views/Findings'));
const RiskAndRemediation = lazy(() => import('./views/RiskAndRemediation'));
const Settings = lazy(() => import('./views/Settings'));
const OrganizationManagement = lazy(() => import('./views/OrganizationManagement'));
const AccountAudit = lazy(() => import('./views/AccountAudit'));
const AccountDashboard = lazy(() => import('./views/account/Dashboard'));
const DataSourceList = lazy(() => import('./views/account/DataSourceList'));
const DataSourceForm = lazy(() => import('./views/account/DataSourceForm'));
const DataSourceDetail = lazy(() => import('./views/account/DataSourceDetail'));
const RuleList = lazy(() => import('./views/account/RuleList'));
const RuleDetail = lazy(() => import('./views/account/RuleDetail'));
const TaskList = lazy(() => import('./views/account/TaskList'));
const TaskHistory = lazy(() => import('./views/account/TaskHistory'));
const ProblemList = lazy(() => import('./views/account/ProblemList'));
const ProductComplianceList = lazy(() => import('./views/product-compliance/ProductList'));
const ProductComplianceDetail = lazy(() => import('./views/product-compliance/ProductDetail'));
const ProductDossierDetail = lazy(() => import('./views/product-compliance/DossierDetail'));
const ProductComplianceReview = lazy(() => import('./views/product-compliance/ReviewQueue'));
const ProductComplianceConfiguration = lazy(() => import('./views/product-compliance/Configuration'));

const routeFallback = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
    <Spin />
  </div>
);

function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  useEffect(() => {
    loadFromStorage();
    refreshToken().catch(() => {});
  }, []);

  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/tenant-select" element={<TenantSelection />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/accept-invitation" element={<InvitationAcceptance />} />
        <Route path="/" element={<PrivateRoute><MainLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="templates" element={<PrivateRoute permission={['templates', 'read']}><TemplateManagement /></PrivateRoute>} />
          <Route path="qualifications" element={<PrivateRoute permission={['qualifications', 'read']}><QualificationLedger /></PrivateRoute>} />
          <Route path="users" element={<PrivateRoute permission={['users', 'read']}><UserManagement /></PrivateRoute>} />
          <Route path="roles" element={<PrivateRoute permission={['users', 'read']}><RoleManagement /></PrivateRoute>} />
          <Route path="tenants" element={<PrivateRoute permission={['tenants', 'read']}><TenantManagement /></PrivateRoute>} />
          <Route path="organization" element={<PrivateRoute permission={['organization', 'read']}><OrganizationManagement /></PrivateRoute>} />
          <Route path="audit-logs" element={<PrivateRoute permission={['audit_logs', 'read']}><AuditLogViewer /></PrivateRoute>} />
          <Route path="assessments" element={<PrivateRoute permission={['tasks', 'read']}><ReviewTaskList /></PrivateRoute>} />
          <Route path="assessments/:id" element={<PrivateRoute permission={['tasks', 'read']}><AssessmentProjectDetail /></PrivateRoute>} />
          <Route path="tasks/review" element={<Navigate to="/assessments" replace />} />
          <Route path="tasks/review/:id" element={<Navigate to="/tasks/review" replace />} />
          <Route path="tasks/configure/:id" element={<Navigate to="/assessments/new" replace />} />
          <Route path="assessments/new" element={<PrivateRoute permission={['tasks', 'create']}><AssessmentWizard /></PrivateRoute>} />
          <Route path="assessments/:id/workbench" element={<PrivateRoute permission={['evaluations', 'read']}><EvaluationWorkbench /></PrivateRoute>} />
          <Route path="work-items" element={<WorkItems />} />
          <Route path="my-tasks" element={<Navigate to="/work-items" replace />} />
          <Route path="my-tasks/:id" element={<Navigate to="/work-items" replace />} />
          <Route path="findings" element={<PrivateRoute permission={['findings', 'read']}><Findings /></PrivateRoute>} />
          <Route path="governance" element={<RiskAndRemediation />} />
          <Route path="risks" element={<Navigate to="/governance" replace />} />
          <Route path="risks/new" element={<PrivateRoute permission={['risks', 'create']}><RiskForm /></PrivateRoute>} />
          <Route path="risks/:id/edit" element={<PrivateRoute permission={['risks', 'update']}><RiskForm /></PrivateRoute>} />
          <Route path="risks/:id" element={<PrivateRoute permission={['risks', 'read']}><RiskDetail /></PrivateRoute>} />
          <Route path="assets" element={<PrivateRoute permission={['assets', 'read']}><AssetLedger /></PrivateRoute>} />
          <Route path="remediation-actions" element={<Navigate to="/governance?tab=remediation" replace />} />
          <Route path="remediation-actions/new" element={<PrivateRoute permission={['remediation_actions', 'create']}><RemediationActions /></PrivateRoute>} />
          <Route path="remediation-actions/:id" element={<PrivateRoute permission={['remediation_actions', 'read']}><RemediationActionDetail /></PrivateRoute>} />
          <Route path="assessment-plans" element={<PrivateRoute permission={['assessment_plans', 'read']}><AssessmentPlans /></PrivateRoute>} />
          <Route path="settings" element={<Settings />} />
          <Route path="product-compliance" element={<Navigate to="/product-compliance/products" replace />} />
          <Route path="product-compliance/products" element={<PrivateRoute permission={['products', 'read']}><ProductComplianceList /></PrivateRoute>} />
          <Route path="product-compliance/products/:id" element={<PrivateRoute permission={['products', 'read']}><ProductComplianceDetail /></PrivateRoute>} />
          <Route path="product-compliance/dossiers/:id" element={<PrivateRoute permission={['product_dossiers', 'read']}><ProductDossierDetail /></PrivateRoute>} />
          <Route path="product-compliance/review" element={<PrivateRoute permission={['product_dossiers', 'review']} fallbackPath="/product-compliance/products"><ProductComplianceReview /></PrivateRoute>} />
          <Route path="product-compliance/config" element={<PrivateRoute permission={['product_compliance_config', 'read']} fallbackPath="/product-compliance/products"><ProductComplianceConfiguration /></PrivateRoute>} />
          <Route path="account-audit" element={<PrivateRoute><AccountAudit /></PrivateRoute>}>
            <Route index element={<AccountAuditIndex />} />
            <Route path="dashboard" element={<PrivateRoute permission={['account_dashboard', 'read']} fallbackPath="/account-audit"><AccountDashboard /></PrivateRoute>} />
            <Route path="data-sources" element={<PrivateRoute permission={['data_sources', 'read']} fallbackPath="/account-audit"><DataSourceList /></PrivateRoute>} />
            <Route path="data-sources/new" element={<PrivateRoute permission={['data_sources', 'create']} fallbackPath="/account-audit/data-sources"><DataSourceForm /></PrivateRoute>} />
            <Route path="data-sources/:id/edit" element={<PrivateRoute permission={['data_sources', 'update']} fallbackPath="/account-audit/data-sources"><DataSourceForm /></PrivateRoute>} />
            <Route path="data-sources/:id" element={<PrivateRoute permission={['data_sources', 'read']} fallbackPath="/account-audit"><DataSourceDetail /></PrivateRoute>} />
            <Route path="rules" element={<PrivateRoute permission={['rules', 'read']} fallbackPath="/account-audit"><RuleList /></PrivateRoute>} />
            <Route path="rules/:id" element={<PrivateRoute permission={['rules', 'read']} fallbackPath="/account-audit"><RuleDetail /></PrivateRoute>} />
            <Route path="tasks" element={<PrivateRoute permission={['account_tasks', 'read']} fallbackPath="/account-audit"><TaskList /></PrivateRoute>} />
            <Route path="tasks/:id/history" element={<PrivateRoute permission={['account_tasks', 'read']} fallbackPath="/account-audit"><TaskHistory /></PrivateRoute>} />
            <Route path="problems" element={<PrivateRoute permission={['problems', 'read']} fallbackPath="/account-audit"><ProblemList /></PrivateRoute>} />
            <Route path="problems/:id" element={<PrivateRoute permission={['problems', 'read']} fallbackPath="/account-audit"><ProblemList /></PrivateRoute>} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

function AccountAuditIndex() {
  const can = useAuthStore((state) => state.hasPermission);
  const path = can('account_dashboard', 'read') ? '/account-audit/dashboard'
    : can('data_sources', 'read') ? '/account-audit/data-sources'
      : can('rules', 'read') ? '/account-audit/rules'
        : can('account_tasks', 'read') ? '/account-audit/tasks'
          : can('problems', 'read') ? '/account-audit/problems' : '/dashboard';
  return <Navigate to={path} replace />;
}

export default App;
