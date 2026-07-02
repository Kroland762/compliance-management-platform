import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from './store/auth';
import PrivateRoute from './components/PrivateRoute';
import MainLayout from './components/MainLayout';
import Login from './views/Login';

const Dashboard = lazy(() => import('./views/Dashboard'));
const TemplateManagement = lazy(() => import('./views/admin/TemplateManagement'));
const UserManagement = lazy(() => import('./views/admin/UserManagement'));
const RoleManagement = lazy(() => import('./views/RoleManagement'));
const AuditLogViewer = lazy(() => import('./views/admin/AuditLogViewer'));
const TenantManagement = lazy(() => import('./views/admin/TenantManagement'));
const ReviewTaskList = lazy(() => import('./views/auditor/ReviewTaskList'));
const ReviewTask = lazy(() => import('./views/auditor/ReviewTask'));
const TaskConfigure = lazy(() => import('./views/auditor/TaskConfigure'));
const MyTasks = lazy(() => import('./views/respondent/MyTasks'));
const FillQuestionnaire = lazy(() => import('./views/respondent/FillQuestionnaire'));
const RiskManagement = lazy(() => import('./views/RiskManagement'));
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
        <Route path="/" element={<PrivateRoute><MainLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="templates" element={<PrivateRoute permission={['templates', 'read']}><TemplateManagement /></PrivateRoute>} />
          <Route path="users" element={<PrivateRoute permission={['users', 'read']}><UserManagement /></PrivateRoute>} />
          <Route path="roles" element={<PrivateRoute permission={['users', 'read']}><RoleManagement /></PrivateRoute>} />
          <Route path="tenants" element={<PrivateRoute permission={['tenants', 'read']}><TenantManagement /></PrivateRoute>} />
          <Route path="organization" element={<PrivateRoute permission={['organization', 'read']}><OrganizationManagement /></PrivateRoute>} />
          <Route path="audit-logs" element={<PrivateRoute permission={['audit_logs', 'read']}><AuditLogViewer /></PrivateRoute>} />
          <Route path="tasks/review" element={<PrivateRoute permission={['tasks', 'read']}><ReviewTaskList /></PrivateRoute>} />
          <Route path="tasks/review/:id" element={<PrivateRoute permission={['tasks', 'read']}><ReviewTask /></PrivateRoute>} />
          <Route path="tasks/configure/:id" element={<PrivateRoute permission={['tasks', 'update']}><TaskConfigure /></PrivateRoute>} />
          <Route path="my-tasks" element={<PrivateRoute permission={['tasks', 'read']}><MyTasks /></PrivateRoute>} />
          <Route path="my-tasks/:id" element={<PrivateRoute permission={['tasks', 'submit']}><FillQuestionnaire /></PrivateRoute>} />
          <Route path="risks" element={<PrivateRoute permission={['risks', 'read']}><RiskManagement /></PrivateRoute>} />
          <Route path="settings" element={<Settings />} />
          <Route path="account-audit" element={<PrivateRoute permission={['dashboard', 'read']}><AccountAudit /></PrivateRoute>}>
            <Route index element={<AccountDashboard />} />
            <Route path="data-sources" element={<DataSourceList />} />
            <Route path="data-sources/new" element={<PrivateRoute permission={['data_sources', 'create']}><DataSourceForm /></PrivateRoute>} />
            <Route path="data-sources/:id" element={<DataSourceDetail />} />
            <Route path="rules" element={<RuleList />} />
            <Route path="rules/:id" element={<RuleDetail />} />
            <Route path="tasks" element={<TaskList />} />
            <Route path="tasks/:id/history" element={<TaskHistory />} />
            <Route path="problems" element={<ProblemList />} />
            <Route path="problems/:id" element={<ProblemList />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
