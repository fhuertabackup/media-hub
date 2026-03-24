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
