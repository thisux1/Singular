import { useState, useRef, useEffect } from 'react';
import './FuiSelect.css';

export interface FuiSelectOption {
  value: string;
  label: string;
}

interface FuiSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: FuiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export function FuiSelect({ id, value, onChange, options, placeholder, disabled }: FuiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown se clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);
  const displayValue = selectedOption ? selectedOption.label : (placeholder || 'Selecione...');

  return (
    <div className={`fui-select ${disabled ? 'fui-select--disabled' : ''}`} ref={dropdownRef}>
      <button
        id={id}
        type="button"
        className="fui-select__trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        data-placeholder={!selectedOption}
        disabled={disabled}
      >
        <span className="fui-select__value">{displayValue}</span>
        <svg className={`fui-select__arrow ${isOpen ? 'fui-select__arrow--open' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && !disabled && (
        <div className="fui-select__dropdown">
          {options.length === 0 ? (
            <div className="fui-select__option fui-select__option--empty">Nenhum dado disponível</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`fui-select__option ${option.value === value ? 'fui-select__option--selected' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
