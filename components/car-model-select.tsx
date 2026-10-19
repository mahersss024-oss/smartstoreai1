import { getMarketplaceCarModels } from '@/lib/marketplace/car-models';

type Props = {
  category: string;
  brand: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
  all?: boolean;
};

export function CarModelSelect({ category, brand, value, onChange, className, id, disabled, all = false }: Props) {
  const choices = category === 'cars' ? getMarketplaceCarModels(brand) : [];
  if (!choices.length) return null;
  return (
    <label className="grid min-w-0 gap-2 text-sm" htmlFor={id}>
      <span>السيارة</span>
      <select id={id} name={id} aria-label="السيارة" className={className} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{all ? 'جميع السيارات' : 'غير محدد'}</option>
        {choices.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
  );
}
