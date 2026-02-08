
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, FileText, CheckCircle, AlertCircle, Truck, Package, Shield, AlertTriangle, RefreshCw, Info, Loader2, Upload, X } from 'lucide-react';
import { useProjects, useWarehouses, useSuppliers, useMrrvList, useEmployees, useUpload } from '@/api/hooks';
import { useCreateMrrv, useCreateMirv, useCreateMrv, useCreateJobOrder, useCreateRfim, useCreateOsd } from '@/api/hooks';
import { useUpdateMrrv, useUpdateMirv, useUpdateMrv, useUpdateJobOrder, useUpdateRfim, useUpdateOsd } from '@/api/hooks';
import { useMrrv, useMirv, useMrv, useJobOrder, useRfim, useOsd } from '@/api/hooks';
import type { VoucherLineItem } from '@nit-wms/shared/types';
import { LineItemsTable } from '@/components/LineItemsTable';
import { useFormSubmit } from '@/hooks/useFormSubmit';
import { validateMRRV, validateMIRV, validateMRV, validateJO } from '@nit-wms/shared/validators';
import { previewNextNumber } from '@/utils/autoNumber';
import { getRequiredApprovalLevel } from '@nit-wms/shared/permissions';
import { MIRV_APPROVAL_LEVELS, JO_APPROVAL_LEVELS } from '@nit-wms/shared/constants';

// Field type used in form config
interface FormFieldDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange?: string;
}

// Approval level calculation based on value thresholds
const getApprovalInfo = (value: number): { level: string; color: string } => {
  if (value < 10000) return { level: 'Level 1 - Storekeeper', color: 'text-green-400' };
  if (value < 50000) return { level: 'Level 2 - Logistics Manager', color: 'text-blue-400' };
  if (value < 100000) return { level: 'Level 3 - Department Head', color: 'text-yellow-400' };
  if (value < 500000) return { level: 'Level 4 - Operations Director', color: 'text-orange-400' };
  return { level: 'Level 5 - CEO', color: 'text-red-400' };
};

const STATUS_FLOWS: Record<string, string[]> = {
  mrrv: ['Draft', 'Pending QC', 'Received', 'Stored'],
  mirv: ['Draft', 'Pending Approval', 'Approved', 'Issued'],
  mrv: ['Draft', 'Inspected', 'Accepted', 'Stored'],
  jo: ['New', 'Quote', 'Approved', 'Assigned', 'In Progress', 'Completed'],
  rfim: ['Pending', 'In Progress', 'Completed'],
  osd: ['Open', 'Under Review', 'Resolved'],
};

// Statuses that allow editing
const EDITABLE_STATUSES: Record<string, string[]> = {
  mrrv: ['Draft'],
  mirv: ['Draft'],
  mrv: ['Draft'],
  jo: ['New', 'Draft'],
  rfim: ['Pending'],
  osd: ['Open'],
};

const VALIDATOR_MAP: Record<string, (data: Record<string, unknown>, lineItems: VoucherLineItem[]) => { valid: boolean; errors: { field: string; rule: string; message: string }[]; warnings: { field: string; rule: string; message: string }[] }> = {
  mrrv: validateMRRV, mirv: validateMIRV, mrv: validateMRV, jo: validateJO,
};

