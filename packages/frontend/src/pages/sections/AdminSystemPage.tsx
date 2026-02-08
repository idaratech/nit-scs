import React, { Suspense } from 'react';
import { Shield, Settings as SettingsIcon, Zap, Mail } from 'lucide-react';
import { SectionLandingPage } from '@/components/SectionLandingPage';
import type { KpiCardProps } from '@/components/KpiCard';
import type { TabDef } from '@/components/SectionTabBar';

// Lazy-load embedded page components
const RolesPage = React.lazy(() => import('@/pages/RolesPage').then(m => ({ default: m.RolesPage })));
const AuditLogPage = React.lazy(() => import('@/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const SettingsPage = React.lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ReportsPage = React.lazy(() => import('@/pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const WorkflowListPage = React.lazy(() =>
  import('@/pages/WorkflowListPage').then(m => ({ default: m.WorkflowListPage })),
);
const EmailTemplatesPage = React.lazy(() =>
  import('@/pages/EmailTemplatesPage').then(m => ({ default: m.EmailTemplatesPage })),
);
const EmailLogsPage = React.lazy(() => import('@/pages/EmailLogsPage').then(m => ({ default: m.EmailLogsPage })));

const Spinner: React.FC = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-8 h-8 border-2 border-nesma-secondary border-t-transparent rounded-full animate-spin" />
  </div>
);

const kpis: KpiCardProps[] = [
  {
    title: 'System Roles',
    value: 8,
    icon: Shield,
    color: 'bg-nesma-primary',
    sublabel: 'RBAC Roles',
  },
  {
    title: 'Workflows',
    value: 'Automate',
    icon: Zap,
    color: 'bg-amber-500',
  },
  {
    title: 'Email Templates',
    value: 'Configure',
    icon: Mail,
    color: 'bg-blue-500',
  },
  {
    title: 'Settings',
    value: 'Configure',
    icon: SettingsIcon,
    color: 'bg-emerald-500',
  },
];

const tabs: TabDef[] = [
  { key: 'roles', label: 'Roles & Permissions' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'settings', label: 'Settings' },
  { key: 'reports', label: 'Reports' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'email-templates', label: 'Email Templates' },
  { key: 'email-logs', label: 'Email Logs' },
];

export const AdminSystemPage: React.FC = () => {
  return (
    <SectionLandingPage
      title="System Administration"
      subtitle="Roles, audit trail, system settings, and reports"
      kpis={kpis}
      tabs={tabs}
      defaultTab="roles"
      children={{
        roles: (
          <Suspense fallback={<Spinner />}>
            <RolesPage />
          </Suspense>
        ),
        audit: (
          <Suspense fallback={<Spinner />}>
            <AuditLogPage />
          </Suspense>
        ),
        settings: (
          <Suspense fallback={<Spinner />}>
            <SettingsPage />
          </Suspense>
        ),
        reports: (
          <Suspense fallback={<Spinner />}>
            <ReportsPage />
          </Suspense>
        ),
        workflows: (
          <Suspense fallback={<Spinner />}>
            <WorkflowListPage />
          </Suspense>
        ),
        'email-templates': (
          <Suspense fallback={<Spinner />}>
            <EmailTemplatesPage />
          </Suspense>
        ),
        'email-logs': (
          <Suspense fallback={<Spinner />}>
            <EmailLogsPage />
          </Suspense>
        ),
      }}
    />
  );
};
