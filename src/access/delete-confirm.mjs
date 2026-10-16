// Deleting an employee account is permanent, so HR must type the employee ID.
// The match is exact and case-sensitive; only surrounding whitespace is ignored.
export function canConfirmDelete(typed, employeeId) {
  return typeof employeeId === 'string' && employeeId !== '' && String(typed).trim() === employeeId;
}

export function deleteErrorMessage(error) {
  if (error?.code === 'EMPLOYEE_NOT_FOUND' || error?.status === 404)
    return 'This account no longer exists. The list has been refreshed.';
  // 409: the employee is mid-answer. Show the server's message; HR can retry.
  if (error?.code === 'CHAT_BUSY' || error?.status === 409)
    return (
      error.message || 'Wait for this employee’s answer to finish before removing their record.'
    );
  if (
    error?.code === 'PROFILE_STORAGE_UNAVAILABLE' ||
    error?.code === 'PROFILE_STORAGE_TIMEOUT' ||
    error?.status === 503 ||
    error?.status === 504
  )
    return 'Couldn’t delete; try again.';
  return error?.message || 'Couldn’t delete; try again.';
}
