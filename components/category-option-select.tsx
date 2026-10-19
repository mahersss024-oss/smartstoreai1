import { getMarketplaceCategoryOptionLabel, getMarketplaceCategoryOptions } from '@/lib/marketplace/category-options';

export function CategoryOptionSelect({ category, value, onChange, className, id, disabled, all = false }: {
  category: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
  all?: boolean;
}) {
  const options = getMarketplaceCategoryOptions(category);
  if (!options.length) return null;
  const label = getMarketplaceCategoryOptionLabel(category);
  return (
    <label className="grid min-w-0 gap-2 text-sm" htmlFor={id}>
      <span>{label}</span>
      <select id={id} name={id} aria-label={label} className={className}
        value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{all ? (label === 'البراند' ? 'جميع البراندات' : 'جميع الأنواع') : 'غير محدد'}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
