export interface DigitalIdResponse {
  payload: string;
  expiresAtEpochSeconds: number;
  refreshInSeconds: number;
}

export interface DigitalIdCardState {
  isLoading: boolean;
  payload?: string;
  expiresAtEpochSeconds?: number;
  refreshInSeconds?: number;
  error?: string;
}
