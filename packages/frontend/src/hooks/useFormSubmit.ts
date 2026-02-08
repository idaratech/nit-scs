// ============================================================================
// Form Submission Hook
// Handles validation, submission, auto-numbering
// TODO: Replace with React Query mutations in Phase 8
// ============================================================================

import { useState, useCallback } from 'react';
import type { VoucherLineItem } from '@nit-wms/shared/types';
import { generateDocumentNumber } from '@/utils/autoNumber';

interface UseFormSubmitOptions {
  documentType: string;
  onSuccess?: (data: Record<string, unknown>) => void;
  validator?: (data: Record<string, unknown>, lineItems: VoucherLineItem[]) => { valid: boolean; errors: { field: string; rule: string; message: string }[]; warnings: { field: string; rule: string; message: string }[] };
  service?: {
    create: (data: Record<string, unknown>) => Promise<{ data: unknown; success: boolean; message?: string }>;
  };
}

interface UseFormSubmitReturn {
  submitting: boolean;
  submitted: boolean;
  errors: { field: string; rule: string; message: string }[];
  warnings: { field: string; rule: string; message: string }[];
  documentNumber: string | null;
  submit: (formData: Record<string, unknown>, lineItems?: VoucherLineItem[]) => Promise<boolean>;
  reset: () => void;
}

export function useFormSubmit({
  documentType,
  onSuccess,
  validator,
  service,
}: UseFormSubmitOptions): UseFormSubmitReturn {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<{ field: string; rule: string; message: string }[]>([]);
  const [warnings, setWarnings] = useState<{ field: string; rule: string; message: string }[]>([]);
  const [documentNumber, setDocumentNumber] = useState<string | null>(null);

  const submit = useCallback(async (formData: Record<string, unknown>, lineItems: VoucherLineItem[] = []) => {
    setErrors([]);
    setWarnings([]);

    if (validator) {
      const result = validator(formData, lineItems);
      setWarnings(result.warnings);
      if (!result.valid) {
        setErrors(result.errors);
        return false;
      }
    }

    setSubmitting(true);
    try {
      const docNumber = generateDocumentNumber(documentType);
      const fullData = {
        ...formData,
        id: docNumber,
        formNumber: docNumber,
        lineItems,
        status: 'Draft',
        createdAt: new Date().toISOString(),
        totalValue: lineItems.reduce((sum, item) => sum + item.totalPrice, 0),
      };

      if (service) {
        const result = await service.create(fullData);
        if (!result.success) {
          setErrors([{ field: 'form', rule: 'API', message: result.message || 'Submission failed' }]);
          return false;
        }
      }

      setDocumentNumber(docNumber);
      setSubmitted(true);
      onSuccess?.(fullData);
      return true;
    } catch {
      setErrors([{ field: 'form', rule: 'ERROR', message: 'An unexpected error occurred' }]);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [documentType, validator, service, onSuccess]);

  const reset = useCallback(() => {
    setSubmitted(false);
    setSubmitting(false);
    setErrors([]);
    setWarnings([]);
    setDocumentNumber(null);
  }, []);

  return { submitting, submitted, errors, warnings, documentNumber, submit, reset };
}
