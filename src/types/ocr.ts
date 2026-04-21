export interface PrescriptionMedication {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
}

export interface PhotoPrescriptionParsed {
  rawText: string;
  institution?: string;
  doctorName?: string;
  doctorLicense?: string;
  patientName?: string;
  date?: string;
  indicationsGeneral?: string;
  medications: PrescriptionMedication[];
}

export interface BonoItem {
  codigo: string;
  descripcion: string;
  cantidad: string;
  valor_total: string;
  bonificacion: string;
  copago: string;
  aporte_seg_com: string;
  valor_a_pagar: string;
}

export interface BonoParsed {
  document_type: 'bono' | 'receta' | 'otro';
  provider: 'FONASA' | 'DIPRECA' | 'ISAPRE' | 'OTRO';
  raw_text: string;
  numero_bono: string;
  fecha_emision: string;
  fecha_atencion: string;
  beneficiario_nombre: string;
  beneficiario_rut: string;
  titular_nombre: string;
  titular_rut: string;
  prestador_nombre: string;
  prestador_rut: string;
  profesional_nombre: string;
  profesional_rut: string;
  items: BonoItem[];
  monto_total: string;
  bonificacion_total: string;
  copago_total: string;
  monto_a_pagar: string;
  moneda: 'CLP';
  confidence: number;
}
