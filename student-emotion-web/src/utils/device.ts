export function getDeviceInfo() {
  const ua = navigator.userAgent
  const platform = navigator.platform
  return `${platform} | ${ua}`
}

export function getClientIpMock() {
  return '10.0.0.23'
}

