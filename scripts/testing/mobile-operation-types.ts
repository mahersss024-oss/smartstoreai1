export type MobileScenario = {
  file: string;
  testTitle: string;
  verifies: string[];
  mode: 'node' | 'postgres' | 'playwright' | 'mobile-node';
};

export type MobileOperationContract = {
  id: string;
  label: string;
  endpoints: string[];
  mobileFiles: string[];
  serverEffects: string[];
  scenarios: MobileScenario[];
  remainingChecks: string[];
  actionEvidence?: Array<{ file: string; sourceText: string; description: string }>;
};
