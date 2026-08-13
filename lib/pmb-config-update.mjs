export function isSuccessfulPmbConfigUpdateStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 200 && status < 400;
}

export function buildTargetedPmbConfigUpdatePayload(clientId, deviceId) {
  const client = Number(clientId);
  const device = Number(deviceId);
  if (!Number.isSafeInteger(client) || client <= 0 || !Number.isSafeInteger(device) || device <= 0) {
    throw new Error("A valid PMB client and device are required for a configuration refresh.");
  }
  return { id: String(client), device_id: device };
}
