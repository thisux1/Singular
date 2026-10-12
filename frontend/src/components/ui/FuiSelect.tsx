import { useState, useRef, useEffect, useId } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const autoId = useId();

  const triggerId = id ?? `fui-select-${autoId}`;
  const listboxId = `${triggerId}-listbox`;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const displayValue = selectedOption ? selectedOption.label : (placeholder || 'Selecione...');

  const openList = (initialIndex?: number) => {
    setIsOpen(true);
    setActiveIndex(initialIndex ?? (selectedIndex >= 0 ? selectedIndex : 0));
  };

  const closeList = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeList();
  };

  // Fecha o dropdown se clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeList();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Mantém a option ativa visível durante navegação por teclado
  useEffect(() => {
    if (!isOpen || activeIndex < 0 || !listboxRef.current) return;
    const el = listboxRef.current.querySelector(`[id="${optionId(activeIndex)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, isOpen]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) openList(0);
        else setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) openList(options.length - 1);
        else setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (isOpen && options.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (isOpen && options.length > 0) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          if (activeIndex >= 0) selectOption(activeIndex);
        } else {
          openList();
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
        }
        break;
      case 'Tab':
        if (isOpen) closeList();
        break;
    }
  };

  return (
    <div className={`fui-select ${disabled ? 'fui-select--disabled' : ''}`} ref={dropdownRef}>
      <button
        id={triggerId}
        type="button"
        className="fui-select__trigger input input--terminal"
        onClick={() => !disabled && (isOpen ? closeList() : openList())}
        onKeyDown={handleTriggerKeyDown}
        data-placeholder={!selectedOption}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
      >
        <span className="fui-select__value">{displayValue}</span>
        <svg className={`fui-select__arrow ${isOpen ? 'fui-select__arrow--open' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && !disabled && (
        <div
          className="fui-select__dropdown glass glass--menu cut"
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
        >
          {options.length === 0 ? (
            <div className="fui-select__option fui-select__option--empty" role="option" aria-disabled="true" aria-selected="false">
              Nenhum dado disponível
            </div>
          ) : (
            options.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                className={`fui-select__option ${option.value === value ? 'fui-select__option--selected' : ''} ${index === activeIndex ? 'fui-select__option--active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(index)}
              >
                {option.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
