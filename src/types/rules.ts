export interface DeviceRule {
  single_multiplier: number;
  day_max_multiplier: number;
  week_max_multiplier: number;
  pin?: string | number;
}

export interface RecipientRule {
  id: string;
  required_memo?: string;
}

export interface SecurityRules {
  description?: string;
  updated_at?: string;
  fee_limit: number;
  public_keys: Record<string, string>; // fingerprint -> alias
  oauth_allowed_devices: string[];
  trading_risk: {
    authorized_devices: string[];
    volatility_limit_1h: number;
    volatility_limit_1d: number;
    volatility_limit_1w: number;
    market_whitelist: string[];
  };
  unlimited_payments: {
    authorized_devices: string[];
    recipient_whitelist: Record<string, string | RecipientRule>;
  };
  micro_payments: {
    base_limits: Record<string, number>;
    device_rules: Record<string, DeviceRule>;
  };
}