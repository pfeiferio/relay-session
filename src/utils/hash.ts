import crypto from 'crypto'

export const sha256 = (data: crypto.BinaryLike): string =>
  crypto.createHash('sha256').update(data).digest('hex')

export const sign = (sessionId: string, secret: string): string => {
  return crypto
    .createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64url')
}
