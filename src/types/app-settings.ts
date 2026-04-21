export interface AppSettings {
  personName: string;
  personInfo: string;
  emergencyContactName: string;
  emergencyEmail: string;
  deviceId: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  personName: '',
  personInfo: '',
  emergencyContactName: '',
  emergencyEmail: '',
  deviceId: '',
};
