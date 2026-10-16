// One shared copy of the department list per page view. The Add and Edit panels
// and the Settings page all read it; Settings clears it after a change so the
// next reader gets the new list. `fetcher` returns { departments }.

export function createDepartmentCache(fetcher) {
  let pending = null;
  let version = 0;
  const listeners = new Set();
  return {
    // -> Promise<department[]>. A failed load is not kept, so a retry asks again.
    get() {
      if (!pending) {
        const request = Promise.resolve()
          .then(fetcher)
          .then((data) => (Array.isArray(data?.departments) ? data.departments : []));
        pending = request;
        request.catch(() => {
          if (pending === request) pending = null;
        });
      }
      return pending;
    },
    // Forget the list and tell mounted readers to load it again.
    invalidate() {
      pending = null;
      version += 1;
      for (const listener of [...listeners]) listener(version);
    },
    // Forget the list without telling anyone (a new page view starts).
    reset() {
      pending = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
