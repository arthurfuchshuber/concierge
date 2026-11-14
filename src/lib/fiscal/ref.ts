/** Ref determinística enviada à Focus: derivada do operation_id, igual à gravada pelo banco ('cia-' || id). */
export function operationRef(operationId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new Error("fiscal_operation_id_invalid");
  return `cia-${operationId.toLowerCase()}`;
}
