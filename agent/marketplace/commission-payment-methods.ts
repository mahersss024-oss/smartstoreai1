export type CommissionPaymentMethod = {
  id: 'alrajhi' | 'snb' | 'stc-pay';
  name: string;
  subtitle: string;
  logoLabel: string;
  fields: Array<{
    label: string;
    value: string;
    copyValue: string;
  }>;
};

type PaymentMethodDefinition = Omit<CommissionPaymentMethod, 'fields'> & {
  fields: Array<{
    label: string;
    envKey: string;
    fallbackEnvKeys?: string[];
  }>;
};

const paymentMethodDefinitions: PaymentMethodDefinition[] = [
  {
    id: 'alrajhi',
    name: 'مصرف الراجحي',
    subtitle: 'تحويل بنكي لحساب عمولات سوق حمد',
    logoLabel: 'الراجحي',
    fields: [
      { label: 'اسم المستفيد', envKey: 'SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NAME' },
      { label: 'رقم الحساب', envKey: 'SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NUMBER' },
      { label: 'IBAN', envKey: 'SMARTSTORE_COMMISSION_ALRAJHI_IBAN' },
    ],
  },
  {
    id: 'snb',
    name: 'البنك الأهلي السعودي',
    subtitle: 'تحويل بنكي لحساب عمولات سوق حمد',
    logoLabel: 'الأهلي',
    fields: [
      { label: 'اسم المستفيد', envKey: 'SMARTSTORE_COMMISSION_SNB_ACCOUNT_NAME' },
      { label: 'رقم الحساب', envKey: 'SMARTSTORE_COMMISSION_SNB_ACCOUNT_NUMBER' },
      { label: 'IBAN', envKey: 'SMARTSTORE_COMMISSION_SNB_IBAN' },
    ],
  },
  {
    id: 'stc-pay',
    name: 'STC Pay',
    subtitle: 'تحويل محفظة سريع لعمولات سوق حمد',
    logoLabel: 'stc pay',
    fields: [
      { label: 'اسم المستفيد', envKey: 'SMARTSTORE_COMMISSION_STC_PAY_NAME' },
      {
        label: 'رقم الحساب',
        envKey: 'SMARTSTORE_COMMISSION_STC_PAY_ACCOUNT',
        fallbackEnvKeys: ['SMARTSTORE_COMMISSION_STC_PAY_NUMBER'],
      },
    ],
  },
];

function getEnvValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
) {
  return env[key]?.trim() ?? '';
}

function getFieldValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  field: PaymentMethodDefinition['fields'][number],
) {
  const primaryValue = getEnvValue(env, field.envKey);

  if (primaryValue) {
    return primaryValue;
  }

  for (const fallbackEnvKey of field.fallbackEnvKeys ?? []) {
    const fallbackValue = getEnvValue(env, fallbackEnvKey);

    if (fallbackValue) {
      return fallbackValue;
    }
  }

  return '';
}

export function getCommissionPaymentMethods(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CommissionPaymentMethod[] {
  return paymentMethodDefinitions
    .map((method) => ({
      ...method,
      fields: method.fields
        .map((field) => {
          const value = getFieldValue(env, field);

          return value
            ? {
                label: field.label,
                value,
                copyValue: value,
              }
            : null;
        })
        .filter((field): field is CommissionPaymentMethod['fields'][number] =>
          Boolean(field),
        ),
    }))
    .filter((method) => method.fields.length > 0);
}