export const ResourceForm: React.FC = () => {
  const { formType, id } = useParams<{ formType: string; id: string }>();
  const navigate = useNavigate();
  const isEditMode = !!id;
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [lineItems, setLineItems] = useState<VoucherLineItem[]>([]);
  const [joType, setJoType] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, { url: string; name: string; size: number }>>({});
  const uploadMutation = useUpload();

  // Fetch existing document for edit mode
  const mrrvQuery = useMrrv(formType === 'mrrv' ? id : undefined);
  const mirvQuery = useMirv(formType === 'mirv' ? id : undefined);
  const mrvQuery = useMrv(formType === 'mrv' ? id : undefined);
  const joQuery = useJobOrder(formType === 'jo' ? id : undefined);
  const rfimQuery = useRfim(formType === 'rfim' ? id : undefined);
  const osdQuery = useOsd(formType === 'osd' ? id : undefined);

  const detailQueryMap: Record<string, typeof mrrvQuery> = {
    mrrv: mrrvQuery, mirv: mirvQuery, mrv: mrvQuery,
    jo: joQuery, rfim: rfimQuery, osd: osdQuery,
  };
  const detailQuery = detailQueryMap[formType || ''];
  const existingDoc = (detailQuery?.data as { data?: Record<string, unknown> } | undefined)?.data;
  const isLoadingDoc = isEditMode && (detailQuery?.isLoading ?? false);

  // Check if document is editable based on status
  const docStatus = (existingDoc?.status as string) || '';
  const editableStatuses = EDITABLE_STATUSES[formType || ''] || [];
  const isEditable = !isEditMode || editableStatuses.includes(docStatus);

  // Pre-populate form data from existing document
  useEffect(() => {
    if (isEditMode && existingDoc && !initialized) {
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(existingDoc)) {
        if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
          data[key] = value;
        }
      }
      setFormData(data);
      if (existingDoc.lineItems && Array.isArray(existingDoc.lineItems)) {
        setLineItems(existingDoc.lineItems as VoucherLineItem[]);
      }
      if (existingDoc.type) {
        setJoType(existingDoc.type as string);
      }
      if (existingDoc.joType) {
        setJoType(existingDoc.joType as string);
      }
      setInitialized(true);
    }
  }, [isEditMode, existingDoc, initialized]);

  // Fetch dropdown options from API
  const projectsQuery = useProjects({ pageSize: 200 });
  const warehousesQuery = useWarehouses({ pageSize: 200 });
  const suppliersQuery = useSuppliers({ pageSize: 200 });
  const mrrvListQuery = useMrrvList({ pageSize: 200 });
  const employeesQuery = useEmployees({ pageSize: 200 });

  // Create mutations
  const createMrrv = useCreateMrrv();
  const createMirv = useCreateMirv();
  const createMrv = useCreateMrv();
  const createJo = useCreateJobOrder();
  const createRfim = useCreateRfim();
  const createOsd = useCreateOsd();

  // Update mutations
  const updateMrrv = useUpdateMrrv();
  const updateMirv = useUpdateMirv();
  const updateMrv = useUpdateMrv();
  const updateJo = useUpdateJobOrder();
  const updateRfim = useUpdateRfim();
  const updateOsd = useUpdateOsd();

  const createMutationMap: Record<string, typeof createMrrv> = {
    mrrv: createMrrv, mirv: createMirv, mrv: createMrv,
    jo: createJo, rfim: createRfim, osd: createOsd,
  };

  const updateMutationMap: Record<string, typeof updateMrrv> = {
    mrrv: updateMrrv, mirv: updateMirv, mrv: updateMrv,
    jo: updateJo, rfim: updateRfim, osd: updateOsd,
  };

  const activeMutation = isEditMode
    ? updateMutationMap[formType || '']
    : createMutationMap[formType || ''];

  const nextNumber = useMemo(() => previewNextNumber(formType || 'gen'), [formType]);
  const validator = VALIDATOR_MAP[formType || ''];
  const statusFlow = STATUS_FLOWS[formType || ''] || [];

  // Build a service adapter that wraps the React Query mutation for useFormSubmit
  const serviceAdapter = useMemo(() => {
    if (!activeMutation) return undefined;
    if (isEditMode) {
      return {
        create: async (data: Record<string, unknown>) => {
          const result = await activeMutation.mutateAsync({ ...data, id: id! } as Record<string, unknown> & { id: string });
          return { data: result.data, success: result.success, message: result.message };
        },
      };
    }
    return {
      create: async (data: Record<string, unknown>) => {
        const result = await activeMutation.mutateAsync(data as Record<string, unknown> & { id: string });
        return { data: result.data, success: result.success, message: result.message };
      },
    };
  }, [activeMutation, isEditMode, id]);

  const { submitting, submitted, errors, warnings, documentNumber, submit, reset } = useFormSubmit({
    documentType: formType || 'gen',
    validator,
    service: serviceAdapter,
  });

  // Extract option arrays from API data
  const projectOptions = (projectsQuery.data?.data ?? []).map((p: { name: string }) => p.name);
  const warehouseOptions = (warehousesQuery.data?.data ?? []).map((w: { name: string }) => w.name);
  const supplierOptions = (suppliersQuery.data?.data ?? []).map((s: { name: string }) => s.name);
  const mrrvOptions = (mrrvListQuery.data?.data ?? []).map((m: { id: string; supplier?: string }) => `${m.id}${m.supplier ? ` - ${m.supplier}` : ''}`);
  const inspectorOptions = (employeesQuery.data?.data ?? [])
    .filter((e: { department: string }) => e.department === 'Warehouse' || e.department === 'Logistics')
    .map((e: { name: string }) => e.name);

  // Auto-calculate total from line items
  const totalValue = useMemo(() =>
    lineItems.reduce((sum, item) => sum + item.totalPrice, 0),
    [lineItems]
  );

  const approvalInfo = useMemo(() => getApprovalInfo(totalValue), [totalValue]);
  const hasLineItems = ['mirv', 'mrrv', 'mrv'].includes(formType || '');

  const formConfig = useMemo(() => {
    switch (formType) {
      case 'mirv':
        return {
          title: isEditMode ? 'Edit Material Issue Request' : 'Material Issue Request',
          titleEn: 'Material Issue Request',
          code: 'MIRV',
          subtitle: 'N-MS-NIT-LSS-FRM-0102',
          icon: Package,
          sections: [
            {
              title: 'Basic Information',
              fields: [
                { key: 'requestDate', label: 'Request Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
                { key: 'project', label: 'Project', type: 'select', options: projectOptions, required: true },
                { key: 'warehouse', label: 'Warehouse', type: 'select', options: warehouseOptions, required: true },
                { key: 'requester', label: 'Requester', type: 'text', defaultValue: 'Current User', readOnly: true },
              ]
            },
            {
              title: 'Request Details',
              fields: [
                { key: 'purpose', label: 'Purpose of Issue', type: 'textarea', required: true, placeholder: 'Electrical cables for installation work...' },
                { key: 'notes', label: 'Notes', type: 'textarea' },
              ]
            }
          ]
        };
      case 'mrrv':
        return {
          title: isEditMode ? 'Edit Material Receiving Report' : 'Material Receiving Report',
          titleEn: 'Material Receiving Report',
          code: 'MRRV',
          subtitle: 'N-MS-NIT-LSS-FRM-0101',
          icon: Package,
          sections: [
            {
              title: 'Receipt Details',
              fields: [
                { key: 'date', label: 'Receipt Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
                { key: 'supplier', label: 'Supplier', type: 'select', options: supplierOptions, required: true },
                { key: 'project', label: 'Project', type: 'select', options: projectOptions, required: true },
                { key: 'warehouse', label: 'Warehouse', type: 'select', options: warehouseOptions, required: true },
              ]
            },
            {
              title: 'Documents',
              fields: [
                { key: 'poNumber', label: 'PO Number', type: 'text', required: true, placeholder: 'PO-2026-00XXX' },
                { key: 'deliveryNote', label: 'Delivery Note (DN)', type: 'text', required: true, placeholder: 'DN-XXXXX' },
                { key: 'receivedBy', label: 'Received By', type: 'text', defaultValue: 'Current User', readOnly: true },
                { key: 'rfimRequired', label: 'Requires Inspection (RFIM)?', type: 'checkbox' },
                { key: 'attachments', label: 'Attachments', type: 'file' },
              ]
            }
          ]
        };
      case 'jo':
        return {
          title: isEditMode ? 'Edit Job Order' : 'New Job Order',
          titleEn: 'Job Order',
          code: 'JO',
          subtitle: 'N-MS-NIT-LSS-FRM-0201',
          icon: Truck,
          sections: [
            {
              title: 'Request Information',
              fields: [
                { key: 'requestDate', label: 'Request Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
                { key: 'project', label: 'Project', type: 'select', options: projectOptions, required: true },
                { key: 'requester', label: 'Requester', type: 'text', defaultValue: 'Current User', readOnly: true },
                { key: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'High', 'Critical'], required: true },
              ]
            },
            {
              title: 'Service Type',
              fields: [
                { key: 'joType', label: 'Job Order Type', type: 'select', options: ['Transport', 'Equipment', 'Generator_Rental', 'Generator_Maintenance', 'Rental_Daily', 'Rental_Monthly', 'Scrap'], required: true, onChange: 'joType' },
              ]
            },
          ]
        };
      case 'rfim':
        return {
          title: isEditMode ? 'Edit Inspection Request' : 'Request for Inspection of Materials',
          titleEn: 'Request for Inspection of Materials',
          code: 'RFIM',
          subtitle: 'N-MS-NIT-QC-FRM-0101',
          icon: Shield,
          sections: [
            {
              title: 'Voucher Reference',
              fields: [
                { key: 'mrrvId', label: 'MRRV Reference', type: 'select', options: mrrvOptions, required: true },
                { key: 'inspectionDate', label: 'Required Inspection Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
              ]
            },
            {
              title: 'Inspection Details',
              fields: [
                { key: 'inspectionType', label: 'Inspection Type', type: 'select', options: ['Visual', 'Functional', 'Dimensional', 'Lab Test'], required: true },
                { key: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'Urgent', 'Critical'], required: true },
                { key: 'inspector', label: 'Inspector', type: 'select', options: inspectorOptions },
              ]
            },
            {
              title: 'Items to Inspect',
              fields: [
                { key: 'itemsDescription', label: 'Items Description', type: 'textarea', required: true, placeholder: 'Electrical cables 50mm - 500 meters\nCircuit breakers - 20 pieces' },
                { key: 'specifications', label: 'Required Specifications', type: 'textarea', placeholder: 'Compliant with SASO standards...' },
                { key: 'notes', label: 'Notes', type: 'textarea' },
              ]
            }
          ]
        };
      case 'osd':
        return {
          title: isEditMode ? 'Edit OSD Report' : 'Over/Short/Damage Report',
          titleEn: 'Over/Short/Damage Report',
          code: 'OSD',
          subtitle: 'N-MS-NIT-QC-FRM-0102',
          icon: AlertTriangle,
          sections: [
            {
              title: 'Voucher Reference',
              fields: [
                { key: 'mrrvId', label: 'MRRV Reference', type: 'select', options: mrrvOptions, required: true },
                { key: 'reportDate', label: 'Report Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
              ]
            },
            {
              title: 'Issue Details',
              fields: [
                { key: 'reportType', label: 'Issue Type', type: 'select', options: ['Shortage', 'Overage', 'Damage'], required: true },
                { key: 'qtyAffected', label: 'Quantity Affected', type: 'number', required: true },
                { key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'Damage to outer packaging...' },
              ]
            },
            {
              title: 'Action Required',
              fields: [
                { key: 'actionRequired', label: 'Action', type: 'select', options: ['Contact Supplier', 'Replace', 'Accept As-Is', 'Return', 'Claim Insurance'], required: true },
                { key: 'notes', label: 'Notes', type: 'textarea' },
                { key: 'attachments', label: 'Photos/Documents', type: 'file' },
              ]
            }
          ]
        };
      case 'mrv':
        return {
          title: isEditMode ? 'Edit Material Return Voucher' : 'Material Return Voucher',
          titleEn: 'Material Return Voucher',
          code: 'MRV',
          subtitle: 'N-MS-NIT-LSS-FRM-0103',
          icon: RefreshCw,
          sections: [
            {
              title: 'Return Information',
              fields: [
                { key: 'returnDate', label: 'Return Date', type: 'date', required: true, defaultValue: new Date().toISOString().split('T')[0] },
                { key: 'project', label: 'Project', type: 'select', options: projectOptions, required: true },
                { key: 'warehouse', label: 'Receiving Warehouse', type: 'select', options: warehouseOptions, required: true },
                { key: 'returnType', label: 'Return Type', type: 'select', options: ['Surplus', 'Damaged', 'Wrong Item', 'Project Completion'], required: true },
              ]
            },
            {
              title: 'Additional Information',
              fields: [
                { key: 'reason', label: 'Return Reason', type: 'textarea', required: true, placeholder: 'Surplus quantity after completing phase one...' },
                { key: 'returnedBy', label: 'Returned By', type: 'text', defaultValue: 'Current User', readOnly: true },
                { key: 'notes', label: 'Notes', type: 'textarea' },
                { key: 'attachments', label: 'Attachments', type: 'file' },
              ]
            }
          ]
        };
      default:
        return {
          title: 'Generic Form',
          titleEn: 'Generic Form',
          code: 'GEN',
          subtitle: 'Standard Operation Form',
          icon: FileText,
          sections: [
            {
              title: 'Details',
              fields: [
                { key: 'description', label: 'Description', type: 'textarea', required: true }
              ]
            }
          ]
        };
    }
  }, [formType, projectOptions, warehouseOptions, supplierOptions, mrrvOptions, inspectorOptions, isEditMode]);

  // Dynamic JO sections based on selected type
  const joTypeSections = useMemo(() => {
    if (formType !== 'jo' || !joType) return [];

    const typeKey = joType.split(' - ')[0];
    switch (typeKey) {
      case 'Transport':
        return [{
          title: 'Transport Details',
          fields: [
            { key: 'pickupLocation', label: 'Pickup Location', type: 'text', required: true, placeholder: 'Dammam Warehouse' },
            { key: 'deliveryLocation', label: 'Delivery Location', type: 'text', required: true, placeholder: 'Project Site' },
            { key: 'cargoType', label: 'Cargo Type', type: 'text', required: true, placeholder: 'Construction Material' },
            { key: 'cargoWeight', label: 'Cargo Weight (Tons)', type: 'number', required: true },
            { key: 'numberOfTrailers', label: 'Number of Trailers', type: 'number' },
            { key: 'materialPrice', label: 'Material Value (SAR)', type: 'number' },
            { key: 'insuranceRequired', label: 'Insurance Required?', type: 'checkbox' },
            { key: 'entryPermit', label: 'Entry Permit Required?', type: 'checkbox' },
          ]
        }];
      case 'Equipment':
        return [{
          title: 'Equipment Details',
          fields: [
            { key: 'equipmentType', label: 'Equipment Type', type: 'select', options: ['Forklift 3T', 'Forklift 5T', 'Forklift 7T', 'Crane 30T', 'Crane 50T', 'Boom Truck 10T', 'Trailer (Trella)', 'Diyanna'], required: true },
            { key: 'quantity', label: 'Quantity', type: 'number', required: true },
            { key: 'durationDays', label: 'Duration (Days)', type: 'number', required: true },
            { key: 'projectSite', label: 'Project Site', type: 'text', required: true },
            { key: 'withOperator', label: 'With Operator?', type: 'checkbox' },
          ]
        }];
      case 'Generator_Rental':
        return [{
          title: 'Generator Rental Details',
          fields: [
            { key: 'capacityKva', label: 'Capacity (KVA)', type: 'select', options: ['100', '250', '500', '750', '1000'], required: true },
            { key: 'rentalStart', label: 'Rental Start Date', type: 'date', required: true },
            { key: 'rentalEnd', label: 'Rental End Date', type: 'date', required: true },
            { key: 'siteLocation', label: 'Installation Site', type: 'text', required: true },
            { key: 'fuelIncluded', label: 'Fuel Included?', type: 'checkbox' },
          ]
        }];
      case 'Generator_Maintenance':
        return [{
          title: 'Generator Maintenance Details',
          fields: [
            { key: 'generatorId', label: 'Generator ID', type: 'text', required: true },
            { key: 'capacityKva', label: 'Capacity (KVA)', type: 'select', options: ['100', '250', '500', '750', '1000'], required: true },
            { key: 'maintenanceType', label: 'Maintenance Type', type: 'select', options: ['Preventive', 'Corrective', 'Emergency'], required: true },
            { key: 'issueDescription', label: 'Issue Description', type: 'textarea', required: true },
          ]
        }];
      case 'Scrap':
        return [{
          title: 'Scrap Details',
          fields: [
            { key: 'scrapType', label: 'Scrap Type', type: 'select', options: ['Metal', 'Cable', 'Wood', 'Mixed', 'Electronic'], required: true },
            { key: 'weightTons', label: 'Weight (Tons)', type: 'number', required: true },
            { key: 'destination', label: 'Destination', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea', required: true },
            { key: 'photos', label: 'Photos (min. 3)', type: 'file' },
          ]
        }];
      case 'Rental_Daily':
        return [{
          title: 'Daily Rental Details',
          fields: [
            { key: 'equipmentType', label: 'Equipment Type', type: 'select', options: ['Forklift 3T', 'Forklift 5T', 'Crane 30T', 'Boom Truck', 'Trailer'], required: true },
            { key: 'dailyRate', label: 'Daily Rate (SAR)', type: 'number', required: true },
            { key: 'startDate', label: 'Start Date', type: 'date', required: true },
            { key: 'endDate', label: 'End Date', type: 'date', required: true },
            { key: 'withOperator', label: 'With Operator?', type: 'checkbox' },
          ]
        }];
      case 'Rental_Monthly':
        return [{
          title: 'Monthly Rental Details',
          fields: [
            { key: 'equipmentType', label: 'Equipment Type', type: 'select', options: ['Forklift 3T', 'Forklift 5T', 'Crane 30T', 'Generator 250KVA', 'Generator 500KVA'], required: true },
            { key: 'monthlyRate', label: 'Monthly Rate (SAR)', type: 'number', required: true },
            { key: 'startDate', label: 'Start Date', type: 'date', required: true },
            { key: 'durationMonths', label: 'Duration (Months)', type: 'number', required: true },
            { key: 'withOperator', label: 'With Operator?', type: 'checkbox' },
          ]
        }];
      default:
        return [];
    }
  }, [formType, joType]);

  // Combine base sections with dynamic JO sections
  const allSections = useMemo(() => {
    if (formType === 'jo') {
      return [...formConfig.sections, ...joTypeSections];
    }
    return formConfig.sections;
  }, [formConfig.sections, joTypeSections, formType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...formData, lineItems, totalValue, type: joType || undefined };
    submit(payload);
  };

  const handleInputChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (key === 'joType') {
      setJoType(value as string);
    }
  };

  const handleFileUpload = async (fieldKey: string, file: File) => {
    try {
      const result = await uploadMutation.mutateAsync(file);
      setUploadedFiles((prev) => ({ ...prev, [fieldKey]: { url: result.url, name: result.originalName, size: result.size } }));
      setFormData((prev) => ({ ...prev, [fieldKey]: result.url }));
    } catch {
      // Error is handled by mutation state
    }
  };

  const handleRemoveFile = (fieldKey: string) => {
    setUploadedFiles((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setFormData((prev) => ({ ...prev, [fieldKey]: '' }));
  };

  // Get value from formData for pre-populating fields
  const getFieldValue = (field: FormFieldDef): string => {
    const val = formData[field.key];
    if (val === undefined || val === null) return field.defaultValue || '';
    if (typeof val === 'boolean') return '';
    return String(val);
  };

  const getCheckboxValue = (key: string): boolean => {
    return Boolean(formData[key]);
  };

  const FormIcon = formConfig.icon;

  // Loading state for edit mode
  if (isLoadingDoc) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] animate-fade-in">
        <Loader2 size={40} className="text-nesma-secondary animate-spin mb-4" />
        <p className="text-gray-400">Loading document...</p>
      </div>
    );
  }

  // Document not found
  if (isEditMode && !isLoadingDoc && !existingDoc && initialized === false && detailQuery && !detailQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] glass-card rounded-2xl p-8 text-center animate-fade-in mx-auto max-w-2xl mt-10 border border-red-500/30 bg-gradient-to-b from-red-900/10 to-transparent">
        <div className="w-20 h-20 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mb-6 border border-red-500/50">
          <AlertCircle size={40} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Document Not Found</h2>
        <p className="text-gray-400 mb-6">The document with ID <span className="font-mono text-nesma-secondary">{id}</span> could not be found.</p>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-3 bg-nesma-primary hover:bg-nesma-accent text-white rounded-xl font-medium transition-all"
        >
          Go Back
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] glass-card rounded-2xl p-8 text-center animate-fade-in mx-auto max-w-2xl mt-10 border border-green-500/30 bg-gradient-to-b from-green-900/10 to-transparent">
        <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mb-6 border border-green-500/50 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
          <CheckCircle size={40} />
        </div>
        <h2 className="text-3xl font-bold text-white mb-2">
          {isEditMode ? 'Document Updated Successfully' : 'Request Submitted Successfully'}
        </h2>
        <p className="text-gray-400 mb-4 max-w-md">
          Document <span className="text-nesma-secondary font-medium font-mono">{isEditMode ? id : documentNumber}</span> has been {isEditMode ? 'updated' : 'created'}.
        </p>
        {hasLineItems && totalValue > 0 && (
          <div className="glass-card px-6 py-3 rounded-xl mb-6">
            <span className="text-gray-400 text-sm">Total Value: </span>
            <span className="text-nesma-secondary font-bold text-xl">{totalValue.toLocaleString()} SAR</span>
            <span className="text-gray-500 text-xs block mt-1">{approvalInfo.level}</span>
          </div>
        )}
        <div className="flex gap-4">
          {!isEditMode && (
            <button
              onClick={() => { reset(); setFormData({}); setLineItems([]); }}
              className="px-6 py-3 border border-white/20 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white transition-all"
            >
              Submit Another
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-gradient-to-r from-nesma-primary to-nesma-dark border border-nesma-primary/50 text-white rounded-xl hover:shadow-[0_0_20px_rgba(46,49,146,0.4)] transition-all"
          >
            {isEditMode ? 'Back to List' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-10 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8 text-sm text-gray-400">
        <span onClick={() => navigate('/admin')} className="cursor-pointer hover:text-nesma-secondary transition-colors">Dashboard</span>
        <span className="text-gray-600">/</span>
        <span className="cursor-pointer hover:text-nesma-secondary transition-colors">Forms</span>
        <span className="text-gray-600">/</span>
        <span className="text-white font-medium">{formConfig.code}</span>
        {isEditMode && (
          <>
            <span className="text-gray-600">/</span>
            <span className="text-nesma-secondary font-mono text-xs">{id}</span>
          </>
        )}
      </div>

      {/* Non-editable warning */}
      {isEditMode && !isEditable && (
        <div className="flex items-center gap-3 px-5 py-4 mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
          <AlertTriangle size={20} className="shrink-0" />
          <div>
            <p className="font-medium">This document cannot be edited</p>
            <p className="text-sm text-amber-400/70">Documents with status &quot;{docStatus}&quot; are read-only. Only documents in {editableStatuses.join(' / ')} status can be modified.</p>
          </div>
        </div>
      )}

      <div className="glass-card rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        {/* Header */}
        <div className="border-b border-white/10 p-8 bg-gradient-to-r from-nesma-primary/20 to-transparent">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">{formConfig.title}</h1>
              <p className="text-lg text-gray-400 mb-3">{formConfig.titleEn}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono bg-nesma-secondary/10 text-nesma-secondary border border-nesma-secondary/30 px-2 py-1 rounded">
                  {isEditMode ? id : nextNumber}
                </span>
                <span className="text-[10px] text-gray-500">{formConfig.subtitle}</span>
                {isEditMode && docStatus && (
                  <span className={`text-xs px-2 py-1 rounded border ${isEditable ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                    {docStatus}
                  </span>
                )}
                {!isEditMode && (
                  <span className="text-sm text-gray-400 flex items-center gap-1">
                    <AlertCircle size={14} />
                    Required fields
                  </span>
                )}
              </div>
            </div>
            <div className="h-14 w-14 rounded-xl bg-white/5 flex items-center justify-center border border-white/10">
              <FormIcon className="text-nesma-secondary" size={28} />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-10">
          {allSections.map((section, idx) => (
            <div key={idx} className="space-y-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-3">
                <span className="w-1 h-6 bg-nesma-secondary rounded-full shadow-[0_0_8px_rgba(128,209,233,0.6)]"></span>
                {section.title}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {section.fields.map((field: FormFieldDef, fIdx: number) => (
                  <div key={fIdx} className={`flex flex-col gap-2 ${field.type === 'textarea' || field.type === 'file' ? 'md:col-span-2' : ''}`}>
                    <label className="text-sm font-medium text-gray-300 ml-1">
                      {field.label} {field.required && <span className="text-red-400">*</span>}
                    </label>

                    {field.type === 'select' ? (
                      <select
                        className="nesma-input px-4 py-3 w-full appearance-none bg-white/5 border border-white/10 rounded-xl text-white focus:border-nesma-secondary focus:ring-1 focus:ring-nesma-secondary outline-none transition-all"
                        required={field.required}
                        disabled={isEditMode && !isEditable}
                        value={getFieldValue(field)}
                        onChange={(e) => handleInputChange(field.onChange || field.key, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {field.options?.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        className="nesma-input px-4 py-3 w-full min-h-[120px] bg-white/5 border border-white/10 rounded-xl text-white focus:border-nesma-secondary focus:ring-1 focus:ring-nesma-secondary outline-none transition-all"
                        required={field.required}
                        disabled={isEditMode && !isEditable}
                        placeholder={field.placeholder || 'Enter details here...'}
                        value={getFieldValue(field)}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                      />
                    ) : field.type === 'checkbox' ? (
                      <label className="flex items-center gap-3 p-4 border border-white/10 rounded-xl bg-white/5 cursor-pointer hover:bg-white/10 transition-colors">
                        <input
                          type="checkbox"
                          className="w-5 h-5 text-nesma-secondary rounded border-gray-500 focus:ring-nesma-secondary bg-transparent"
                          disabled={isEditMode && !isEditable}
                          checked={getCheckboxValue(field.key)}
                          onChange={(e) => handleInputChange(field.key, e.target.checked)}
                        />
                        <span className="text-sm text-gray-300">Yes</span>
                      </label>
                    ) : field.type === 'file' ? (
                      uploadedFiles[field.key] ? (
                        <div className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-nesma-secondary/30 rounded-xl">
                          <div className="w-10 h-10 bg-nesma-secondary/10 rounded-lg flex items-center justify-center shrink-0">
                            <FileText className="text-nesma-secondary" size={20} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{uploadedFiles[field.key].name}</p>
                            <p className="text-xs text-gray-500">{(uploadedFiles[field.key].size / 1024).toFixed(1)} KB</p>
                          </div>
                          {(!isEditMode || isEditable) && (
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(field.key)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <label
                          className={`border-2 border-dashed border-white/20 rounded-xl p-8 text-center hover:bg-white/5 hover:border-nesma-secondary/50 transition-all cursor-pointer group ${uploadMutation.isPending ? 'pointer-events-none opacity-60' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-nesma-secondary/50', 'bg-white/5'); }}
                          onDragLeave={(e) => { e.currentTarget.classList.remove('border-nesma-secondary/50', 'bg-white/5'); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('border-nesma-secondary/50', 'bg-white/5');
                            const file = e.dataTransfer.files[0];
                            if (file) handleFileUpload(field.key, file);
                          }}
                        >
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv"
                            disabled={(isEditMode && !isEditable) || uploadMutation.isPending}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(field.key, file);
                              e.target.value = '';
                            }}
                          />
                          <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform shadow-lg">
                            {uploadMutation.isPending ? (
                              <Loader2 className="text-nesma-secondary animate-spin" size={24} />
                            ) : (
                              <Upload className="text-gray-400 group-hover:text-nesma-secondary transition-colors" size={24} />
                            )}
                          </div>
                          <span className="block text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                            {uploadMutation.isPending ? 'Uploading...' : 'Drop files here or click to browse'}
                          </span>
                          <span className="text-xs text-gray-500 mt-1 block">PDF, PNG, JPG, Excel, Word, CSV -- Max 10MB</span>
                          {uploadMutation.isError && (
                            <span className="text-xs text-red-400 mt-2 block">
                              {uploadMutation.error instanceof Error ? uploadMutation.error.message : 'Upload failed'}
                            </span>
                          )}
                        </label>
                      )
                    ) : (
                      <input
                        type={field.type}
                        className="nesma-input px-4 py-3 w-full bg-white/5 border border-white/10 rounded-xl text-white focus:border-nesma-secondary focus:ring-1 focus:ring-nesma-secondary outline-none transition-all"
                        required={field.required}
                        disabled={isEditMode && !isEditable}
                        value={getFieldValue(field)}
                        readOnly={field.readOnly}
                        placeholder={field.placeholder || (field.readOnly ? '' : `Enter ${field.label}`)}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Line Items Section for MRRV, MIRV, MRV */}
          {hasLineItems && (
            <LineItemsTable
              items={lineItems}
              onItemsChange={setLineItems}
              showCondition={formType === 'mrrv' || formType === 'mrv'}
              showStockAvailability={formType === 'mirv'}
            />
          )}

          {/* Approval Level Indicator (auto-calculated) */}
          {hasLineItems && totalValue > 0 && (
            <div className="glass-card rounded-xl p-4 border border-white/10 bg-gradient-to-r from-white/5 to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                    <Shield size={18} className="text-nesma-secondary" />
                  </div>
                  <div>
                    <span className="text-sm text-gray-400 block">Required Approval Level</span>
                    <span className={`text-sm font-medium ${approvalInfo.color}`}>{approvalInfo.level}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-500 block">Total Value</span>
                  <span className="text-nesma-secondary font-bold text-lg">{totalValue.toLocaleString()} SAR</span>
                </div>
              </div>
            </div>
          )}

          {/* Status Flow */}
          {statusFlow.length > 0 && (
            <div className="glass-card rounded-xl p-4 border border-white/10 bg-gradient-to-r from-white/5 to-transparent">
              <p className="text-xs text-gray-500 mb-2">Document Workflow</p>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {statusFlow.map((s, i, arr) => {
                  const isCurrent = isEditMode && s === docStatus;
                  return (
                    <React.Fragment key={s}>
                      <span className={`px-2 py-1 rounded ${isCurrent ? 'bg-nesma-secondary/20 text-nesma-secondary border border-nesma-secondary/30 ring-1 ring-nesma-secondary/40' : i === 0 && !isEditMode ? 'bg-nesma-secondary/20 text-nesma-secondary border border-nesma-secondary/30' : 'bg-white/5 text-gray-500 border border-white/10'}`}>{s}</span>
                      {i < arr.length - 1 && <span className="text-gray-600">{'\u2192'}</span>}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* Auto-creation Indicators */}
          {formType === 'mrrv' && (
            <div className="flex gap-3 flex-wrap">
              {Boolean(formData.rfimRequired) && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
                  <Info size={14} /> Auto-creates RFIM inspection request
                </div>
              )}
              {lineItems.some(li => li.condition === 'Damaged') && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                  <AlertTriangle size={14} /> Damaged items detected -- OSD report will be created
                </div>
              )}
            </div>
          )}
          {formType === 'mirv' && totalValue > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
              <Info size={14} /> Gate Pass will be auto-created when status changes to &quot;Issued&quot;
            </div>
          )}

          {/* Validation Errors */}
          {errors.length > 0 && (
            <div className="space-y-2">
              {errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{err.field ? `${err.field}: ` : ''}{err.message}</span>
                  {err.rule && <span className="text-[10px] text-red-500/60 ml-auto">{err.rule}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Validation Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((warn, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-400">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{warn.field ? `${warn.field}: ` : ''}{warn.message}</span>
                  {warn.rule && <span className="text-[10px] text-amber-500/60 ml-auto">{warn.rule}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Submit */}
          <div className="pt-8 border-t border-white/10 flex justify-end gap-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-6 py-3 border border-white/20 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white font-medium transition-all"
            >
              Cancel
            </button>
            {(!isEditMode || isEditable) && (
              <button
                type="submit"
                disabled={submitting}
                className="px-8 py-3 bg-nesma-primary hover:bg-nesma-accent text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-nesma-primary/30 hover:shadow-nesma-primary/50 transition-all transform hover:-translate-y-1 disabled:opacity-50 disabled:transform-none"
              >
                <Save size={18} />
                {submitting ? 'Saving...' : isEditMode ? `Update ${formConfig.code}` : 'Save & Submit'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
