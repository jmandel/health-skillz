import { useState, useEffect, useRef } from 'react';

interface Props {
  onSearch: (query: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;

export default function ProviderSearch({ onSearch, disabled, placeholder }: Props) {
  const [value, setValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onSearch(value);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="provider-search">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder || 'Search for your healthcare provider...'}
        disabled={disabled}
        className="provider-search-input"
        autoFocus
      />
      {value && (
        <button
          type="button"
          className="provider-search-clear"
          onClick={() => setValue('')}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
