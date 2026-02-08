import React, { useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Eye, Edit3, Trash2, ChevronUp, ChevronDown, Download, LayoutGrid, List } from 'lucide-react';
import { DetailModal } from '@/components/DetailModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ExportButton } from '@/components/ExportButton';
import { FilterPanel } from '@/components/FilterPanel';
import { ApprovalWorkflow } from '@/components/ApprovalWorkflow';
import { StatusTimeline } from '@/components/StatusTimeline';
import { toast } from '@/components/Toaster';
import { generateDocumentPdf, buildPdfOptions } from '@/utils/pdfExport';
import type { StatusHistoryEntry } from '@nit-wms/shared/types';
import {
  useMrrvList, useMirvList, useMrvList, useShipments, useInventory,
  useJobOrders, useRfimList, useOsdList, useProjects, useEmployees,
  useSuppliers, useFleet, useGatePasses, useStockTransfers,
  useCustomsClearances, useWarehouses, useGenerators,
} from '@/api/hooks';
import {
  useDeleteProject, useDeleteEmployee, useDeleteSupplier,
  useDeleteWarehouse, useDeleteFleetItem, useDeleteGenerator,
  useDeleteInventoryItem,
} from '@/api/hooks';
import type { ListParams } from '@/api/hooks';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  let colorClass = 'bg-gray-500/20 text-gray-300 border-gray-500/50';

  switch (status) {
    case 'Approved':
    case 'Delivered':
    case 'Completed':
    case 'Active':
    case 'In Stock':
    case 'Pass':
    case 'Resolved':
      colorClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      break;
    case 'Pending':
    case 'Pending Approval':
    case 'In Progress':
    case 'In Transit':
    case 'Assigning':
    case 'Low Stock':
    case 'Conditional':
    case 'Open':
      colorClass = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      break;
    case 'Rejected':
    case 'Cancelled':
    case 'Out of Stock':
    case 'Overdue':
    case 'Fail':
      colorClass = 'bg-red-500/20 text-red-400 border-red-500/30';
      break;
    case 'Issued':
    case 'Customs Clearance':
    case 'Inspected':
      colorClass = 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      break;
    case 'Draft':
    case 'New':
      colorClass = 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      break;
  }

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${colorClass} backdrop-blur-sm`}>
      {status}
    </span>
  );
};

// ── Loading Skeleton ───────────────────────────────────────────────────────

const TableSkeleton: React.FC<{ cols: number }> = ({ cols }) => (
  <div className="glass-card rounded-2xl overflow-hidden animate-pulse">
    <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between">
      <div className="h-9 w-64 bg-white/10 rounded-lg"></div>
      <div className="h-9 w-24 bg-white/10 rounded-lg"></div>
    </div>
    <div className="divide-y divide-white/5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-4 px-6 py-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 flex-1 bg-white/5 rounded"></div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

// ── Hook selector based on resource param ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryResult = { data: any; isLoading: boolean; isError: boolean; error: unknown };

function useResourceData(resource: string | undefined, params: ListParams): AnyQueryResult {
  const mrrv = useMrrvList(resource === 'mrrv' ? params : undefined);
  const mirv = useMirvList(resource === 'mirv' ? params : undefined);
  const mrv = useMrvList(resource === 'mrv' ? params : undefined);
  const shipments = useShipments(resource === 'shipments' || resource === 'reports' ? params : undefined);
  const inventory = useInventory(resource === 'inventory' ? params : undefined);
  const jobOrders = useJobOrders(resource === 'job-orders' ? params : undefined);
  const rfim = useRfimList(resource === 'rfim' ? params : undefined);
  const osd = useOsdList(resource === 'osd' ? params : undefined);
  const projects = useProjects(resource === 'projects' ? params : undefined);
  const employees = useEmployees(resource === 'employees' ? params : undefined);
  const suppliers = useSuppliers(resource === 'suppliers' ? params : undefined);
  const fleet = useFleet(resource === 'fleet' ? params : undefined);
  const gatePasses = useGatePasses(resource === 'gate-pass' ? params : undefined);
  const stockTransfers = useStockTransfers(resource === 'stock-transfer' ? params : undefined);
  const customs = useCustomsClearances(resource === 'customs' ? params : undefined);
  const warehouses = useWarehouses(resource === 'warehouses' ? params : undefined);
  const generators = useGenerators(resource === 'generators' ? params : undefined);

  const hookMap: Record<string, AnyQueryResult> = {
    mrrv, mirv, mrv, shipments, inventory,
    'job-orders': jobOrders, rfim, osd, projects, employees,
    suppliers, fleet, 'gate-pass': gatePasses,
    'stock-transfer': stockTransfers, customs, warehouses, generators,
    reports: shipments,
  };

  return hookMap[resource || ''] || { data: undefined, isLoading: false, isError: false, error: null };
}

// ── Master data resources (deletable) vs document resources (workflow-based) ──

const MASTER_DATA_RESOURCES = new Set([
  'projects', 'employees', 'suppliers', 'warehouses', 'fleet', 'generators', 'inventory',
]);

const DOCUMENT_RESOURCES = new Set([
  'mrrv', 'mirv', 'mrv', 'job-orders', 'rfim', 'osd', 'gate-pass', 'stock-transfer', 'shipments',
]);

// ── Main Component ─────────────────────────────────────────────────────────

export const AdminResourceList: React.FC = () => {
  const { resource } = useParams<{ section: string; resource: string }>();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const pageSize = 20;

  const isMasterData = MASTER_DATA_RESOURCES.has(resource || '');
  const isDocument = DOCUMENT_RESOURCES.has(resource || '');

  const handlePdfExport = useCallback((row: Record<string, unknown>) => {
    const options = buildPdfOptions(resource || '', row);
    generateDocumentPdf(options);
  }, [resource]);

  // Delete hooks - always called (Rules of Hooks), but only used for master data
  const deleteProject = useDeleteProject();
  const deleteEmployee = useDeleteEmployee();
  const deleteSupplier = useDeleteSupplier();
  const deleteWarehouse = useDeleteWarehouse();
  const deleteFleetItem = useDeleteFleetItem();
  const deleteGenerator = useDeleteGenerator();
  const deleteInventoryItem = useDeleteInventoryItem();

  const deleteMutation = useMemo(() => {
    const map: Record<string, typeof deleteProject> = {
      projects: deleteProject,
      employees: deleteEmployee,
      suppliers: deleteSupplier,
      warehouses: deleteWarehouse,
      fleet: deleteFleetItem,
      generators: deleteGenerator,
      inventory: deleteInventoryItem,
    };
    return map[resource || ''] || null;
  }, [resource, deleteProject, deleteEmployee, deleteSupplier, deleteWarehouse, deleteFleetItem, deleteGenerator, deleteInventoryItem]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget || !deleteMutation) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('Item deleted successfully');
        setDeleteTarget(null);
      },
      onError: (err: unknown) => {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
          || (err as Error)?.message || 'Unknown error';
        if (message.toLowerCase().includes('foreign') || message.toLowerCase().includes('reference') || message.toLowerCase().includes('constraint')) {
          toast.error('Cannot delete', 'This item is referenced by other records.');
        } else {
          toast.error('Failed to delete item', message);
        }
        setDeleteTarget(null);
      },
    });
  }, [deleteTarget, deleteMutation]);

  // Build API params
  const apiParams: ListParams = useMemo(() => ({
    page: currentPage,
    pageSize,
    search: searchTerm || undefined,
    sortBy: sortKey || undefined,
    sortDir: sortKey ? sortDir : undefined,
    ...Object.fromEntries(
      Object.entries(filterValues).filter(([, v]) => v !== undefined && v !== '')
    ),
  }), [currentPage, searchTerm, sortKey, sortDir, filterValues]);

  // Fetch data from API
  const query = useResourceData(resource, apiParams);

  // Determine form link based on resource
  const getFormLink = () => {
    switch (resource) {
      case 'mrrv': return '/admin/forms/mrrv';
      case 'mirv': return '/admin/forms/mirv';
      case 'mrv': return '/admin/forms/mrv';
      case 'job-orders': return '/admin/forms/jo';
      case 'rfim': return '/admin/forms/rfim';
      case 'osd': return '/admin/forms/osd';
      case 'gate-pass': return '/admin/forms/gatepass';
      case 'stock-transfer': return '/admin/forms/stock-transfer';
      case 'shipments': return '/admin/forms/shipment';
      case 'customs': return '/admin/forms/customs';
      default: return '#';
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Column configuration for different resources
  const config = useMemo(() => {
    switch (resource) {
      case 'mrrv':
        return {
          title: 'Receipt Vouchers',
          code: 'MRRV',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'date', label: 'Date' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'value', label: 'Value', format: (v: number) => `${v?.toLocaleString()} SAR` },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'poNumber', label: 'PO Number' },
          ]
        };
      case 'mirv':
        return {
          title: 'Issue Vouchers',
          code: 'MIRV',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'project', label: 'Project' },
            { key: 'requester', label: 'Requester' },
            { key: 'date', label: 'Date' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'value', label: 'Value', format: (v: number) => `${v?.toLocaleString()} SAR` },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'mrv':
        return {
          title: 'Return Vouchers',
          code: 'MRV',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'returnType', label: 'Return Type' },
            { key: 'date', label: 'Date' },
            { key: 'project', label: 'Project' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'shipments':
        return {
          title: 'Shipments',
          code: 'SHP',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'description', label: 'Description' },
            { key: 'etd', label: 'ETD' },
            { key: 'eta', label: 'ETA' },
            { key: 'port', label: 'Port' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'agent', label: 'Agent' },
          ]
        };
      case 'inventory':
        return {
          title: 'Inventory Levels',
          code: 'INV',
          columns: [
            { key: 'code', label: 'Item Code' },
            { key: 'name', label: 'Description' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'quantity', label: 'Available Qty' },
            { key: 'reserved', label: 'Reserved' },
            { key: 'onOrder', label: 'On Order' },
            { key: 'stockStatus', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'job-orders':
        return {
          title: 'Job Orders',
          code: 'JO',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'type', label: 'Type' },
            { key: 'project', label: 'Project' },
            { key: 'requester', label: 'Requester' },
            { key: 'date', label: 'Date' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'slaStatus', label: 'SLA', component: (v: string) => <span className={`text-xs font-bold ${v === 'On Track' ? 'text-green-400' : v === 'At Risk' ? 'text-orange-400' : 'text-red-400'}`}>{v}</span> },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'driver', label: 'Driver' },
          ]
        };
      case 'rfim':
        return {
          title: 'Inspection Requests',
          code: 'RFIM',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'mrrvId', label: 'MRRV ID' },
            { key: 'inspectionType', label: 'Inspection Type' },
            { key: 'priority', label: 'Priority' },
            { key: 'status', label: 'Result', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'inspector', label: 'Inspector' },
          ]
        };
      case 'osd':
        return {
          title: 'OSD Reports',
          code: 'OSD',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'mrrvId', label: 'MRRV ID' },
            { key: 'reportType', label: 'Type' },
            { key: 'qtyAffected', label: 'Qty' },
            { key: 'actionRequired', label: 'Action' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'projects':
        return {
          title: 'Projects',
          code: 'PROJ',
          columns: [
            { key: 'name', label: 'Project Name' },
            { key: 'client', label: 'Client' },
            { key: 'region', label: 'Region' },
            { key: 'manager', label: 'Project Manager' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'employees':
        return {
          title: 'Employees',
          code: 'EMP',
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'department', label: 'Department' },
            { key: 'title', label: 'Job Title' },
            { key: 'site', label: 'Site' },
          ]
        };
      case 'suppliers':
        return {
          title: 'Suppliers',
          code: 'SUP',
          columns: [
            { key: 'name', label: 'Supplier Name' },
            { key: 'city', label: 'City' },
            { key: 'type', label: 'Type' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'fleet':
        return {
          title: 'Fleet Management',
          code: 'FLT',
          columns: [
            { key: 'plateNumber', label: 'Plate' },
            { key: 'type', label: 'Type' },
            { key: 'category', label: 'Category' },
            { key: 'projectName', label: 'Project' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'driver', label: 'Driver' },
            { key: 'currentJob', label: 'Current Job' },
          ]
        };
      case 'gate-pass':
        return {
          title: 'Gate Passes',
          code: 'GP',
          columns: [
            { key: 'id', label: 'Pass ID' },
            { key: 'type', label: 'Type' },
            { key: 'linkedDocument', label: 'Linked Doc' },
            { key: 'date', label: 'Date' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'vehiclePlate', label: 'Vehicle' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'stock-transfer':
        return {
          title: 'Stock Transfers',
          code: 'ST',
          columns: [
            { key: 'id', label: 'Transfer ID' },
            { key: 'date', label: 'Date' },
            { key: 'fromWarehouse', label: 'From' },
            { key: 'toWarehouse', label: 'To' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'customs':
        return {
          title: 'Customs Clearance',
          code: 'CUS',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'shipmentId', label: 'Shipment' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'port', label: 'Port' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      case 'warehouses':
        return {
          title: 'Warehouses',
          code: 'WH',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Warehouse Name' },
            { key: 'city', label: 'City' },
          ]
        };
      case 'reports':
        return {
          title: 'Shipping Reports',
          code: 'RPT',
          columns: [
            { key: 'id', label: 'Shipment ID' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'description', label: 'Description' },
            { key: 'port', label: 'Port' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
            { key: 'value', label: 'Value', format: (v: number) => `${v?.toLocaleString()} SAR` },
          ]
        };
      case 'generators':
        return {
          title: 'Generators',
          code: 'GEN',
          columns: [
            { key: 'assetId', label: 'Asset ID' },
            { key: 'capacityKva', label: 'Capacity (KVA)' },
            { key: 'manufacturer', label: 'Manufacturer' },
            { key: 'project', label: 'Project' },
            { key: 'status', label: 'Status', component: (v: string) => <StatusBadge status={v} /> },
          ]
        };
      default:
        return { title: 'List', code: 'LIST', columns: [] as { key: string; label: string; format?: (v: unknown) => string; component?: (v: unknown) => React.ReactNode }[] };
    }
  }, [resource]);

  const filterConfigs = useMemo(() => {
    const statusOptions = ['Draft', 'Pending', 'Approved', 'Completed', 'Rejected', 'In Progress', 'Active', 'Issued'];
    switch (resource) {
      case 'mrrv':
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: ['Draft', 'Approved', 'Inspected', 'Pending QC'] },
          { key: 'supplier', label: 'Supplier', type: 'text' as const },
          { key: 'warehouse', label: 'Warehouse', type: 'select' as const, options: ['Dammam Warehouse', 'Riyadh Warehouse', 'Tabuk Warehouse', 'Jeddah Warehouse', 'Madinah Warehouse', 'Makkah Warehouse'] },
          { key: 'date', label: 'Date', type: 'dateRange' as const },
        ];
      case 'mirv':
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: ['Draft', 'Pending Approval', 'Approved', 'Issued'] },
          { key: 'project', label: 'Project', type: 'text' as const },
          { key: 'warehouse', label: 'Warehouse', type: 'select' as const, options: ['Dammam Warehouse', 'Riyadh Warehouse', 'Tabuk Warehouse', 'Jeddah Warehouse', 'Madinah Warehouse'] },
        ];
      case 'job-orders':
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: ['New', 'Assigning', 'In Progress', 'Completed'] },
          { key: 'type', label: 'Type', type: 'select' as const, options: ['Transport', 'Equipment', 'Generator_Rental', 'Generator_Maintenance', 'Rental_Daily', 'Rental_Monthly', 'Scrap'] },
          { key: 'project', label: 'Project', type: 'text' as const },
          { key: 'slaStatus', label: 'SLA', type: 'select' as const, options: ['On Track', 'At Risk', 'Overdue'] },
        ];
      case 'inventory':
        return [
          { key: 'stockStatus', label: 'Stock Status', type: 'select' as const, options: ['In Stock', 'Low Stock', 'Out of Stock'] },
          { key: 'warehouse', label: 'Warehouse', type: 'text' as const },
          { key: 'category', label: 'Category', type: 'text' as const },
        ];
      case 'shipments':
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: ['New', 'In Transit', 'Customs Clearance', 'Delivered'] },
          { key: 'port', label: 'Port', type: 'text' as const },
        ];
      case 'gate-pass':
        return [
          { key: 'type', label: 'Type', type: 'select' as const, options: ['Inbound', 'Outbound'] },
          { key: 'status', label: 'Status', type: 'select' as const, options: ['Active', 'Completed'] },
        ];
      case 'fleet':
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: ['Active', 'Available', 'Maintenance'] },
          { key: 'category', label: 'Category', type: 'select' as const, options: ['Heavy Equipment', 'Vehicle'] },
        ];
      default:
        return [
          { key: 'status', label: 'Status', type: 'select' as const, options: statusOptions },
        ];
    }
  }, [resource]);

  // Extract data from API response
  const apiData = (query.data as { data?: Record<string, unknown>[]; meta?: { total: number; totalPages: number } } | undefined)?.data ?? [];
  const apiMeta = (query.data as { meta?: { total: number; totalPages: number } } | undefined)?.meta;
  const totalFromApi = apiMeta?.total ?? apiData.length;
  const totalPages = apiMeta?.totalPages ?? Math.max(1, Math.ceil(totalFromApi / pageSize));

  // Generate detail data for modal
  const selectedRowDetails = useMemo(() => {
    if (!selectedRow) return null;
    const row = selectedRow;

    // Approval chain for MIRV/JO that have value data
    let approvalChain = null;
    if ((resource === 'mirv' || resource === 'job-orders') && row.value) {
      const amount = (row.value as number) || (row.materialPriceSar as number) || 0;
      const isApproved = row.status === 'Approved' || row.status === 'Issued' || row.status === 'Completed';
      const isPending = row.status === 'Pending Approval' || row.status === 'Draft' || row.status === 'New' || row.status === 'Assigning';

      const levels = amount < 10000
        ? [{ label: 'Storekeeper', level: 1 }]
        : amount < 50000
          ? [{ label: 'Storekeeper', level: 1 }, { label: 'Logistics Mgr', level: 2 }]
          : [{ label: 'Storekeeper', level: 1 }, { label: 'Logistics Mgr', level: 2 }, { label: 'Dept. Head', level: 3 }];

      approvalChain = {
        documentId: row.id as string,
        documentType: resource?.toUpperCase() || '',
        currentLevel: isApproved ? levels.length : isPending ? 1 : 0,
        totalLevels: levels.length,
        totalAmount: amount,
        status: (isApproved ? 'approved' : 'pending') as 'pending' | 'approved' | 'rejected',
        createdAt: (row.date as string) || new Date().toISOString(),
        steps: levels.map((l, i) => ({
          id: `step-${i}`,
          level: l.level,
          label: l.label,
          status: (isApproved || (isPending && i < (levels.length - 1)) ? 'approved' : isPending && i === levels.length - 1 ? 'current' : 'pending') as 'approved' | 'current' | 'pending',
          approverName: isApproved ? 'Auto' : undefined,
          timestamp: isApproved ? (row.date as string) : undefined,
        })),
      };
    }

    // Status history
    const statusHistory: StatusHistoryEntry[] = [
      { id: 'sh-1', status: 'Draft', timestamp: row.date ? new Date(new Date(row.date as string).getTime() - 86400000).toISOString() : new Date().toISOString(), userId: 'system', userName: 'System', action: 'Document created' },
      ...((row.status && row.status !== 'Draft') ? [{
        id: 'sh-2', status: row.status as string, timestamp: (row.date as string) || new Date().toISOString(), userId: '1', userName: 'Abdulrahman',
        action: row.status === 'Approved' ? 'Approved by manager' : row.status === 'Completed' ? 'Marked as complete' : `Status changed to ${row.status}`
      }] : []),
    ];

    return { approvalChain, statusHistory };
  }, [selectedRow, resource]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white glow-text">{config.title}</h1>
          <p className="text-sm text-gray-400 mt-1 flex items-center gap-2">
            <span className="bg-nesma-primary/20 text-nesma-secondary px-2 py-0.5 rounded text-xs border border-nesma-primary/30">{config.code}</span>
            Manage and track all {config.title.toLowerCase()}
          </p>
        </div>
        <div className="flex gap-3">
           <ExportButton data={apiData} columns={config.columns} filename={config.code} />
           {getFormLink() !== '#' && (
             <button
               onClick={() => navigate(getFormLink())}
               className="flex items-center gap-2 px-4 py-2 bg-nesma-primary text-white rounded-lg hover:bg-nesma-accent text-sm shadow-lg shadow-nesma-primary/20 transition-all transform hover:-translate-y-0.5"
             >
               <Plus size={16} />
               <span>Add New</span>
             </button>
           )}
        </div>
      </div>

      {/* Error State */}
      {query.isError && (
        <div className="glass-card p-6 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-400">Failed to load data. Please try again.</p>
          <p className="text-xs text-gray-500 mt-1">{(query.error as Error)?.message}</p>
        </div>
      )}

      {/* Loading State */}
      {query.isLoading ? (
        <TableSkeleton cols={config.columns.length} />
      ) : (
        /* Glass Table Container */
        <div className="glass-card rounded-2xl overflow-hidden">

          {/* Toolbar */}
          <div className="p-4 border-b border-white/10 flex flex-col md:flex-row gap-4 justify-between items-center bg-white/5">
             <div className="relative flex-1 w-full md:max-w-md">
               <Search size={18} className="absolute top-1/2 -translate-y-1/2 left-3 text-gray-400" />
               <input
                 type="text"
                 placeholder={`Search ${config.title}...`}
                 value={searchTerm}
                 onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                 className="w-full bg-black/20 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-nesma-secondary/50 focus:ring-1 focus:ring-nesma-secondary/50 transition-all"
               />
             </div>
             <div className="flex gap-2 w-full md:w-auto">
               <button
                 onClick={() => setFilterOpen(true)}
                 className={`flex items-center gap-2 px-3 py-2 bg-black/20 border rounded-lg text-sm transition-all flex-1 md:flex-none justify-center ${
                   Object.values(filterValues).some(v => v) ? 'border-nesma-secondary/50 text-nesma-secondary bg-nesma-secondary/5' : 'border-white/10 text-gray-300 hover:text-white hover:bg-white/5'
                 }`}
               >
                 <Filter size={16} />
                 <span>Filter{Object.values(filterValues).filter(v => v).length > 0 ? ` (${Object.values(filterValues).filter(v => v).length})` : ''}</span>
               </button>
               <div className="flex bg-black/20 border border-white/10 rounded-lg p-0.5">
                 <button
                   onClick={() => setViewMode('list')}
                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${viewMode === 'list' ? 'bg-white/10 text-white shadow-sm border border-white/10' : 'text-gray-400 hover:text-white'}`}
                 >
                   <List size={14} /> List
                 </button>
                 <button
                   onClick={() => setViewMode('card')}
                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${viewMode === 'card' ? 'bg-white/10 text-white shadow-sm border border-white/10' : 'text-gray-400 hover:text-white'}`}
                 >
                   <LayoutGrid size={14} /> Card
                 </button>
               </div>
             </div>
          </div>

          {/* Card View */}
          {viewMode === 'card' ? (
            <div className="p-4">
              {apiData.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {apiData.map((row, idx: number) => {
                    const primaryCol = config.columns[0];
                    const titleCol = config.columns.find(c => c.key === 'name') || config.columns[1];
                    const statusCol = config.columns.find(c => c.key === 'status' || c.key === 'stockStatus');
                    const restCols = config.columns.filter(c => c !== primaryCol && c !== titleCol && c !== statusCol);

                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedRow(row)}
                        className="glass-card p-5 rounded-xl hover:bg-white/10 transition-all cursor-pointer group border border-white/5 hover:border-nesma-secondary/20"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0">
                            <p className="text-white font-medium text-sm truncate group-hover:text-nesma-secondary transition-colors">
                              {titleCol ? ((titleCol.format ? titleCol.format(row[titleCol.key] as number) : (row[titleCol.key] as string)) || '-') : '-'}
                            </p>
                            <p className="text-gray-500 text-xs font-mono mt-0.5">
                              {primaryCol ? ((row[primaryCol.key] as string) || '-') : '-'}
                            </p>
                          </div>
                          {statusCol && (
                            <div className="flex-shrink-0 ml-2">
                              {statusCol.component ? statusCol.component(row[statusCol.key] as string) : (row[statusCol.key] as string) || '-'}
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5 pt-3 border-t border-white/5">
                          {restCols.slice(0, 4).map((col, cIdx: number) => (
                            <div key={cIdx} className="flex items-center justify-between text-xs">
                              <span className="text-gray-500">{col.label}</span>
                              <span className="text-gray-300 truncate ml-2 max-w-[60%] text-right">
                                {col.component ? col.component(row[col.key] as string) : (col.format ? col.format(row[col.key] as number) : (row[col.key] as string) || '-')}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Card actions */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); setSelectedRow(row); }} className="p-1.5 rounded-lg hover:bg-white/10 text-nesma-secondary" title="View">
                            <Eye size={14} />
                          </button>
                          {isDocument && (
                            <button onClick={(e) => { e.stopPropagation(); handlePdfExport(row); }} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400" title="PDF">
                              <Download size={14} />
                            </button>
                          )}
                          {getFormLink() !== '#' && !!row.id && (
                            <button onClick={(e) => { e.stopPropagation(); navigate(`${getFormLink()}/${row.id as string}`); }} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400" title="Edit">
                              <Edit3 size={14} />
                            </button>
                          )}
                          {isMasterData && !!row.id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: row.id as string, label: (row.name as string) || (row.assetId as string) || (row.plateNumber as string) || (row.code as string) || (row.id as string) }); }}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                    <Search size={24} className="text-gray-600" />
                  </div>
                  <p>No records found</p>
                </div>
              )}
            </div>
          ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="nesma-table-head text-nesma-secondary text-xs uppercase tracking-wider font-semibold">
                <tr>
                  {config.columns.map((col, idx: number) => (
                    <th key={idx} className="px-6 py-4 whitespace-nowrap cursor-pointer hover:text-white transition-colors select-none" onClick={() => handleSort(col.key)}>
                      <span className="flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                      </span>
                    </th>
                  ))}
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm text-gray-300">
                {apiData.length > 0 ? (
                  apiData.map((row, idx: number) => (
                    <tr key={idx} className="nesma-table-row group">
                      {config.columns.map((col, cIdx: number) => (
                        <td key={cIdx} className="px-6 py-4 whitespace-nowrap group-hover:text-white transition-colors">
                          {col.component ? col.component(row[col.key] as string) : (col.format ? col.format(row[col.key] as number) : (row[col.key] as string) || '-')}
                        </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                         <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => setSelectedRow(row)} className="p-1.5 rounded-lg hover:bg-white/10 text-nesma-secondary hover:text-white transition-colors" title="View Details">
                             <Eye size={16} />
                           </button>
                           {isDocument && (
                             <button onClick={() => handlePdfExport(row)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Download PDF">
                               <Download size={16} />
                             </button>
                           )}
                           {getFormLink() !== '#' && !!row.id && (
                             <button onClick={() => navigate(`${getFormLink()}/${row.id as string}`)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Edit">
                               <Edit3 size={16} />
                             </button>
                           )}
                           {isMasterData && !!row.id && (
                             <button
                               onClick={() => setDeleteTarget({ id: row.id as string, label: (row.name as string) || (row.assetId as string) || (row.plateNumber as string) || (row.code as string) || (row.id as string) })}
                               className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                               title="Delete"
                             >
                               <Trash2 size={16} />
                             </button>
                           )}
                         </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={config.columns.length + 1} className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                              <Search size={24} className="text-gray-600" />
                          </div>
                          <p>No records found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination */}
          <div className="p-4 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 bg-white/5">
             <span className="text-xs text-gray-400">
               Showing <span className="text-white font-medium">{totalFromApi === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalFromApi)}</span> of <span className="text-white font-medium">{totalFromApi}</span> records
             </span>
             <div className="flex gap-2">
               <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 border border-white/10 rounded-lg bg-black/20 text-gray-400 text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5 hover:text-white transition-all">Previous</button>
               <div className="flex gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(page => (
                    <button key={page} onClick={() => setCurrentPage(page)} className={`w-8 h-8 rounded-lg text-xs flex items-center justify-center transition-all ${currentPage === page ? 'bg-nesma-primary text-white shadow-lg shadow-nesma-primary/20' : 'border border-white/10 hover:bg-white/10 text-gray-400'}`}>{page}</button>
                  ))}
               </div>
               <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1.5 border border-white/10 rounded-lg bg-black/20 text-gray-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/5 hover:text-white transition-all">Next</button>
             </div>
          </div>
        </div>
      )}

      {/* Filter Panel */}
      <FilterPanel
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filterConfigs}
        values={filterValues}
        onChange={(key, value) => setFilterValues(prev => ({ ...prev, [key]: value }))}
        onApply={() => setCurrentPage(1)}
        onClear={() => { setFilterValues({}); setCurrentPage(1); }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Record"
        message={`Are you sure you want to delete "${deleteTarget?.label}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation?.isPending ?? false}
      />

      {/* Detail Modal */}
      <DetailModal
        isOpen={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title={(selectedRow?.id as string) || (selectedRow?.name as string) || 'Details'}
        subtitle={`${config.code} Record`}
        actions={[
          { label: 'Close', onClick: () => setSelectedRow(null), variant: 'secondary' },
          ...(isDocument && selectedRow ? [{ label: 'Download PDF', onClick: () => handlePdfExport(selectedRow), variant: 'secondary' as const }] : []),
          ...(getFormLink() !== '#' && !!selectedRow?.id ? [{ label: 'Edit', onClick: () => { const id = selectedRow.id as string; setSelectedRow(null); navigate(`${getFormLink()}/${id}`); }, variant: 'primary' as const }] : []),
        ]}
      >
        {selectedRow && (
          <div className="space-y-6">
            {/* Key-Value pairs */}
            <div className="space-y-1">
              {config.columns.map((col, idx: number) => (
                <div key={idx} className="flex justify-between items-start py-3 border-b border-white/5 last:border-0">
                  <span className="text-sm text-gray-400 font-medium">{col.label}</span>
                  <span className="text-sm text-white text-right max-w-[60%]">
                    {col.component
                      ? col.component(selectedRow[col.key] as string)
                      : col.format
                        ? col.format(selectedRow[col.key] as number)
                        : (selectedRow[col.key] as string) || '\u2014'}
                  </span>
                </div>
              ))}
            </div>

            {/* Approval Workflow */}
            {selectedRowDetails?.approvalChain && (
              <ApprovalWorkflow chain={selectedRowDetails.approvalChain} />
            )}

            {/* Status Timeline */}
            {selectedRowDetails?.statusHistory && selectedRowDetails.statusHistory.length > 0 && (
              <StatusTimeline history={selectedRowDetails.statusHistory} />
            )}
          </div>
        )}
      </DetailModal>
    </div>
  );
};
