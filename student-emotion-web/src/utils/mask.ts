export function maskPhone(phone: string) {
  const p = (phone ?? '').trim()
  if (p.length < 7) return p
  return `${p.slice(0, 3)}****${p.slice(-4)}`
}

export function maskIdCard(idCard: string) {
  const v = (idCard ?? '').trim()
  if (v.length < 10) return v
  return `${v.slice(0, 6)}********${v.slice(-4)}`
}

