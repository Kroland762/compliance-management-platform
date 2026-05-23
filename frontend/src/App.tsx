import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/auth';
import PrivateRoute from './components/PrivateRoute';
import MainLayout from './components/MainLayout';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import TemplateManagement from './views/admin/TemplateManagement';
import UserManagement from './views/admin/UserManagement';
import RoleManagement from './views/RoleManagement';
import AuditLogViewer from './views/admin/AuditLogViewer';
import TenantManagement from './views/admin/TenantManagement';
import ReviewTaskList from './views/auditor/ReviewTaskList';
import ReviewTask from './views/auditor/ReviewTask';
import TaskConfigure from './views/auditor/TaskConfigure';
import MyTasks from './views/respondent/MyTasks';
import FillQuestionnaire from './views/respondent/FillQuestionnaire';
import RiskManagement from './views/RiskManagement';
import Settings from './views/Settings';
import AccountAudit from './views/AccountAudit';
import AccountDashboard from './views/account/Dashboard';
import DataSourceList from './views/account/DataSourceList';
import DataSourceForm from './views/account/DataSourceForm';
import DataSourceDetail from './views/account/DataSourceDetail';
import RuleList from './views/account/RuleList';
import RuleDetail from './views/account/RuleDetail';
import TaskList from './views/account/TaskList';
import TaskHistory from './views/account/TaskHistory';
import ProblemList from './views/account/ProblemList';

function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const refreshToken = useAuthStore((s) => s.refreshToken);

  useEffect(() => {
    loadFromStorage();
    refreshToken().catch(() => {});
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><MainLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="templates" element={<PrivateRoute permission={['templates', 'read']}><TemplateManagement /></PrivateRoute>} />
        <Route path="users" element={<PrivateRoute permission={['users', 'read']}><UserManagement /></PrivateRoute>} />
        <Route path="roles" element={<PrivateRoute permission={['users', 'read']}><RoleManagement /></PrivateRoute>} />
        <Route path="tenants" element={<PrivateRoute permission={['tenants', 'read']}><TenantManagement /></PrivateRoute>} />
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
  );
}

export default App;
