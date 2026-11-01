import { useEffect, useState } from 'react';
import { api, useAction, useApi } from '../../lib/api';

/** Lädt die Einstellungen eines Tools in einen bearbeitbaren Zustand */
export function useSettings<T extends Record<string, any>>(tool: string) {
  const { data, loading, error } = useApi<T>(`/api/settings/${tool}`);
  const [form, setForm] = useState<T | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const save = async () => {
    if (!form) return;
    const res = await action.run(() => api.put<T>(`/api/settings/${tool}`, form));
    if (res) {
      setForm(res);
      setSaved(true);
    }
  };

  return { form, set, setForm, save, saved, loading, error: error?.message ?? action.error, busy: action.busy };
}
