import { useState } from 'react';
import { Input } from './input';
import { Button } from './button';
import { Pencil, Check, X, Loader2 } from 'lucide-react';

interface InlineEditFieldProps {
  label: string;
  value: string;
  onSave: (newValue: string) => void;
  isLoading?: boolean;
  error?: Error | null;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

export function InlineEditField({
  label,
  value,
  onSave,
  isLoading = false,
  error = null,
  inputProps,
}: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const startEditing = () => {
    setEditValue(value);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const save = () => {
    if (!editValue.trim()) {
      cancelEditing();
      return;
    }
    onSave(editValue.trim());
    setIsEditing(false);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="font-medium">{label}</p>
        {!isEditing && !isLoading && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={startEditing}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') cancelEditing();
            }}
            className="font-mono text-sm h-8"
            autoFocus
            disabled={isLoading}
            {...inputProps}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={save}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={cancelEditing}
            disabled={isLoading}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <p className="font-mono text-sm truncate">{value}</p>
      )}
      {error && (
        <p className="text-xs text-red-500">{error.message}</p>
      )}
    </div>
  );
}