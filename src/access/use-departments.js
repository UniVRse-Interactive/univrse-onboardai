import { useCallback, useEffect, useState } from 'react';
import { accountApi } from './account-api.mjs';
import { createDepartmentCache } from './department-cache.mjs';

export const departmentCache = createDepartmentCache(() => accountApi.listDepartments());

// All departments (active and archived) from the API, or null while loading.
// Reloads by itself after Settings changes the list.
export function useDepartments() {
  const [departments, setDepartments] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => departmentCache.subscribe(() => setAttempt((n) => n + 1)), []);
  useEffect(() => {
    let alive = true;
    setError('');
    departmentCache
      .get()
      .then((value) => alive && setDepartments(value))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    departmentCache.invalidate();
  }, []);
  return { departments, error, reload };
}
