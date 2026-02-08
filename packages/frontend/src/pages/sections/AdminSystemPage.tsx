import React, { Suspense } from 'react';
import { Shield, FileText, Settings as SettingsIcon, BarChart3 } from 'lucide-react';
import { SectionLandingPage } from '@/components/SectionLandingPage';
import type { KpiCardProps } from '@/components/KpiCard';
import type { TabDef } from '@/components/SectionTabBar';

// Lazy-load embedded page components
const RolesPage = React.lazy(() =>
  import('@/pages/RolesPage').then(m => ({ default: m.RolesPage }))
);
const AuditLogPage = React.lazy(() =>
  import('@/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage }))
);
const SettingsPage = React.lazy(() =>
  import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage }))
);
const ReportsPage = React.lazy(() =>
  import('@/pages/ReportsPage').then(m => ({ default: m.ReportsPage }))
);

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
    title: 'Audit Events',
    value: 'View Log',
    icon: FileText,
    color: 'bg-blue-500',
  },
  {
    title: 'Settings',
    value: 'Configure',
    icon: SettingsIcon,
    color: 'bg-emerald-500',
  },
  {
    title: 'Reports',
    value: 'Generate',
    icon: BarChart3,
    color: 'bg-amber-500',
  },
];

const tabs: TabDef[] = [
  { key: 'roles', label: 'Roles & Permissions' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'settings', label: 'Settings' },
  { key: 'reports', label: 'Reports' },
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
      }}
    />
  );
};
